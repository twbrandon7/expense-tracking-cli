import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { createObjectCsvWriter } from 'csv-writer';
import { ClassifiedSummaryRow, TransactionRow, TransactionType } from '../types';

export function readTransactionsCsv(filePath: string): TransactionRow[] {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Transactions CSV file not found: ${resolvedPath}`);
  }

  const content = fs.readFileSync(resolvedPath, 'utf8');
  if (!content.trim()) {
    return [];
  }

  const records: any[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true
  });

  return records.map((r) => ({
    transaction_date: r.transaction_date || '',
    description: r.description || '',
    currency: r.currency || 'TWD',
    amount: parseFloat(r.amount) || 0,
    type: (r.type as TransactionType) || 'expense',
    note: r.note || '',
    source_email_sender: r.source_email_sender || '',
    source_email_title: r.source_email_title || '',
    source_email_id: r.source_email_id || ''
  }));
}

export async function exportSummaryCsv(
  rows: ClassifiedSummaryRow[],
  outputPath: string
): Promise<string> {
  const resolvedPath = path.resolve(process.cwd(), outputPath);

  const csvWriter = createObjectCsvWriter({
    path: resolvedPath,
    header: [
      { id: 'type', title: 'type' },
      { id: 'sub_type', title: 'sub_type' },
      { id: 'currency', title: 'currency' },
      { id: 'amount', title: 'amount' },
      { id: 'formula', title: 'formula' },
      { id: 'comment', title: 'comment' }
    ]
  });

  await csvWriter.writeRecords(rows);
  return resolvedPath;
}

export function readSummaryCsv(filePath: string): ClassifiedSummaryRow[] {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Summary CSV file not found: ${resolvedPath}`);
  }

  const content = fs.readFileSync(resolvedPath, 'utf8');
  if (!content.trim()) {
    return [];
  }

  const records: any[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true
  });

  return records.map((r) => ({
    type: r.type || '',
    sub_type: r.sub_type || '',
    currency: r.currency || 'TWD',
    amount: parseFloat(r.amount) || 0,
    formula: r.formula || '',
    comment: r.comment || ''
  }));
}

