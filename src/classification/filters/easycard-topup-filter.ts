import { TransactionFilter } from './filter';
import { TransactionRow } from '../../types';

export class EasyCardTopupFilter implements TransactionFilter {
  readonly name = 'EasyCardTopupFilter';

  shouldFilter(row: TransactionRow): boolean {
    const desc = row.description || '';
    const note = row.note || '';

    // E.SUN linked account transaction for EasyCard top-up
    if (desc.includes('連結帳戶交易') && (desc.includes('3*0-1202004061') || note.includes('3*0-1202004061'))) {
      return true;
    }

    if (desc.includes('悠遊卡') || desc.includes('悠遊付') || note.includes('悠遊卡') || note.includes('悠遊付')) {
      if (desc.includes('自動加值') || desc.includes('加值') || desc.includes('連結帳戶交易')) {
        return true;
      }
    }

    return false;
  }
}
