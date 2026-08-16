import { BankParser, ParserConfig, ParserContext, TransactionRow } from '../types';
import { PdfParseBankParser } from './pdf-parse';
import { GeminiBankParser } from './gemini';
import { EsunDebitPdfParser } from './esun';
import { CtbcCreditPdfParser } from './ctbc';

export class ParserChain {
  private parsers: Map<string, BankParser> = new Map();

  constructor(
    initialParsers: BankParser[] = [
      new EsunDebitPdfParser(),
      new CtbcCreditPdfParser(),
      new PdfParseBankParser(),
      new GeminiBankParser(),
    ]
  ) {
    for (const parser of initialParsers) {
      this.register(parser);
    }
  }

  register(parser: BankParser): this {
    this.parsers.set(parser.id, parser);
    return this;
  }

  getParser(id: string): BankParser | undefined {
    return this.parsers.get(id);
  }

  async parse(filePath: string, context: ParserContext, configuredParsers?: ParserConfig[]): Promise<TransactionRow[]> {
    // Default fallback chain if not explicitly specified in bank config
    const parserConfigs: ParserConfig[] = configuredParsers && configuredParsers.length > 0
      ? configuredParsers
      : Array.from(this.parsers.keys()).map((id) => ({ type: id }));

    const errors: Array<{ parserId: string; error: any }> = [];

    for (const config of parserConfigs) {
      const parser = this.parsers.get(config.type);
      if (!parser) {
        console.warn(`[ParserChain] Unknown parser type: "${config.type}". Skipping.`);
        continue;
      }

      try {
        console.log(`[ParserChain] Running parser "${parser.id}" on ${filePath}...`);
        const rows = await parser.parse(filePath, context);
        if (rows && rows.length > 0) {
          console.log(`[ParserChain] Parser "${parser.id}" succeeded! Extracted ${rows.length} rows.`);
          return rows;
        }
      } catch (err: any) {
        console.warn(`[ParserChain] Parser "${parser.id}" failed: ${err.message || err}. Trying fallback parser...`);
        errors.push({ parserId: parser.id, error: err });
      }
    }

    throw new Error(
      `All parsers in chain failed for ${filePath}. Errors:\n` +
      errors.map((e) => `- ${e.parserId}: ${e.error.message || e.error}`).join('\n')
    );
  }
}
