import fs from 'fs';
import path from 'path';

export interface WorkspaceOptions {
  workspace?: string;
  month?: string;
  transactionsCsv?: string;
  summaryCsv?: string;
}

export interface ResolvedWorkspacePaths {
  workspaceDir: string;
  monthDir?: string;
  downloadsDir?: string;
  transactionsDir: string;
  transactionsCsvPath: string;
  summaryCsvPath: string;
}

export function resolveWorkspacePaths(options: WorkspaceOptions): ResolvedWorkspacePaths {
  const baseWorkspace = path.resolve(process.cwd(), options.workspace || 'workspace');

  let monthDir: string | undefined;
  let downloadsDir: string | undefined;

  if (options.month) {
    monthDir = path.join(baseWorkspace, options.month);
    downloadsDir = path.join(monthDir, 'downloads');

    if (!fs.existsSync(monthDir)) {
      fs.mkdirSync(monthDir, { recursive: true });
    }
  }

  const transactionsDir = monthDir
    ? path.join(monthDir, 'transactions')
    : path.join(baseWorkspace, 'transactions');

  if (!fs.existsSync(transactionsDir)) {
    fs.mkdirSync(transactionsDir, { recursive: true });
  }

  const transactionsCsvPath = options.transactionsCsv
    ? path.resolve(process.cwd(), options.transactionsCsv)
    : monthDir
      ? path.join(monthDir, 'transactions.csv')
      : path.join(baseWorkspace, 'transactions.csv');

  const summaryCsvPath = options.summaryCsv
    ? path.resolve(process.cwd(), options.summaryCsv)
    : monthDir
      ? path.join(monthDir, 'classified_summary.csv')
      : path.join(baseWorkspace, 'classified_summary.csv');

  return {
    workspaceDir: baseWorkspace,
    monthDir,
    downloadsDir,
    transactionsDir,
    transactionsCsvPath,
    summaryCsvPath,
  };
}
