import { TransactionClassifier, TransactionRow } from '../../types';

export function parseNoteMetadata(note?: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!note) return result;

  const parts = note.split(/,\s*(?=[A-Za-z]+:\s*)/);
  for (const part of parts) {
    const match = part.match(/^([A-Za-z]+):\s*(.*)$/);
    if (match) {
      const key = match[1].toLowerCase();
      result[key] = match[2].trim();
    }
  }
  return result;
}

export function matchStringOrRegex(input: string, pattern: string, isRegex?: boolean): boolean {
  if (!input || !pattern) return false;

  if (isRegex) {
    try {
      const regex = new RegExp(pattern, 'i');
      return regex.test(input);
    } catch {
      return input.toLowerCase().includes(pattern.toLowerCase());
    }
  }

  return input.toLowerCase().includes(pattern.toLowerCase());
}
