import dotenv from 'dotenv';
// Load .env file first before process.env read
dotenv.config();

import { Command } from 'commander';
import { loadConfig } from './config';
import { authenticateInteractive, getAuthenticatedClient } from './auth/gmail-auth';
import { fetchBankAttachments } from './gmail/fetcher';
import { ParserChain } from './parsers/chain';
import { exportToCsv } from './storage/csv';
import { TransactionRow } from './types';

const program = new Command();

program
  .name('expense-fetcher')
  .description('Bank statement and bill email fetcher CLI for expense tracking')
  .version('1.0.0');

program
  .command('auth')
  .description('Authorize CLI access to Gmail via OAuth2 Desktop flow')
  .action(async () => {
    try {
      console.log('Starting interactive Gmail OAuth authorization...');
      await authenticateInteractive();
      console.log('Authentication setup complete.');
    } catch (err: any) {
      console.error('Authentication failed:', err.message || err);
      process.exit(1);
    }
  });

program
  .command('fetch')
  .description('Fetch and parse bank statement emails into CSV')
  .option('-c, --config <path>', 'Path to YAML configuration file', 'config.yaml')
  .option('-m, --month <YYYY-MM>', 'Target billing month (e.g. 2026-01)')
  .action(async (options) => {
    try {
      console.log(`Loading configuration from: ${options.config}...`);
      const config = loadConfig(options.config);

      let targetYearMonth: { year: number; month: number } | undefined;
      if (options.month) {
        const parts = options.month.split('-');
        if (parts.length !== 2 || isNaN(parseInt(parts[0], 10)) || isNaN(parseInt(parts[1], 10))) {
          throw new Error('Invalid --month format. Expected YYYY-MM (e.g. 2026-01).');
        }
        targetYearMonth = {
          year: parseInt(parts[0], 10),
          month: parseInt(parts[1], 10),
        };
        console.log(`Filtering for billing cycle: ${targetYearMonth.year}-${String(targetYearMonth.month).padStart(2, '0')}`);
      }

      console.log('Checking Gmail OAuth2 credentials...');
      const authClient = await getAuthenticatedClient();

      const parserChain = new ParserChain();
      const allTransactions: TransactionRow[] = [];

      for (const bank of config.banks) {
        if (!bank.enabled) continue;

        console.log(`\n--------------------------------------------------`);
        console.log(`Processing Bank: ${bank.bank_name} (${bank.bank_id})`);
        console.log(`--------------------------------------------------`);

        const attachments = await fetchBankAttachments(authClient, bank, targetYearMonth);
        if (attachments.length === 0) {
          console.log(`No attachments found for bank: ${bank.bank_id}`);
          continue;
        }

        for (const item of attachments) {
          try {
            const rows = await parserChain.parse(item.filePath, item.context, bank.parsers);
            allTransactions.push(...rows);
          } catch (err: any) {
            console.error(`Failed to parse attachment ${item.filePath}:`, err.message || err);
          }
        }
      }

      console.log(`\n==================================================`);
      if (allTransactions.length > 0) {
        const csvPath = await exportToCsv(allTransactions);
        console.log(`Pipeline complete! Extracted total ${allTransactions.length} transaction rows -> ${csvPath}`);
      } else {
        console.log('Pipeline complete! No transactions extracted.');
      }
      console.log(`==================================================\n`);
    } catch (err: any) {
      console.error('Fetch command failed:', err.message || err);
      process.exit(1);
    }
  });

program.parse(process.argv);
