import { TransactionFilter } from './filter';
import { TransactionRow } from '../../types';

export class DebitCardPurchaseFilter implements TransactionFilter {
  readonly name = 'DebitCardPurchaseFilter';

  shouldFilter(row: TransactionRow): boolean {
    const isEsunStatement =
      row.parser === 'esun-statement' ||
      (row.source_email_sender && row.source_email_sender.includes('estatement@esunbank.com')) ||
      (row.source_email_title && row.source_email_title.includes('綜合對帳單'));

    if (!isEsunStatement) {
      return false;
    }

    const desc = row.description || '';
    const note = row.note || '';
    return desc.includes('簽帳消費') || note.includes('簽帳消費');
  }
}
