import dotenv from 'dotenv';
// Load .env file first before process.env read
dotenv.config();

import fs from 'fs';
import { Command } from 'commander';
import path from 'path';
import { loadConfig } from './config';
import { authenticateInteractive, getAuthenticatedClient } from './auth/gmail-auth';
import { fetchBankAttachments } from './gmail/fetcher';
import { ParserChain } from './parsers/chain';
import { exportToCsv } from './storage/csv';
import { readTransactionsCsv, readTransactionsFromPath, exportSummaryCsv, readSummaryCsv } from './storage/summary-csv';
import { loadClassificationConfig } from './classification/rules';
import { aggregateTransactions } from './classification/aggregator';
import { syncClassifiedSummaryToSheets } from './storage/sheets-sync';
import { resolveWorkspacePaths } from './workspace';
import { TransactionRow } from './types';

function parseYearMonth(monthStr: string): { year: number; month: number } {
  const parts = monthStr.split('-');
  if (parts.length !== 2) {
    throw new Error('Invalid --month format. Expected YYYY-MM (e.g. 2026-01).');
  }
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  if (isNaN(year) || isNaN(month) || month < 1 || month > 12 || parts[0].length !== 4) {
    throw new Error('Invalid --month format. Expected YYYY-MM (e.g. 2026-01).');
  }
  return { year, month };
}

export async function runFetchStep(options: {
  month: string;
  workspace?: string;
  configPath?: string;
  outputPath?: string;
  reparse?: boolean;
  refetch?: boolean;
}): Promise<string> {
  const targetYearMonth = parseYearMonth(options.month);
  const configPath = options.configPath || 'config.yaml';
  console.log(`Loading configuration from: ${configPath}...`);
  const config = loadConfig(configPath);

  const paths = resolveWorkspacePaths({
    workspace: options.workspace,
    month: options.month,
    transactionsCsv: options.outputPath,
  });

  console.log(`Filtering for billing cycle: ${targetYearMonth.year}-${String(targetYearMonth.month).padStart(2, '0')}`);
  console.log(`Workspace directory: ${paths.monthDir || paths.workspaceDir}`);

  const hasEncryptedBank = config.banks.some((b) => b.enabled && b.attachment?.encrypted);
  const statementPassword = process.env.STATEMENT_PASSWORD;
  if (hasEncryptedBank && (!statementPassword || statementPassword.trim().length === 0)) {
    throw new Error(
      'One or more enabled banks require encrypted attachment parsing, but STATEMENT_PASSWORD environment variable is not set. Please set STATEMENT_PASSWORD in your .env file or environment.'
    );
  }

  console.log('Checking Gmail OAuth2 credentials...');
  const authClient = await getAuthenticatedClient();

  const parserChain = new ParserChain();
  const createdCsvPaths: string[] = [];
  let totalExtractedRows = 0;

  for (const bank of config.banks) {
    if (!bank.enabled) continue;

    console.log(`\n--------------------------------------------------`);
    console.log(`Processing Bank: ${bank.bank_name} (${bank.bank_id})`);
    console.log(`--------------------------------------------------`);

    const attachments = await fetchBankAttachments(
      authClient,
      bank,
      targetYearMonth,
      statementPassword,
      paths.downloadsDir,
      { refetch: options.refetch }
    );

    if (attachments.length === 0) {
      console.log(`No attachments found for bank: ${bank.bank_id}`);
      continue;
    }

    for (const item of attachments) {
      try {
        const pdfBaseName = path.parse(item.filePath).name;
        const individualCsvPath = options.outputPath && options.outputPath.endsWith('.csv')
          ? path.resolve(process.cwd(), options.outputPath)
          : path.join(paths.transactionsDir, `${pdfBaseName}.csv`);

        if (fs.existsSync(individualCsvPath) && !options.reparse) {
          console.log(`  [Cache Hit] Parsed CSV already exists: ${individualCsvPath}`);
          const existingRows = readTransactionsCsv(individualCsvPath);
          createdCsvPaths.push(individualCsvPath);
          totalExtractedRows += existingRows.length;
          continue;
        }

        console.log(`  Parsing statement attachment: ${item.filePath}...`);
        const rows = await parserChain.parse(item.filePath, item.context, bank.parsers);
        if (rows && rows.length > 0) {
          const savedPath = await exportToCsv(rows, individualCsvPath);
          createdCsvPaths.push(savedPath);
          totalExtractedRows += rows.length;
        }
      } catch (err: any) {
        console.error(`Failed to parse attachment ${item.filePath}:`, err.message || err);
      }
    }
  }

  console.log(`\n==================================================`);
  if (createdCsvPaths.length > 0) {
    console.log(`Fetch complete! Extracted/loaded ${totalExtractedRows} total transaction rows across ${createdCsvPaths.length} CSV files.`);
    createdCsvPaths.forEach((p) => console.log(` - ${p}`));
    console.log(`==================================================\n`);
    return paths.transactionsDir;
  } else {
    console.log('Fetch complete! No transactions extracted.');
    console.log(`==================================================\n`);
    return paths.transactionsDir;
  }
}

