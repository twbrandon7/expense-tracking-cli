export type TransactionType = 'income' | 'expense' | 'note' | 'investment';

export interface TransactionRow {
  transaction_date: string; // YYYY-MM-DD
  currency: string;         // e.g. TWD, USD
  amount: number;
  type: TransactionType;
  source_email_sender: string;
  source_email_summary: string;
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
}

export interface BankParser {
  readonly id: string;
  parse(filePath: string, context: ParserContext): Promise<TransactionRow[]>;
}
