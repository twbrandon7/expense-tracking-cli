import fs from 'fs';
import zlib from 'zlib';
import pdfParse from 'pdf-parse';
import { GoogleGenAI } from '@google/genai';
import { BankParser, ParserContext, TransactionRow } from '../types';

function crc32(buf: Buffer): number {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const len = data.length;
  const chunk = Buffer.alloc(8 + len + 4);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const typeAndData = chunk.slice(4, 8 + len);
  const crc = crc32(typeAndData);
  chunk.writeUInt32BE(crc, 8 + len);
  return chunk;
}

function monochromeToPng(width: number, height: number, data: Uint8Array): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(1, 8);
  ihdrData.writeUInt8(0, 9);
  ihdrData.writeUInt8(0, 10);
  ihdrData.writeUInt8(0, 11);
  ihdrData.writeUInt8(0, 12);
  const ihdrChunk = makePngChunk('IHDR', ihdrData);

  const rowBytes = Math.ceil(width / 8);
  const rawScanlines = Buffer.alloc((1 + rowBytes) * height);

  let srcOffset = 0;
  let dstOffset = 0;
  for (let y = 0; y < height; y++) {
    rawScanlines[dstOffset++] = 0;
    for (let x = 0; x < rowBytes; x++) {
      rawScanlines[dstOffset++] = data[srcOffset++];
    }
  }

  const compressed = zlib.deflateSync(rawScanlines);
  const idatChunk = makePngChunk('IDAT', compressed);
  const iendChunk = makePngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

interface RawLineItem {
  pageIndex: number;
  y: number;
  txDate?: string;
  postDate?: string;
  textDesc?: string;
  imagePng?: Buffer;
  amountStr?: string;
  cardSuffix?: string;
  country?: string;
  fxDate?: string;
  foreignCur?: string;
  foreignAmt?: string;
}

export class CtbcCreditPdfParser implements BankParser {
  readonly id = 'ctbc-credit';

