import { TransactionFilter } from './filter';
import { TransactionRow } from '../../types';

export class DebitCardPurchaseFilter implements TransactionFilter {
  readonly name = 'DebitCardPurchaseFilter';

  shouldFilter(row: TransactionRow): boolean {
    const desc = row.description || '';
    const note = row.note || '';
    return desc.includes('簽帳消費') || note.includes('簽帳消費');
  }
}
