import fs from 'fs';
import pdfParse from 'pdf-parse';
import { GoogleGenAI } from '@google/genai';
import { BankParser, ParserContext, TransactionRow, TransactionType } from '../types';

interface GeminiResponseItem {
  transaction_date?: string;
  currency?: string;
  amount?: number | string;
  type?: string;
  description?: string;
  note?: string;
}

function validateTransactionType(value?: string): TransactionType {
  const validTypes: TransactionType[] = ['income', 'expense', 'note', 'investment'];
  if (value && validTypes.includes(value as TransactionType)) {
    return value as TransactionType;
  }
  return 'expense';
}

export class GeminiBankParser implements BankParser {
  readonly id = 'gemini';

  async parse(filePath: string, context: ParserContext): Promise<TransactionRow[]> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'Gemini parser requires GEMINI_API_KEY environment variable. Please add it to your .env file or environment variables.'
      );
    }

    if (!fs.existsSync(filePath)) {
      throw new Error(`PDF file not found: ${filePath}`);
    }

    const dataBuffer = fs.readFileSync(filePath);
    let extractedText = '';
    try {
      const pdfSource = context.password ? { data: dataBuffer, password: context.password } : dataBuffer;
      const pdfData = await pdfParse(pdfSource as any);
      extractedText = pdfData.text || '';
    } catch (err: any) {
      console.warn(
        `[Gemini Parser] pdf-parse text extraction failed on ${filePath}: ${err.message || err}. Sending file path as fallback context.`
      );
      extractedText = `File: ${filePath}`;
    }

    const ai = new GoogleGenAI({ apiKey });
    
    const prompt = `
Extract all transaction records from the following bank statement text or bill details.
Return ONLY a valid JSON array of objects with the following keys for each transaction:
- transaction_date: string (YYYY-MM-DD format)
- description: string (summary of store, item, or transaction)
- currency: string (e.g. TWD, USD)
- amount: number
- type: string ("income", "expense", "note", or "investment")
- note: string (optional additional details like card suffix or foreign currency)

Statement Text:
${extractedText.slice(0, 10000)}
`;

    console.log(`[Gemini Parser] Sending request to Gemini API for ${filePath}...`);
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const responseText = response.text || '';
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error(`Gemini parser did not return a valid JSON array. Response: ${responseText}`);
    }

    const parsedArray = JSON.parse(jsonMatch[0]) as GeminiResponseItem[];
    if (!Array.isArray(parsedArray) || parsedArray.length === 0) {
      throw new Error(`Gemini parser returned empty or non-array JSON: ${responseText}`);
    }

    return parsedArray.map((item: GeminiResponseItem) => {
      const cleanAmount = typeof item.amount === 'number' ? item.amount : parseFloat(String(item.amount || '0')) || 0;
      return {
        transaction_date: item.transaction_date || `${context.billingPeriod.year}-${String(context.billingPeriod.month).padStart(2, '0')}-01`,
        description: item.description || context.emailSubject,
        currency: item.currency || 'TWD',
        amount: cleanAmount,
        type: validateTransactionType(item.type),
        note: item.note,
        source_email_sender: context.emailSender,
        source_email_title: context.emailSubject,
        source_email_id: context.emailId,
      };
    });
  }
}