export async function runClassifyStep(options: {
  month?: string;
  workspace?: string;
  inputPath?: string;
  outputPath?: string;
  rulesPath?: string;
  configPath?: string;
}): Promise<string> {
  const paths = resolveWorkspacePaths({
    workspace: options.workspace,
    month: options.month,
    transactionsCsv: options.inputPath,
    summaryCsv: options.outputPath,
  });

  const targetInput = options.inputPath
    ? path.resolve(process.cwd(), options.inputPath)
    : fs.existsSync(paths.transactionsDir)
      ? paths.transactionsDir
      : paths.transactionsCsvPath;

  console.log(`Reading transactions from: ${targetInput}...`);
  if (!fs.existsSync(targetInput)) {
    throw new Error(`Transactions source not found at: ${targetInput}`);
  }

  const rows = readTransactionsFromPath(targetInput);
  if (rows.length === 0) {
    console.log('No transactions found to classify.');
    return paths.summaryCsvPath;
  }
  console.log(`Loaded ${rows.length} transactions.`);

  const rulesPath = options.rulesPath || 'classification_rules.yaml';
  console.log(`Loading classification rules from: ${rulesPath}...`);
  const classificationConfig = loadClassificationConfig(rulesPath);

  console.log('Classifying and aggregating transactions...');
  const summaryRows = await aggregateTransactions(rows, classificationConfig, {
    configPath: rulesPath,
  });

  const outPath = await exportSummaryCsv(summaryRows, paths.summaryCsvPath);
  console.log(`\n==================================================`);
  console.log(`Classification complete! Generated ${summaryRows.length} summary rows -> ${outPath}`);
  console.log(`==================================================\n`);
  return outPath;
}

export async function runSyncSheetsStep(options: {
  month: string;
  workspace?: string;
  inputPath?: string;
  configPath?: string;
  spreadsheetId?: string;
  sheetName?: string;
  overrideSheet?: boolean;
}): Promise<void> {
  parseYearMonth(options.month);

  const paths = resolveWorkspacePaths({
    workspace: options.workspace,
    month: options.month,
    summaryCsv: options.inputPath,
  });

  const configPath = options.configPath || 'config.yaml';
  const appConfig = fs.existsSync(configPath) ? loadConfig(configPath) : undefined;
  const spreadsheetId = options.spreadsheetId || appConfig?.spreadsheet_id;
  const sheetName = options.sheetName || appConfig?.sheet_name;

  if (!spreadsheetId) {
    throw new Error('Spreadsheet ID must be specified via --spreadsheet-id or in config.yaml under spreadsheet_id');
  }

  console.log(`Reading summary from ${paths.summaryCsvPath}...`);
  if (!fs.existsSync(paths.summaryCsvPath)) {
    throw new Error(`Classified summary CSV not found at: ${paths.summaryCsvPath}`);
  }

  const summaryRows = readSummaryCsv(paths.summaryCsvPath);
  if (summaryRows.length === 0) {
    console.log('No summary rows found to sync.');
    return;
  }
  console.log(`Loaded ${summaryRows.length} summary rows.`);

  console.log(`Syncing to Google Sheets (${spreadsheetId}) for month ${options.month}...`);
  const result = await syncClassifiedSummaryToSheets({
    spreadsheetId,
    yearMonth: options.month,
    sheetName,
    summaryRows,
    overrideSheet: options.overrideSheet,
  });

  console.log(`\n==================================================`);
  console.log(`Google Sheets sync complete!`);
  console.log(`Sheet Tab: ${result.sheetTitle}`);
  console.log(`Target Month: ${result.month}月 (${result.year})`);
  console.log(`Rows Updated: ${result.updatedCount}`);
  console.log(`Rows Inserted: ${result.insertedCount}`);
  console.log(`==================================================\n`);
}

