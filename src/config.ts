import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { AppConfig, BankConfig } from './types';

export function loadConfig(configPath?: string): AppConfig {
  const resolvedPath = path.resolve(process.cwd(), configPath || 'config.yaml');
  
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Configuration file not found at: ${resolvedPath}`);
  }

  const fileContent = fs.readFileSync(resolvedPath, 'utf8');
  const parsed = yaml.load(fileContent) as AppConfig;

  if (!parsed || !parsed.banks || !Array.isArray(parsed.banks)) {
    throw new Error(`Invalid configuration format in ${resolvedPath}`);
  }

  return parsed;
}

export interface ExtractedPeriod {
  year: number;
  month: number;
}

export function extractBillingPeriod(subject: string, bank: BankConfig): ExtractedPeriod | null {
  const regex = new RegExp(bank.title_pattern);
  const match = subject.match(regex);

  if (!match || !match.groups) {
    return null;
  }

  const { year, roc_year, month } = match.groups;
  if (!month) {
    return null;
  }

  let parsedYear: number;
  if (roc_year) {
    parsedYear = parseInt(roc_year, 10) + 1911;
  } else if (year) {
    parsedYear = parseInt(year, 10);
  } else {
    return null;
  }

  const parsedMonth = parseInt(month, 10);

  // Apply offsets
  let finalYear = parsedYear + (bank.offset?.year_offset || 0);
  let finalMonth = parsedMonth + (bank.offset?.month_offset || 0);

  while (finalMonth <= 0) {
    finalMonth += 12;
    finalYear -= 1;
  }

  while (finalMonth > 12) {
    finalMonth -= 12;
    finalYear += 1;
  }

  return { year: finalYear, month: finalMonth };
}
