import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { createObjectCsvWriter } from 'csv-writer';
import { TransactionRow } from '../types';

function createRowKey(row: {
  source_email_id?: string;
  transaction_date?: string;
  amount?: number | string;
  currency?: string;
  source_email_summary?: string;
}): string {
  return `${row.source_email_id || ''}#${row.transaction_date || ''}#${row.amount || ''}#${row.currency || ''}#${row.source_email_summary || ''}`;
}

function loadExistingKeyCounts(filePath: string): Map<string, number> {
  const counts = new Map<string, number>();
  if (!fs.existsSync(filePath)) {
    return counts;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.trim()) {
    return counts;
  }

  try {
    const records: Array<{
      transaction_date: string;
      currency: string;
      amount: string;
      type: string;
      source_email_sender: string;
      source_email_summary: string;
      source_email_id: string;
    }> = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    for (const record of records) {
      const key = createRowKey(record);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  } catch (err: any) {
    console.warn(`[CSV Storage] Error parsing existing CSV at ${filePath}: ${err.message}. Treating file as empty.`);
  }

  return counts;
}

export async function exportToCsv(rows: TransactionRow[], outputPath?: string): Promise<string> {
  const filePath = path.resolve(process.cwd(), outputPath || 'transactions.csv');
  const fileExists = fs.existsSync(filePath);

  const existingCounts = loadExistingKeyCounts(filePath);
  const currentKeyOccurrences = new Map<string, number>();
  const newRows: TransactionRow[] = [];

  for (const row of rows) {
    const key = createRowKey(row);
    const seenInBatch = currentKeyOccurrences.get(key) || 0;
    const existingCount = existingCounts.get(key) || 0;

    if (seenInBatch >= existingCount) {
      newRows.push(row);
    }

    currentKeyOccurrences.set(key, seenInBatch + 1);
  }

  if (newRows.length === 0) {
    console.log(`All ${rows.length} records already exist in ${filePath}. Skipped duplicate insertion.`);
    return filePath;
  }

  const csvWriter = createObjectCsvWriter({
    path: filePath,
    header: [
      { id: 'transaction_date', title: 'transaction_date' },
      { id: 'currency', title: 'currency' },
      { id: 'amount', title: 'amount' },
      { id: 'type', title: 'type' },
      { id: 'source_email_sender', title: 'source_email_sender' },
      { id: 'source_email_summary', title: 'source_email_summary' },
      { id: 'source_email_id', title: 'source_email_id' },
    ],
    append: fileExists,
  });

  await csvWriter.writeRecords(newRows);
  console.log(`Successfully written ${newRows.length} new transaction records to ${filePath}`);
  return filePath;
}
