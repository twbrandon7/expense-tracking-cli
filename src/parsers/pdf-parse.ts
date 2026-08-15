import fs from 'fs';
import pdfParse from 'pdf-parse';
import { BankParser, ParserContext, TransactionRow } from '../types';

export class PdfParseBankParser implements BankParser {
  readonly id = 'pdf-parse';

  async parse(filePath: string, context: ParserContext): Promise<TransactionRow[]> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`PDF file not found: ${filePath}`);
    }

    const dataBuffer = fs.readFileSync(filePath);
    const pdfSource = context.password ? { data: dataBuffer, password: context.password } : dataBuffer;
    const pdfData = await pdfParse(pdfSource as any);
    const text = pdfData.text;

    if (!text || text.trim().length === 0) {
      throw new Error(`pdf-parse extracted empty text from ${filePath}`);
    }

    const rows: TransactionRow[] = [];
    const lines = text.split('\n');

    // Standard regex pattern for matching statement lines: YYYY/MM/DD Description Amount
    const transactionRegex = /(?<date>\d{4}[\/-]\d{1,2}[\/-]\d{1,2})\s+(?<description>.+?)\s+(?<currency>TWD|USD|NT\$|\$)?\s*(?<amount>[\d,]+(\.\d{1,2})?)/i;

    for (const line of lines) {
      const match = line.trim().match(transactionRegex);
      if (match && match.groups) {
        const { date, description, currency, amount } = match.groups;
        const cleanAmount = parseFloat(amount.replace(/,/g, ''));

        if (!isNaN(cleanAmount)) {
          rows.push({
            transaction_date: date.replace(/\//g, '-'),
            currency: currency || 'TWD',
            amount: cleanAmount,
            type: 'expense',
            source_email_sender: context.emailSender,
            source_email_summary: description.trim() || context.emailSubject,
            source_email_id: context.emailId,
          });
        }
      }
    }

    if (rows.length === 0) {
      throw new Error(`pdf-parse failed to match structured transaction rows in ${filePath}`);
    }

    return rows;
  }
}
