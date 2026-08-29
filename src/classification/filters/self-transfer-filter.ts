import { TransactionFilter } from './filter';
import { TransactionRow } from '../../types';

export class SelfTransferFilter implements TransactionFilter {
  readonly name = 'SelfTransferFilter';

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

    // 1. Filter out self-transfers to Line Bank (824 0000111022***991)
    if (
      combined.includes('824 0000111022***991') ||
      (combined.includes('824') && combined.includes('991') && desc.includes('連*銀行'))
    ) {
      return true;
    }

    // 2. Filter out paired intra-bank E.SUN transfers between own accounts (0015976***604 <-> 1425976***258)
    if (desc.includes('網路本行轉帳')) {
      if (
        combined.includes('0001425976***258') ||
        combined.includes('0000015976***604') ||
        (combined.includes('808') && (combined.includes('258') || combined.includes('604')))
      ) {
        return true;
      }
    }

    return false;
  }
}
