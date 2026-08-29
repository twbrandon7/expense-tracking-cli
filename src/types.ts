export type TransactionType = 'income' | 'expense' | 'note' | 'investment';

export interface TransactionRow {
  transaction_date: string; // YYYY-MM-DD
  description: string;
  currency: string;         // e.g. TWD, USD
  amount: number;
  type: TransactionType;
  note?: string;
  parser?: string;          // e.g. esun-statement, ctbc-credit, etc.
  source_email_sender: string;
  source_email_title: string;
  source_email_id: string;
}

export interface OffsetConfig {
  month_offset: number;
  year_offset: number;
}

export interface AttachmentConfig {
  file_extension: string;
  encrypted?: boolean;
}

export interface ParserConfig {
  type: string;
}


export interface BankConfig {
  bank_id: string;
  bank_name: string;
  enabled: boolean;
  sender: string;
  title_pattern: string;
  offset: OffsetConfig;
  attachment: AttachmentConfig;
  parsers?: ParserConfig[];
}

export interface AppConfig {
  version: string;
  date_timezone: string;
  spreadsheet_id?: string;
  sheet_name?: string;
  banks: BankConfig[];
}

export interface ParserContext {
  bankConfig: BankConfig;
  billingPeriod: {
    year: number;
    month: number;
  };
  emailSender: string;
  emailSubject: string;
  emailId: string;
  password?: string;
}

export interface BankParser {
  readonly id: string;
  parse(filePath: string, context: ParserContext): Promise<TransactionRow[]>;
}

export interface ClassificationRule {
  pattern: string;
  type: string;
  sub_type: string;
  is_regex?: boolean;
}

export interface ClassificationConfig {
  base_currency: string;
  user_rules: ClassificationRule[];
  llm_rules: ClassificationRule[];
}

export interface ClassifiedSummaryRow {
  type: string;
  sub_type: string;
  currency: string;
  amount: number;
  formula: string;
  comment: string;
}

export interface CorrelatedTransactionGroup {
  mainRow: TransactionRow;
  feeRows: TransactionRow[];
  refundRows: TransactionRow[];
  type?: string;
  sub_type?: string;
  source?: 'user_rule' | 'llm_rule' | 'gemini' | 'unassigned';
}