const program = new Command();

program
  .name('expense-fetcher')
  .description('Bank statement and bill email fetcher CLI for expense tracking')
  .version('1.0.0');

program
  .command('auth')
  .description('Authorize CLI access to Gmail and Google Sheets via OAuth2 Desktop flow')
  .action(async () => {
    try {
      console.log('Starting interactive Google OAuth authorization (Gmail + Google Sheets)...');
      await authenticateInteractive();
      console.log('Authentication setup complete.');
    } catch (err: any) {
      console.error('Authentication failed:', err.message || err);
      process.exit(1);
    }
  });

program
  .command('fetch')
  .description('Fetch and parse bank statement emails into transactions CSV')
  .requiredOption('-m, --month <YYYY-MM>', 'Target billing month (e.g. 2026-07)')
  .option('-w, --workspace <dir>', 'Root workspace directory', 'workspace')
  .option('-c, --config <path>', 'Path to YAML configuration file', 'config.yaml')
  .option('-o, --output <path>', 'Path to output transactions CSV (overrides default workspace path)')
  .option('--refetch', 'Force re-fetching attachments from Gmail even if local downloads exist')
  .option('--reparse', 'Force re-parsing statement attachments and overwrite existing CSVs')
  .action(async (options) => {
    try {
      await runFetchStep({
        month: options.month,
        workspace: options.workspace,
        configPath: options.config,
        outputPath: options.output,
        refetch: options.refetch,
        reparse: options.reparse,
      });
    } catch (err: any) {
      console.error('Fetch command failed:', err.message || err);
      process.exit(1);
    }
  });

program
  .command('classify')
  .description('Classify transactions CSV into aggregated expense summary CSV')
  .option('-m, --month <YYYY-MM>', 'Target billing month for workspace path resolution (e.g. 2026-07)')
  .option('-w, --workspace <dir>', 'Root workspace directory', 'workspace')
  .option('-i, --input <path>', 'Path to input transactions CSV (overrides default workspace path)')
  .option('-o, --output <path>', 'Path to output summary CSV (overrides default workspace path)')
  .option('-r, --rules <path>', 'Path to classification rules YAML', 'classification_rules.yaml')
  .option('-c, --config <path>', 'Path to YAML configuration file', 'config.yaml')
  .action(async (options) => {
    try {
      await runClassifyStep({
        month: options.month,
        workspace: options.workspace,
        inputPath: options.input,
        outputPath: options.output,
        rulesPath: options.rules,
        configPath: options.config,
      });
    } catch (err: any) {
      console.error('Classify command failed:', err.message || err);
      process.exit(1);
    }
  });

