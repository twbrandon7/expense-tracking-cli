import fs from 'fs';
import pdfParse from 'pdf-parse';
import { BankParser, ParserContext, TransactionRow } from '../types';

export class EsunDebitPdfParser implements BankParser {
  readonly id = 'esun-debit';

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
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

    let currentCard = '';
    let currentSection: 'header' | 'cashback' | 'consumption' | 'footer' = 'header';

    // Regex for card number: 卡號： 5110-XXXX-XXXX-1480
    const cardRegex = /卡號[：:]\s*(?<card>[0-9X\-]+)/i;

    // Foreign transaction: 07/0107/03VULTR BY CONSTANT USA MATAWAN 07/02USD6.35202
    const foreignRegex = /^(?<txDate>\d{2}\/\d{2})(?<deductDate>\d{2}\/\d{2})\s*(?<desc>.+?)\s+(?<fxDate>\d{2}\/\d{2})\s*(?<foreignCur>[A-Z]{3}|NT\$|\$)\s*(?<amounts>[\d,.]+)$/;

    // Cashback line: 08/1008/10DEBIT 基本回饋-4 or -4.00
    const cashbackRegex = /^(?<txDate>\d{2}\/\d{2})(?<deductDate>\d{2}\/\d{2})\s*(?<desc>.+?)\s*-(?<amount>[\d,]+(?:\.\d+)?)$/;

    // Standard transaction line (domestic / fee): 07/0607/09　樂購蝦皮... 908 or 07/0107/03　國外交易服務費3
    const standardRegex = /^(?<txDate>\d{2}\/\d{2})(?<deductDate>\d{2}\/\d{2})\s*(?<desc>.+?)\s*(?<amount>[\d,]+(?:\.\d+)?)$/;

    for (const line of lines) {
      // 1. Detect card number
      const cardMatch = line.match(cardRegex);
      if (cardMatch && cardMatch.groups?.card) {
        currentCard = cardMatch.groups.card.replace(/-/g, '').slice(-4);
        continue;
      }

      // 2. Detect section headers
      if (line.includes('本期回饋金明細')) {
        currentSection = 'cashback';
        continue;
      }
      if (line.includes('本期消費明細')) {
        currentSection = 'consumption';
        continue;
      }
      if (line.includes('本期合計金額') || line.includes('本期回饋金合計') || line.startsWith('※')) {
        continue;
      }

      // Skip lines before table headers
      if (currentSection === 'header') {
        continue;
      }

      // 3. Match Cashback
      if (currentSection === 'cashback') {
        const cbMatch = line.match(cashbackRegex);
        if (cbMatch && cbMatch.groups) {
          const { txDate, desc, amount } = cbMatch.groups;
          const cleanDesc = desc.trim();
          const cleanAmount = parseFloat(amount.replace(/,/g, '')) || 0;
          const formattedDate = this.formatDate(txDate, context.billingPeriod);
          const note = currentCard ? `Card: ${currentCard}` : undefined;

          rows.push({
            transaction_date: formattedDate,
            description: cleanDesc,
            currency: 'TWD',
            amount: cleanAmount,
            type: 'income',
            note,
            parser: this.id,
            source_email_sender: context.emailSender,
            source_email_title: context.emailSubject,
            source_email_id: context.emailId,
          });
          continue;
        }
      }

      // 4. Match Consumption (foreign or standard)
      if (currentSection === 'consumption') {
        // Try foreign regex first
        const foreignMatch = line.match(foreignRegex);
        if (foreignMatch && foreignMatch.groups) {
          const { txDate, desc, fxDate, foreignCur, amounts } = foreignMatch.groups;
          const cleanDesc = desc.trim();
          const { foreignAmt, twdAmt } = this.splitForeignAndTwdAmount(foreignCur, amounts);
          const cleanAmount = parseFloat(twdAmt.replace(/,/g, '')) || 0;
          const formattedDate = this.formatDate(txDate, context.billingPeriod);
          const noteParts: string[] = [];
          if (currentCard) noteParts.push(`Card: ${currentCard}`);
          noteParts.push(`Foreign: ${foreignCur} ${foreignAmt}`);
          if (fxDate) noteParts.push(`FX Date: ${fxDate}`);

          rows.push({
            transaction_date: formattedDate,
            description: cleanDesc,
            currency: 'TWD',
            amount: cleanAmount,
            type: 'expense',
            note: noteParts.join(', '),
            parser: this.id,
            source_email_sender: context.emailSender,
            source_email_title: context.emailSubject,
            source_email_id: context.emailId,
          });
          continue;
        }

        // Try standard regex (domestic or foreign fee)
        const stdMatch = line.match(standardRegex);
        if (stdMatch && stdMatch.groups) {
          const { txDate, desc, amount } = stdMatch.groups;
          const cleanDesc = desc.trim();
          // Filter out header lines that accidentally match
          if (cleanDesc.includes('扣款日') || cleanDesc.includes('消費日') || cleanDesc.includes('合計')) {
            continue;
          }

          const cleanAmount = parseFloat(amount.replace(/,/g, '')) || 0;
          const formattedDate = this.formatDate(txDate, context.billingPeriod);
          const note = currentCard ? `Card: ${currentCard}` : undefined;

          rows.push({
            transaction_date: formattedDate,
            description: cleanDesc,
            currency: 'TWD',
            amount: cleanAmount,
            type: 'expense',
            note,
            parser: this.id,
            source_email_sender: context.emailSender,
            source_email_title: context.emailSubject,
            source_email_id: context.emailId,
          });
          continue;
        }
      }
    }

