import { TransactionFilter } from './filter';
import { TransactionRow } from '../../types';

export class WithdrawalFilter implements TransactionFilter {
  readonly name = 'WithdrawalFilter';

  shouldFilter(row: TransactionRow): boolean {
    const isEsunStatement =
      row.parser === 'esun-statement' ||
      (row.source_email_sender && row.source_email_sender.includes('estatement@esunbank.com')) ||
      (row.source_email_title && row.source_email_title.includes('綜合對帳單'));

    if (!isEsunStatement) {
      return false;
    }

    const desc = row.description || '';
    // Matches 跨行提款, 提款, 跨行無卡提優, 無卡提款, 自行提款, etc.
    return /提款|提優|無卡提/.test(desc);
  }
}
