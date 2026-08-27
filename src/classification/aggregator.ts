import {
  ClassificationConfig,
  ClassifiedSummaryRow,
  CorrelatedTransactionGroup,
  TransactionRow
} from '../types';
import { matchRule, recordLlmRule } from './rules';
import { correlateTransactions } from './correlator';
import { classifyWithGeminiBatch } from './llm';

export interface AggregateOptions {
  configPath?: string;
}

function parseForeignDetail(note?: string, amountTwd?: number): string | null {
  if (!note) return null;
  const foreignMatch = note.match(/Foreign:\s*([A-Za-z]+)\s*([\d.]+)/i);
  if (!foreignMatch) return null;

  const cur = foreignMatch[1].toUpperCase();
  const foreignAmt = parseFloat(foreignMatch[2]);

  if (cur === 'TWD' || isNaN(foreignAmt) || foreignAmt <= 0) {
    return null;
  }

  if (amountTwd && amountTwd > 0) {
    const rate = (amountTwd / foreignAmt).toFixed(2);
    return `${cur} ${foreignAmt} (匯率: ${rate})`;
  }

  return `${cur} ${foreignAmt}`;
}

export async function aggregateTransactions(
  rows: TransactionRow[],
  config: ClassificationConfig,
  options?: AggregateOptions
): Promise<ClassifiedSummaryRow[]> {
  const baseCurrency = config.base_currency || 'TWD';
  const correlatedGroups = correlateTransactions(rows);

  const unclassifiedGroups: CorrelatedTransactionGroup[] = [];

  // Step 1: Match against user rules and LLM rules
  for (const group of correlatedGroups) {
    const desc = group.mainRow.description;

    // Check user rules first
    const userMatch = matchRule(desc, config.user_rules);
    if (userMatch) {
      group.type = userMatch.type;
      group.sub_type = userMatch.sub_type;
      group.source = 'user_rule';
      continue;
    }

    // Check cached LLM rules
    const llmMatch = matchRule(desc, config.llm_rules);
    if (llmMatch) {
      group.type = llmMatch.type;
      group.sub_type = llmMatch.sub_type;
      group.source = 'llm_rule';
      continue;
    }

    // Handle special default cases (e.g. cashback or standalone fee)
    if (group.mainRow.type === 'income') {
      group.type = '非計畫';
      group.sub_type = '回饋/其他收入';
      group.source = 'user_rule';
      continue;
    }

    unclassifiedGroups.push(group);
  }

  // Step 2: Fallback to Gemini LLM for unmatched items
  if (unclassifiedGroups.length > 0) {
    const unclassifiedRows = unclassifiedGroups.map((g) => g.mainRow);
    const geminiResults = await classifyWithGeminiBatch(unclassifiedRows, config);

    for (const group of unclassifiedGroups) {
      const result = geminiResults.get(group.mainRow.description);
      if (result) {
        group.type = result.type;
        group.sub_type = result.sub_type;
        group.source = 'gemini';

        // Persist new LLM rule and taxonomy
        recordLlmRule(
          config,
          {
            pattern: result.pattern || group.mainRow.description,
            type: result.type,
            sub_type: result.sub_type
          },
          options?.configPath
        );
      } else {
        // Fallback when LLM is unavailable or fails
        group.type = '非計畫';
        group.sub_type = '未分類';
        group.source = 'unassigned';
      }
    }
  }

  // Step 3: Group by (type, sub_type)
  const categoryMap = new Map<string, {
    type: string;
    sub_type: string;
    groups: CorrelatedTransactionGroup[];
  }>();

  for (const group of correlatedGroups) {
    const type = group.type || '非計畫';
    const subType = group.sub_type || '未分類';
    const key = `${type}:::${subType}`;

    if (!categoryMap.has(key)) {
      categoryMap.set(key, {
        type,
        sub_type: subType,
        groups: []
      });
    }
    categoryMap.get(key)!.groups.push(group);
  }

  // Step 4: Build summary rows with formula and comment
  const summaryRows: ClassifiedSummaryRow[] = [];

  for (const entry of categoryMap.values()) {
    const formulaParts: string[] = [];
    const commentParts: string[] = [];
    let totalAmount = 0;

    for (const group of entry.groups) {
      const main = group.mainRow;
      const dateShort = main.transaction_date.length >= 10 ? main.transaction_date.substring(5) : main.transaction_date;
      const foreignInfo = parseForeignDetail(main.note, main.amount);

      // Main transaction amount
      if (main.type === 'income') {
        totalAmount -= main.amount;
        formulaParts.push(`-${main.amount}`);
        commentParts.push(`${dateShort} ${main.description} (-$${main.amount})`);
      } else {
        totalAmount += main.amount;
        formulaParts.push(`${main.amount}`);
        const fxStr = foreignInfo ? ` (${foreignInfo})` : '';
        commentParts.push(`${dateShort} ${main.description} ($${main.amount}${fxStr})`);
      }

      // Add attached fees
      for (const fee of group.feeRows) {
        totalAmount += fee.amount;
        formulaParts.push(`${fee.amount}`);
        commentParts.push(`+手續費 $${fee.amount}`);
      }

      // Subtract attached refunds
      for (const refund of group.refundRows) {
        totalAmount -= refund.amount;
        formulaParts.push(`-${refund.amount}`);
        const refundDate = refund.transaction_date.length >= 10 ? refund.transaction_date.substring(5) : refund.transaction_date;
        commentParts.push(`-退款 $${refund.amount} (${refundDate})`);
      }
    }

    // Construct formula string
    let formula = formulaParts.join(' + ').replace(/\+\s*-/g, '- ');
    if (formulaParts.length === 1 && !formula.startsWith('-')) {
      formula = `${formulaParts[0]}`;
    }

    summaryRows.push({
      type: entry.type,
      sub_type: entry.sub_type,
      currency: baseCurrency,
      amount: totalAmount,
      formula: formula || '0',
      comment: commentParts.join('; ')
    });
  }

  // Step 5: Sort summary rows: "計畫" first, then "非計畫"
  const typeOrder = ['計畫', '非計畫'];
  summaryRows.sort((a, b) => {
    const orderA = typeOrder.indexOf(a.type);
    const orderB = typeOrder.indexOf(b.type);
    const idxA = orderA === -1 ? 99 : orderA;
    const idxB = orderB === -1 ? 99 : orderB;

    if (idxA !== idxB) {
      return idxA - idxB;
    }
    return a.sub_type.localeCompare(b.sub_type, 'zh-TW');
  });

  return summaryRows;
}
