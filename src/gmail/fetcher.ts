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

function ensureBankDownloadDir(bankId: string, customBaseDir?: string): string {
  const bankDownloadDir = customBaseDir
    ? path.join(customBaseDir, bankId)
    : path.join(process.cwd(), 'downloads', bankId);
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

function calculateSearchWindow(year: number, month: number): { afterDate: string; beforeDate: string } {
  // Start: 3 months before (1st of that month)
  let startYear = year;
  let startMonth = month - 3;
  while (startMonth <= 0) {
    startMonth += 12;
    startYear -= 1;
  }
  const afterDate = `${startYear}/${String(startMonth).padStart(2, '0')}/01`;

  // End: 3 months after (to include the full 3rd month, before 1st of month + 4)
  let endYear = year;
  let endMonth = month + 4;
  while (endMonth > 12) {
    endMonth -= 12;
    endYear += 1;
  }
  const beforeDate = `${endYear}/${String(endMonth).padStart(2, '0')}/01`;

  return { afterDate, beforeDate };
}

export async function fetchBankAttachments(
  authClient: OAuth2Client,
  bank: BankConfig,
  targetYearMonth: { year: number; month: number },
  password?: string,
  downloadsDir?: string
): Promise<FetchedAttachment[]> {
  const gmail = google.gmail({ version: 'v1', auth: authClient });

  if (!bank.enabled) {
    console.log(`Bank ${bank.bank_name} (${bank.bank_id}) is disabled in configuration. Skipping.`);
    return [];
  }

  const { afterDate, beforeDate } = calculateSearchWindow(targetYearMonth.year, targetYearMonth.month);
  const query = `from:${bank.sender} after:${afterDate} before:${beforeDate}`;
  console.log(`Searching Gmail for bank ${bank.bank_name} using query: "${query}"...`);

  const response = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: 50,
  });

  const messages = response.data.messages || [];
  if (messages.length === 0) {
    console.log(`No emails found for sender ${bank.sender} in search window (${afterDate} to ${beforeDate}).`);
    return [];
  }

  // Filter messages by subject pattern and exact billing cycle
  const matchingMessages: Array<{
    msg: gmail_v1.Schema$Message;
    subject: string;
    sender: string;
    extractedPeriod: { year: number; month: number };
  }> = [];

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
      extractedPeriod.year === targetYearMonth.year &&
      extractedPeriod.month === targetYearMonth.month
    ) {
      matchingMessages.push({
        msg: msg.data,
        subject: subjectHeader,
        sender: senderHeader,
        extractedPeriod,
      });
    }
  }

  const targetCycleStr = `${targetYearMonth.year}-${String(targetYearMonth.month).padStart(2, '0')}`;

  if (matchingMessages.length === 0) {
    console.log(`No matching statement email found for billing cycle: ${targetCycleStr} (Bank: ${bank.bank_name})`);
    return [];
  }

  if (matchingMessages.length > 1) {
    throw new Error(
      `Found ${matchingMessages.length} matching emails for bank ${bank.bank_name} (${bank.bank_id}) in billing cycle ${targetCycleStr}. Expected exactly 1. Aborting to avoid ambiguity.`
    );
  }

  const matched = matchingMessages[0];
  const msgId = matched.msg.id!;
  console.log(
    `Found matching email ID ${msgId}: "${matched.subject}" -> Billing Cycle: ${targetCycleStr}`
  );

  const parserContext: ParserContext = {
    bankConfig: bank,
    billingPeriod: matched.extractedPeriod,
    emailSender: matched.sender,
    emailSubject: matched.subject,
    emailId: msgId,
    password,
  };

  const results: FetchedAttachment[] = [];
  const bankDownloadDir = ensureBankDownloadDir(bank.bank_id, downloadsDir);
  const parts = matched.msg.payload?.parts || [];
  const pdfExt = bank.attachment.file_extension || '.pdf';

  for (const part of parts) {
    const filename = part.filename;
    if (filename && filename.toLowerCase().endsWith(pdfExt)) {
      const attachmentId = part.body?.attachmentId;
      const targetFilePath = path.join(bankDownloadDir, `${msgId}_${filename}`);

      // Check if file already exists on disk (disk cache)
      if (fs.existsSync(targetFilePath)) {
        console.log(`  [Cache Hit] File already downloaded: ${targetFilePath}`);
        results.push({ filePath: targetFilePath, context: parserContext });
        continue;
      }

      if (attachmentId) {
        console.log(`  Downloading attachment "${filename}"...`);
        await downloadAttachment(gmail, msgId, attachmentId, targetFilePath);
        results.push({ filePath: targetFilePath, context: parserContext });
      }
    }
  }

  return results;
}