program
  .command('sync-sheets')
  .description('Sync classified summary CSV into Google Sheets')
  .requiredOption('-m, --month <YYYY-MM>', 'Target billing month (e.g. 2026-07)')
  .option('-w, --workspace <dir>', 'Root workspace directory', 'workspace')
  .option('-i, --input <path>', 'Path to classified summary CSV (overrides default workspace path)')
  .option('-c, --config <path>', 'Path to YAML configuration file', 'config.yaml')
  .option('-s, --spreadsheet-id <id>', 'Google Sheets spreadsheet ID (overrides config.yaml)')
  .option('--sheet-name <name>', 'Specific sheet tab name (overrides config.yaml sheet_name)')
  .option('--override-sheet', 'Override existing cell values and notes in sheet instead of appending')
  .action(async (options) => {
    try {
      await runSyncSheetsStep({
        month: options.month,
        workspace: options.workspace,
        inputPath: options.input,
        configPath: options.config,
        spreadsheetId: options.spreadsheetId,
        sheetName: options.sheetName,
        overrideSheet: options.overrideSheet,
      });
    } catch (err: any) {
      console.error('Sync-sheets command failed:', err.message || err);
      process.exit(1);
    }
  });

program
  .command('run')
  .description('Run end-to-end pipeline: Fetch -> Classify -> Sync to Google Sheets')
  .requiredOption('-m, --month <YYYY-MM>', 'Target billing month (e.g. 2026-07)')
  .option('-w, --workspace <dir>', 'Root workspace directory', 'workspace')
  .option('-c, --config <path>', 'Path to YAML configuration file', 'config.yaml')
  .option('-r, --rules <path>', 'Path to classification rules YAML', 'classification_rules.yaml')
  .option('--transactions-csv <path>', 'Path to transactions CSV (overrides default workspace path)')
  .option('-o, --summary-csv <path>', 'Path to summary CSV (overrides default workspace path)')
  .option('-s, --spreadsheet-id <id>', 'Google Sheets spreadsheet ID (overrides config.yaml)')
  .option('--sheet-name <name>', 'Specific sheet tab name (overrides config.yaml sheet_name)')
  .option('--refetch', 'Force re-fetching attachments from Gmail even if local downloads exist')
  .option('--reparse', 'Force re-parsing statement attachments and overwrite existing CSVs')
  .option('--skip-fetch', 'Skip fetching email attachments and parsing')
  .option('--skip-classify', 'Skip classifying transactions into summary CSV')
  .option('--skip-sheets', 'Skip syncing summary to Google Sheets')
  .option('--override-sheet', 'Override existing cell values and notes in sheet instead of appending')
  .action(async (options) => {
    try {
      console.log(`\n==================================================`);
      console.log(`Starting full pipeline for month: ${options.month}`);
      console.log(`==================================================\n`);

      // 1. Fetch step
      if (!options.skipFetch) {
        console.log(`[Pipeline Step 1/3] Fetching bank statement emails...`);
        await runFetchStep({
          month: options.month,
          workspace: options.workspace,
          configPath: options.config,
          outputPath: options.transactionsCsv,
          refetch: options.refetch,
          reparse: options.reparse,
        });
      } else {
        console.log(`[Pipeline Step 1/3] Skipping fetch step (--skip-fetch).`);
      }

      // 2. Classify step
      if (!options.skipClassify) {
        console.log(`[Pipeline Step 2/3] Classifying and aggregating transactions...`);
        await runClassifyStep({
          month: options.month,
          workspace: options.workspace,
          inputPath: options.transactionsCsv,
          outputPath: options.summaryCsv,
          rulesPath: options.rules,
          configPath: options.config,
        });
      } else {
        console.log(`[Pipeline Step 2/3] Skipping classification step (--skip-classify).`);
      }

      // 3. Sync sheets step
      if (!options.skipSheets) {
        console.log(`[Pipeline Step 3/3] Syncing summary to Google Sheets...`);
        await runSyncSheetsStep({
          month: options.month,
          workspace: options.workspace,
          inputPath: options.summaryCsv,
          configPath: options.config,
          spreadsheetId: options.spreadsheetId,
          sheetName: options.sheetName,
          overrideSheet: options.overrideSheet,
        });
      } else {
        console.log(`[Pipeline Step 3/3] Skipping Google Sheets sync step (--skip-sheets).`);
      }

      console.log(`\n==================================================`);
      console.log(`Full pipeline execution completed successfully!`);
      console.log(`==================================================\n`);
    } catch (err: any) {
      console.error('Pipeline execution failed:', err.message || err);
      process.exit(1);
    }
  });

program.parse(process.argv);
