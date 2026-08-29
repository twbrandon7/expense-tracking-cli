import { TransactionFilter } from './filter';
import { TransactionRow } from '../../types';

export class CreditCardPaymentFilter implements TransactionFilter {
  readonly name = 'CreditCardPaymentFilter';

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
    const combined = `${desc} ${note}`;

    // Filter out credit card bill payments (e.g. transfer to CTBC 822 4311953504***336)
    if (
      combined.includes('822 4311953504***336') ||
      (combined.includes('822') && combined.includes('336'))
    ) {
      return true;
    }

    return false;
  }
}
