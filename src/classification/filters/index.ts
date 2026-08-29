export * from './filter';
export * from './debit-card-purchase-filter';
export * from './credit-card-payment-filter';

import { FilterPipeline } from './filter';
import { DebitCardPurchaseFilter } from './debit-card-purchase-filter';
import { CreditCardPaymentFilter } from './credit-card-payment-filter';

export function createDefaultFilterPipeline(): FilterPipeline {
  return new FilterPipeline([
    new DebitCardPurchaseFilter(),
    new CreditCardPaymentFilter(),
  ]);
}
