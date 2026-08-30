import { TransactionClassifier, TransactionRow } from '../../types';
import { matchStringOrRegex, parseNoteMetadata } from './types';

export interface TelecomFeeOptions {
  description: string;
  counterparty: string;
  is_regex?: boolean;
}

export class TelecomFeeClassifier implements TransactionClassifier<TelecomFeeOptions> {
  readonly id = 'telecom_fee';

  match(row: TransactionRow, options: TelecomFeeOptions): boolean {
    if (!options || !options.description || !options.counterparty) {
      return false;
    }

    const descMatched = matchStringOrRegex(row.description, options.description, options.is_regex);
    if (!descMatched) {
      return false;
    }

    const noteMeta = parseNoteMetadata(row.note);
    const counterpartyValue = noteMeta['counterparty'] || '';

    // Match against extracted counterparty metadata or note string directly
    const cpMatched = matchStringOrRegex(counterpartyValue, options.counterparty, options.is_regex) ||
      (row.note ? matchStringOrRegex(row.note, options.counterparty, options.is_regex) : false);

    return cpMatched;
  }
}
