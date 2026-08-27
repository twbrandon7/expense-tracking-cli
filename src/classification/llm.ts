import { GoogleGenAI } from '@google/genai';
import { ClassificationConfig, ClassificationRule, TransactionRow } from '../types';
import { extractTaxonomy } from './rules';

export interface LlmClassificationResult {
  description: string;
  type: string;
  sub_type: string;
  pattern: string;
}

export async function classifyWithGeminiBatch(
  unclassifiedRows: TransactionRow[],
  config: ClassificationConfig
): Promise<Map<string, LlmClassificationResult>> {
  const apiKey = process.env.GEMINI_API_KEY;
  const resultMap = new Map<string, LlmClassificationResult>();

  if (!apiKey || apiKey.trim().length === 0) {
    console.warn('GEMINI_API_KEY not found in environment. Skipping Gemini LLM fallback.');
    return resultMap;
  }

  // Deduplicate descriptions to minimize API calls
  const uniqueItemsMap = new Map<string, TransactionRow>();
  for (const row of unclassifiedRows) {
    if (!uniqueItemsMap.has(row.description)) {
      uniqueItemsMap.set(row.description, row);
    }
  }

  const items = Array.from(uniqueItemsMap.values()).map((row) => ({
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    note: row.note || ''
  }));

  if (items.length === 0) {
    return resultMap;
  }

  const ai = new GoogleGenAI({ apiKey });
  const taxonomy = extractTaxonomy(config);
  const knownTypes = Object.keys(taxonomy);
  const typesDesc = knownTypes.length > 0
    ? knownTypes.map((t) => `"${t}"`).join(' or ')
    : '"計畫" or "非計畫"';

  const systemInstruction = `You are a financial transaction classifier for personal expense tracking.
Your task is to classify transaction expense items into category types (${typesDesc}).

Current Taxonomy:
${JSON.stringify(taxonomy, null, 2)}

Instructions:
1. For each input item, assign a top-level category type (${typesDesc}, or create a logical new type if needed).
2. Assign a "sub_type":
   - Use an existing sub_type from the taxonomy if it matches well.
   - If none of the existing sub_types fit the transaction, create a concise, logical new sub_type in Traditional Chinese (e.g., "交通/高鐵", "日用品", "醫療/看診", "旅行/住宿", "娛樂", "百貨購物").
3. Provide a "pattern": extract the most distinct keyword/substring from the description (e.g. merchant name without payment prefixes like '連加**', '連支**', 'GOOGLE*') to use as a future matching rule.
4. Respond ONLY with valid JSON array containing objects with keys: "description", "type", "sub_type", "pattern". No markdown formatting or explanation outside JSON.`;

  try {
    const prompt = `Classify the following transactions:\n${JSON.stringify(items, null, 2)}`;
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json'
      }
    });

    const responseText = response.text?.trim() || '';
    if (!responseText) {
      return resultMap;
    }

    const parsed: LlmClassificationResult[] = JSON.parse(responseText);
    for (const item of parsed) {
      if (item && item.description && item.type && item.sub_type && item.pattern) {
        resultMap.set(item.description, item);
      }
    }
  } catch (err: any) {
    console.error('Gemini classification error:', err.message || err);
  }

  return resultMap;
}