  async parse(filePath: string, context: ParserContext): Promise<TransactionRow[]> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`PDF file not found: ${filePath}`);
    }

    const dataBuffer = fs.readFileSync(filePath);
    const password = context.password;

    const rawRows: Record<string, RawLineItem> = {};

    const getOrCreateRow = (pageIndex: number, y: number): RawLineItem => {
      const existingKey = Object.keys(rawRows).find((k) => {
        const [p, rowY] = k.split('_').map(Number);
        return p === pageIndex && Math.abs(rowY - y) <= 4;
      });
      if (existingKey) {
        return rawRows[existingKey];
      }
      const newKey = `${pageIndex}_${y}`;
      const newRow: RawLineItem = { pageIndex, y };
      rawRows[newKey] = newRow;
      return newRow;
    };

    if (typeof (global as any).Image === 'undefined') {
      (global as any).Image = class Image {};
    }

    const renderPage = async (pageData: any) => {
      const pageIndex = pageData.pageIndex;
      const textContent = await pageData.getTextContent();
      const items = textContent.items || [];

      // Check if page contains transaction dates
      const hasTransactions = items.some((item: any) => {
        const x = Math.round(item.transform[4]);
        const y = Math.round(item.transform[5]);
        return x >= 10 && x <= 25 && y >= 650 && y <= 910 && /^\d{3}\/\d{2}\/\d{2}$/.test(item.str.trim());
      });

      if (!hasTransactions) {
        return '';
      }

      for (const item of items) {
        const x = Math.round(item.transform[4]);
        const y = Math.round(item.transform[5]);
        if (y < 650 || y > 910) continue;

        const row = getOrCreateRow(pageIndex, y);
        const str = item.str.trim();
        if (!str) continue;

        if (x >= 10 && x <= 25 && /^\d{3}\/\d{2}\/\d{2}$/.test(str)) {
          row.txDate = str;
        } else if (x >= 55 && x <= 75 && /^\d{3}\/\d{2}\/\d{2}$/.test(str)) {
          row.postDate = str;
        } else if (x >= 260 && x <= 305 && /^-?[\d,]+(\.\d+)?$/.test(str)) {
          row.amountStr = str;
        } else if (x >= 315 && x <= 340 && /^\d{4}$/.test(str)) {
          row.cardSuffix = str;
        } else if (x >= 370 && x <= 390 && /^[A-Z]{2}$/.test(str)) {
          row.country = str;
        } else if (x >= 415 && x <= 440 && /^\d{2}\/\d{2}$/.test(str)) {
          row.fxDate = str;
        } else if (x >= 460 && x <= 490 && /^[A-Z]{3}$/.test(str)) {
          row.foreignCur = str;
        } else if (x >= 530 && x <= 580 && /^[\d,]+(\.\d+)?$/.test(str)) {
          row.foreignAmt = str;
        } else if (x >= 110 && x <= 250) {
          row.textDesc = row.textDesc ? `${row.textDesc} ${str}` : str;
        }
      }

      try {
        const opList = await pageData.getOperatorList();
        let currentMatrix = [1, 0, 0, 1, 0, 0];
        for (let i = 0; i < opList.fnArray.length; i++) {
          const fn = opList.fnArray[i];
          const args = opList.argsArray[i];
          if (fn === 11 || fn === 12) {
            currentMatrix = args;
          }
          if (fn === 83) {
            const img = args[0];
            const x = Math.round(currentMatrix[4] || 0);
            const y = Math.round(currentMatrix[5] || 0);
            if (x >= 115 && x <= 140 && y >= 600 && y <= 910 && img.width && img.height && img.data) {
              const png = monochromeToPng(img.width, img.height, img.data);
              const row = getOrCreateRow(pageIndex, y);
              row.imagePng = png;
            }
          }
        }
      } catch (err: any) {
        console.warn(`[CtbcCreditPdfParser] Operator list extraction warning on page ${pageIndex + 1}: ${err.message || err}`);
      }

      return '';
    };

    const pdfSource = password ? { data: dataBuffer, password } : dataBuffer;
    await (pdfParse as any)(pdfSource, { pagerender: renderPage });

    const lines = Object.values(rawRows)
      .filter((r) => r.amountStr && r.txDate)
      .sort((a, b) => {
        if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
        return b.y - a.y;
      });

    if (lines.length === 0) {
      throw new Error(`CtbcCreditPdfParser could not extract any transaction lines from ${filePath}`);
    }

    const imagesToOcr: Array<{ lineIndex: number; png: Buffer }> = [];
    lines.forEach((l, idx) => {
      if (l.imagePng) {
        imagesToOcr.push({ lineIndex: idx, png: l.imagePng });
      }
    });

    if (imagesToOcr.length > 0) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.warn(
          '[CtbcCreditPdfParser] GEMINI_API_KEY is not set. Chinese merchant names rendered as bitmap images cannot be OCR-transcribed.'
        );
      } else {
        try {
          const ai = new GoogleGenAI({ apiKey });
          const contents: any[] = [
            'You are an OCR assistant for a Taiwan credit card statement. Transcribe the exact merchant name from each labeled image snippet below. Return ONLY a JSON object mapping each image ID to its merchant string, e.g. {"img_0": "Merchant A", "img_1": "Merchant B"}.'
          ];
          for (let i = 0; i < imagesToOcr.length; i++) {
            const img = imagesToOcr[i];
            contents.push(`Image ID: img_${i}`);
            contents.push({
              inlineData: {
                mimeType: 'image/png',
                data: img.png.toString('base64'),
              },
            });
          }

          console.log(`[CtbcCreditPdfParser] Calling Gemini (gemini-2.5-flash) to OCR ${imagesToOcr.length} merchant images...`);
          const res = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents,
          });

          const jsonMatch = res.text?.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const ocrMap: Record<string, string> = JSON.parse(jsonMatch[0]);
            imagesToOcr.forEach((img, i) => {
              const id = `img_${i}`;
              if (ocrMap[id]) {
                lines[img.lineIndex].textDesc = ocrMap[id];
              }
            });
          }
        } catch (err: any) {
          console.warn(`[CtbcCreditPdfParser] Gemini OCR failed: ${err.message || err}. Falling back to default descriptions.`);
        }
      }
    }

    const rows: TransactionRow[] = [];
    for (const line of lines) {
      const rawAmt = parseFloat((line.amountStr || '0').replace(/,/g, ''));
      const isNegative = rawAmt < 0;
      const amount = Math.abs(rawAmt);
      const type = isNegative ? 'income' : 'expense';

      const [rocY, mm, dd] = (line.txDate || '115/01/01').split('/');
      const ceYear = parseInt(rocY, 10) + 1911;
      const formattedDate = `${ceYear}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;

      let desc = line.textDesc?.trim() || '';
      if (!desc && amount <= 50 && !line.country && !line.imagePng) {
        desc = '國外交易手續費';
      } else if (!desc) {
        desc = 'CTBC Transaction';
      }

      const noteParts: string[] = [];
      if (line.cardSuffix) noteParts.push(`Card: ${line.cardSuffix}`);
      if (line.foreignCur && line.foreignAmt) noteParts.push(`Foreign: ${line.foreignCur} ${line.foreignAmt}`);
      if (line.fxDate) noteParts.push(`FX Date: ${line.fxDate}`);

      rows.push({
        transaction_date: formattedDate,
        description: desc,
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

    return rows;
  }
}
