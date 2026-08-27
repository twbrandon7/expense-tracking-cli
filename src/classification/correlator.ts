import { CorrelatedTransactionGroup, TransactionRow } from '../types';

export function isFeeRow(row: TransactionRow): boolean {
  const desc = row.description.trim();
  return (
    desc.includes('國外交易服務費') ||
    desc.includes('國外交易手續費') ||
    desc.includes('海外交易手續費') ||
    desc.includes('國外手續費')
  );
}

export function isForeignExpense(row: TransactionRow): boolean {
  if (row.type !== 'expense') return false;
  const note = row.note || '';
  return note.includes('Foreign:') || row.currency !== 'TWD';
}

export function extractCardNumber(note?: string): string | null {
  if (!note) return null;
  const match = note.match(/Card:\s*([A-Za-z0-9]+)/i);
  return match ? match[1] : null;
}

export function normalizeDescription(desc: string): string {
  return desc
    .replace(/^連[加支]\*+/i, '')
    .replace(/^GOOGLE\*/i, '')
    .replace(/[＿_－-]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Group raw transactions into correlated groups (Main transaction + attached foreign fees + attached refunds).
 */
export function correlateTransactions(rows: TransactionRow[]): CorrelatedTransactionGroup[] {
  const groups: CorrelatedTransactionGroup[] = [];
  const handledIndices = new Set<number>();

  // Pass 1: Build main expense groups and pair immediately subsequent/associated fees
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (handledIndices.has(i)) continue;

    if (row.type === 'expense' && !isFeeRow(row)) {
      const group: CorrelatedTransactionGroup = {
        mainRow: row,
        feeRows: [],
        refundRows: []
      };
      handledIndices.add(i);

      // Check if next row(s) is a fee for this transaction
      if (isForeignExpense(row) || row.currency !== 'TWD') {
        const mainCard = extractCardNumber(row.note);
        for (let j = i + 1; j < rows.length; j++) {
          if (handledIndices.has(j)) continue;
          const candidate = rows[j];
          if (isFeeRow(candidate)) {
            const feeCard = extractCardNumber(candidate.note);
            const cardMatches = !mainCard || !feeCard || mainCard === feeCard;
            const senderMatches = candidate.source_email_id === row.source_email_id;
            
            // Pair if same sender/statement and card
            if (cardMatches && senderMatches) {
              group.feeRows.push(candidate);
              handledIndices.add(j);
              break; // Pair at most one direct fee per foreign item in sequence
            }
          } else if (candidate.type === 'expense' && !isFeeRow(candidate)) {
            // Stop searching if encountered another normal expense
            break;
          }
        }
      }

      groups.push(group);
    }
  }

  // Pass 2: Correlate refund income rows
  for (let i = 0; i < rows.length; i++) {
    if (handledIndices.has(i)) continue;
    const row = rows[i];

    if (row.type === 'income') {
      const normDesc = normalizeDescription(row.description);
      // Find matching main expense group
      let matchedGroup: CorrelatedTransactionGroup | null = null;

      for (const group of groups) {
        const groupNormDesc = normalizeDescription(group.mainRow.description);
        if (
          normDesc === groupNormDesc ||
          (normDesc.length >= 3 && groupNormDesc.includes(normDesc)) ||
          (groupNormDesc.length >= 3 && normDesc.includes(groupNormDesc))
        ) {
          matchedGroup = group;
          break;
        }
      }

      if (matchedGroup) {
        matchedGroup.refundRows.push(row);
        handledIndices.add(i);
      } else {
        // Standalone income (e.g. cashback)
        groups.push({
          mainRow: row,
          feeRows: [],
          refundRows: []
        });
        handledIndices.add(i);
      }
    }
  }

  // Pass 3: Any leftover unhandled rows (e.g. standalone fees or notes)
  for (let i = 0; i < rows.length; i++) {
    if (handledIndices.has(i)) continue;
    const row = rows[i];
    groups.push({
      mainRow: row,
      feeRows: [],
      refundRows: []
    });
    handledIndices.add(i);
  }

  return groups;
}
