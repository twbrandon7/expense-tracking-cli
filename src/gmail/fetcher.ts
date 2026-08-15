import fs from 'fs';
import path from 'path';
import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from '../auth/gmail-auth';
import { BankConfig, ParserContext } from '../types';
import { extractBillingPeriod } from '../config';

export interface FetchedAttachment {
  filePath: string;
  context: ParserContext;
}

function ensureBankDownloadDir(bankId: string): string {
  const bankDownloadDir = path.join(process.cwd(), 'downloads', bankId);
  if (!fs.existsSync(bankDownloadDir)) {
    fs.mkdirSync(bankDownloadDir, { recursive: true });
  }
  return bankDownloadDir;
}

async function downloadAttachment(
  gmail: gmail_v1.Gmail,
  messageId: string,
  attachmentId: string,
  targetFilePath: string
): Promise<void> {
  const attachRes = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId,
  });

  const dataBase64 = attachRes.data.data;
  if (dataBase64) {
    const buffer = Buffer.from(dataBase64, 'base64url');
    fs.writeFileSync(targetFilePath, buffer);
    console.log(`  Saved attachment to ${targetFilePath}`);
  }
}

export async function fetchBankAttachments(
  authClient: OAuth2Client,
  bank: BankConfig,
  targetYearMonth?: { year: number; month: number }
): Promise<FetchedAttachment[]> {
  const gmail = google.gmail({ version: 'v1', auth: authClient });

  if (!bank.enabled) {
    console.log(`Bank ${bank.bank_name} (${bank.bank_id}) is disabled in configuration. Skipping.`);
    return [];
  }

  const query = `from:${bank.sender}`;
  console.log(`Searching Gmail for bank ${bank.bank_name} using query: "${query}"...`);

  const response = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: 50,
  });

  const messages = response.data.messages || [];
  if (messages.length === 0) {
    console.log(`No emails found for sender: ${bank.sender}`);
    return [];
  }

  const results: FetchedAttachment[] = [];
  const bankDownloadDir = ensureBankDownloadDir(bank.bank_id);

  for (const msgRef of messages) {
    if (!msgRef.id) continue;

    const msg = await gmail.users.messages.get({
      userId: 'me',
      id: msgRef.id,
      format: 'full',
    });

    const headers = msg.data.payload?.headers || [];
    const subjectHeader = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value || '';
    const senderHeader = headers.find((h) => h.name?.toLowerCase() === 'from')?.value || bank.sender;

    const extractedPeriod = extractBillingPeriod(subjectHeader, bank);
    if (!extractedPeriod) {
      continue;
    }

    if (
      targetYearMonth &&
      (extractedPeriod.year !== targetYearMonth.year || extractedPeriod.month !== targetYearMonth.month)
    ) {
      continue;
    }

    console.log(
      `Found matching email ID ${msgRef.id}: "${subjectHeader}" -> Billing Cycle: ${extractedPeriod.year}-${String(
        extractedPeriod.month
      ).padStart(2, '0')}`
    );

    const parserContext: ParserContext = {
      bankConfig: bank,
      billingPeriod: extractedPeriod,
      emailSender: senderHeader,
      emailSubject: subjectHeader,
      emailId: msgRef.id,
    };

    const parts = msg.data.payload?.parts || [];
    const pdfExt = bank.attachment.file_extension || '.pdf';

    for (const part of parts) {
      const filename = part.filename;
      if (filename && filename.toLowerCase().endsWith(pdfExt)) {
        const attachmentId = part.body?.attachmentId;
        const targetFilePath = path.join(bankDownloadDir, `${msgRef.id}_${filename}`);

        // Check if file already exists on disk (disk cache)
        if (fs.existsSync(targetFilePath)) {
          console.log(`  [Cache Hit] File already downloaded: ${targetFilePath}`);
          results.push({ filePath: targetFilePath, context: parserContext });
          continue;
        }

        if (attachmentId) {
          console.log(`  Downloading attachment "${filename}"...`);
          await downloadAttachment(gmail, msgRef.id, attachmentId, targetFilePath);
          results.push({ filePath: targetFilePath, context: parserContext });
        }
      }
    }
  }

  return results;
}
