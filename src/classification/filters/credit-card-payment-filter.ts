import { TransactionFilter } from './filter';
import { TransactionRow } from '../../types';

export class CreditCardPaymentFilter implements TransactionFilter {
  readonly name = 'CreditCardPaymentFilter';

  shouldFilter(row: TransactionRow): boolean {
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
