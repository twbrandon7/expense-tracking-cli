import fs from 'fs';
import pdfParse from 'pdf-parse';
import { BankParser, ParserContext, TransactionRow } from '../types';

interface RawItem {
  pageIndex: number;
  x: number;
  y: number;
  str: string;
}

export class EsunStatementPdfParser implements BankParser {
  readonly id = 'esun-statement';

  async parse(filePath: string, context: ParserContext): Promise<TransactionRow[]> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`PDF file not found: ${filePath}`);
    }

    const dataBuffer = fs.readFileSync(filePath);
    const pages: RawItem[][] = [];

    const pdfSource = context.password
      ? { data: dataBuffer, password: context.password }
      : dataBuffer;

    await (pdfParse as any)(pdfSource, {
      pagerender: async (pageData: any) => {
        const textContent = await pageData.getTextContent();
        const items: RawItem[] = [];
        for (const item of textContent.items || []) {
          const str = (item.str || '').trim();
          if (str) {
            const x = Math.round(item.transform[4]);
            const y = Math.round(item.transform[5]);
            items.push({ pageIndex: pageData.pageIndex, x, y, str });
          }
        }
        pages.push(items);
        return '';
      },
    });

    const rows: TransactionRow[] = [];
    let currentAccount = '';

    for (let p = 0; p < pages.length; p++) {
      const items = pages[p];

      // Cluster items into lines by Y coordinate within +/- 3 points tolerance
      const rowMap: Record<number, RawItem[]> = {};
      for (const item of items) {
        const existingY = Object.keys(rowMap)
          .map(Number)
          .find((y) => Math.abs(y - item.y) <= 3);
        const targetY = existingY !== undefined ? existingY : item.y;
        if (!rowMap[targetY]) rowMap[targetY] = [];
        rowMap[targetY].push(item);
      }

      const sortedYs = Object.keys(rowMap)
        .map(Number)
        .sort((a, b) => b - a);

      for (const y of sortedYs) {
        const rowItems = rowMap[y].sort((a, b) => a.x - b.x);
        const rowText = rowItems.map((i) => i.str).join(' ');

        // Detect account section header: e.g. "銀行帳號 0015976***604"
        const accMatch = rowText.match(/銀行帳號\s*([0-9*]+)/);
        if (accMatch) {
          currentAccount = accMatch[1];
          continue;
        }

        // Transaction date column at x ~ 30-45 (e.g. 115/07/03)
        const dateItem = rowItems.find(
          (i) => i.x >= 30 && i.x <= 45 && /^\d{2,3}\/\d{2}\/\d{2}$/.test(i.str)
        );
        if (!dateItem) continue;

        const txDateStr = dateItem.str;
        const formattedDate = this.formatRocDate(txDateStr, context.billingPeriod);

        // Description / Summary column at x ~ 70-160
        const descItems = rowItems.filter((i) => i.x >= 70 && i.x <= 160);
        const rawDesc = descItems.map((i) => i.str).join('').trim();

        // Withdrawal amount column at x ~ 180-235
        const withdrawItem = rowItems.find(
          (i) => i.x >= 180 && i.x <= 235 && /^[\d,]+(\.\d+)?$/.test(i.str)
        );

        // Deposit amount column at x ~ 270-310
        const depositItem = rowItems.find(
          (i) => i.x >= 270 && i.x <= 310 && /^[\d,]+(\.\d+)?$/.test(i.str)
        );

        if (!withdrawItem && !depositItem) {
          continue;
        }

        // Remark / Beneficiary column at x ~ 315-375
        const remarkItems = rowItems.filter(
          (i) => i.x >= 315 && i.x <= 375 && !/^[\d,]+(\.\d+)?$/.test(i.str)
        );
        const remark = remarkItems.map((i) => i.str).join('').trim();

        // Counterparty column at x ~ 380-510
        const cpItems = rowItems.filter((i) => i.x >= 380 && i.x <= 510);
        let counterparty = cpItems.map((i) => i.str).join(' ').trim();

        // Code/account formatted remarks placed at x ~ 315-335 (e.g. "28518076", "3*0-1202004061")
        const codeRemark = rowItems.find(
          (i) => i.x >= 315 && i.x <= 335 && (/^\d+$/.test(i.str) || /^\d+\*\d+/.test(i.str))
        );
        if (codeRemark && !counterparty) {
          counterparty = codeRemark.str;
        }

        const isDeposit = Boolean(depositItem);
        const rawAmountStr = isDeposit ? depositItem!.str : withdrawItem!.str;
        const amount = parseFloat(rawAmountStr.replace(/,/g, '')) || 0;
        const type = isDeposit ? 'income' : 'expense';

        // Compose meaningful description
        let description = rawDesc;
        if (remark && !remark.includes('Ｄ*卡')) {
          description = `${rawDesc} ${remark}`;
        }

        // Compose note with account and counterparty/remark metadata
        const noteParts: string[] = [];
        if (currentAccount) {
          noteParts.push(`Account: ${currentAccount}`);
        }
        if (remark && !description.includes(remark)) {
          noteParts.push(`Remark: ${remark}`);
        }
        if (counterparty) {
          noteParts.push(`Counterparty: ${counterparty}`);
        }

        rows.push({
          transaction_date: formattedDate,
          description,
          currency: 'TWD',
          amount,
          type,
          note: noteParts.length > 0 ? noteParts.join(', ') : undefined,
          parser: this.id,
          source_email_sender: context.emailSender,
          source_email_title: context.emailSubject,
          source_email_id: context.emailId,
        });
      }
    }

    if (rows.length === 0) {
      throw new Error(`EsunStatementPdfParser could not extract any transaction rows from ${filePath}`);
    }

    return rows;
  }

  private formatRocDate(
    rocDateStr: string,
    billingPeriod: { year: number; month: number }
  ): string {
    const parts = rocDateStr.split('/');
    if (parts.length === 3) {
      const rocYear = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      const day = parseInt(parts[2], 10);
      const ceYear = rocYear + 1911;
      return `${ceYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    if (parts.length === 2) {
      const month = parseInt(parts[0], 10);
      const day = parseInt(parts[1], 10);
      let year = billingPeriod.year;
      if (billingPeriod.month === 1 && month === 12) {
        year = billingPeriod.year - 1;
      }
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    return rocDateStr;
  }
}
