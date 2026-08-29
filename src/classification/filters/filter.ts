import { TransactionRow } from '../../types';

export interface TransactionFilter {
  readonly name: string;
  shouldFilter(row: TransactionRow): boolean;
}

export interface FilterResult {
  filteredRows: TransactionRow[];
  activeRows: TransactionRow[];
  countsByFilter: Record<string, number>;
}

export class FilterPipeline {
  private filters: TransactionFilter[] = [];

  constructor(initialFilters: TransactionFilter[] = []) {
    this.filters = [...initialFilters];
  }

  register(filter: TransactionFilter): this {
    this.filters.push(filter);
    return this;
  }

  filter(rows: TransactionRow[]): FilterResult {
    const countsByFilter: Record<string, number> = {};
    for (const f of this.filters) {
      countsByFilter[f.name] = 0;
    }

    const filteredRows: TransactionRow[] = [];
    const activeRows: TransactionRow[] = [];

    for (const row of rows) {
      let isFiltered = false;
      for (const f of this.filters) {
        if (f.shouldFilter(row)) {
          countsByFilter[f.name] = (countsByFilter[f.name] || 0) + 1;
          filteredRows.push(row);
          isFiltered = true;
          break;
        }
      }
      if (!isFiltered) {
        activeRows.push(row);
      }
    }

    const totalFiltered = filteredRows.length;
    if (totalFiltered > 0) {
      const summaryParts = Object.entries(countsByFilter)
        .filter(([_, count]) => count > 0)
        .map(([name, count]) => `${count} via ${name}`)
        .join(', ');
      console.log(`[FilterPipeline] Filtered out ${totalFiltered} transaction(s) (${summaryParts}). Active transactions: ${activeRows.length}`);
    } else {
      console.log(`[FilterPipeline] No transactions were filtered. Total active: ${activeRows.length}`);
    }

    return { filteredRows, activeRows, countsByFilter };
  }
}
