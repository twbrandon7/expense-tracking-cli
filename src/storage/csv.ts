import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { createObjectCsvWriter } from 'csv-writer';
import { TransactionRow } from '../types';

function createRowKey(row: {
  source_email_id?: string;
  transaction_date?: string;
  description?: string;
  amount?: number | string;
  currency?: string;
  note?: string;
}): string {
  return `${row.source_email_id || ''}#${row.transaction_date || ''}#${row.description || ''}#${row.amount || ''}#${row.currency || ''}#${row.note || ''}`;
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
      description?: string;
      currency: string;
      amount: string;
      type: string;
      note?: string;
      source_email_sender: string;
      source_email_title?: string;
      source_email_summary?: string;
      source_email_id: string;
    }> = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    for (const record of records) {
      const key = createRowKey({
        source_email_id: record.source_email_id,
        transaction_date: record.transaction_date,
        description: record.description || record.source_email_summary,
        amount: record.amount,
        currency: record.currency,
        note: record.note,
      });
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
      { id: 'description', title: 'description' },
      { id: 'currency', title: 'currency' },
      { id: 'amount', title: 'amount' },
      { id: 'type', title: 'type' },
      { id: 'note', title: 'note' },
      { id: 'source_email_sender', title: 'source_email_sender' },
      { id: 'source_email_title', title: 'source_email_title' },
      { id: 'source_email_id', title: 'source_email_id' },
    ],
    append: fileExists,
  });

  await csvWriter.writeRecords(newRows);
  console.log(`Successfully written ${newRows.length} new transaction records to ${filePath}`);
  return filePath;
}