    if (rows.length === 0) {
      throw new Error(`EsunDebitPdfParser could not extract any transaction rows from ${filePath}`);
    }

    return rows;
  }

  private formatDate(mmdd: string, billingPeriod: { year: number; month: number }): string {
    const [monthStr, dayStr] = mmdd.split('/');
    const txMonth = parseInt(monthStr, 10);
    const txDay = parseInt(dayStr, 10);

    let year = billingPeriod.year;
    // If billing month is January and transaction month is December, transaction was in previous year
    if (billingPeriod.month === 1 && txMonth === 12) {
      year = billingPeriod.year - 1;
    }

    return `${year}-${String(txMonth).padStart(2, '0')}-${String(txDay).padStart(2, '0')}`;
  }

  private splitForeignAndTwdAmount(foreignCur: string, numStr: string): { foreignAmt: string; twdAmt: string } {
    const trimmed = numStr.trim();

    // Case 1: Separated by whitespace
    const spaceParts = trimmed.split(/\s+/);
    if (spaceParts.length >= 2) {
      return { foreignAmt: spaceParts[0], twdAmt: spaceParts[1] };
    }

    // Case 2: Contains decimal point (e.g. "6.35202" -> FX: 6.35, TWD: 202)
    const dotIndex = trimmed.indexOf('.');
    if (dotIndex !== -1) {
      const foreignDecimals = 2;
      const splitIndex = dotIndex + 1 + foreignDecimals;
      return {
        foreignAmt: trimmed.slice(0, splitIndex),
        twdAmt: trimmed.slice(splitIndex),
      };
    }

    // Case 3: Same currency / TWD repetition (e.g. "5656" -> 56 & 56, "7575" -> 75 & 75)
    if (foreignCur.toUpperCase() === 'TWD' || foreignCur.toUpperCase() === 'NT$') {
      const halfLen = Math.floor(trimmed.length / 2);
      const firstHalf = trimmed.slice(0, halfLen);
      const secondHalf = trimmed.slice(halfLen);
      if (firstHalf === secondHalf) {
        return { foreignAmt: firstHalf, twdAmt: secondHalf };
      }
    }

    // Fallback
    return { foreignAmt: trimmed, twdAmt: trimmed };
  }
}
