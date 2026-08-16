# Specification: Bank Statement & Bill Fetching CLI

## Problem Statement

Users need an automated way to retrieve electronic bank statements and bills from Gmail, extract monthly transaction records, and export them into a structured format for expense tracking without manual downloading or copy-pasting.

## Solution

A Node.js & TypeScript CLI application that connects to Gmail via OAuth2 Desktop flow, searches for configured bank statement emails, caches PDF attachments locally, and extracts transactions using a configurable fallback parser chain (`pdf-parse` -> `gemini`), outputting structured rows into a CSV file.

## User Stories

1. As an expense tracking user, I want to authorize my Gmail account via CLI OAuth2, so that the tool can read bank statement emails on my behalf.
2. As an expense tracking user, I want to specify a YAML configuration file (or default to `config.yaml`), so that I can define email search patterns and offset rules for each bank.
3. As an expense tracking user, I want to specify a target billing month and year (e.g. `--month 2026-01`), so that I can fetch statements for a specific billing cycle.
4. As an expense tracking user, I want downloaded PDF attachments stored in a local directory, so that repeat runs skip unnecessary network downloads.
5. As an expense tracking user, I want a fallback parser chain (`pdf-parse` -> `gemini`), so that if layout-based text parsing fails, an LLM parser can extract the transaction data automatically.
6. As an expense tracking user, I want parsed transactions saved to `transactions.csv`, so that I can inspect or import my transaction records into spreadsheets or expense tracking tools.

## Implementation Decisions

- **CLI Commands**: Provide two main CLI commands: `auth` (interactive Google OAuth login) and `fetch` (statement downloading and parsing pipeline).
- **Config Path Resolution**: Accept `--config <path>` argument, defaulting to `./config.yaml` in the current working directory.
- **Environment Variables Resolution**: Load environment variables from `.env` file via `dotenv` first, falling back to system environment variables (`process.env`).
- **Billing Cycle Offset**: Calculate statement period by combining regex-extracted year/month from email subject with per-bank `year_offset` and `month_offset`.

- **Fallback Parser Chain**: Standardize parsers under a unified `BankParser` interface (e.g. `esun-debit`, `ctbc-credit`, `pdf-parse`, `gemini`). Execute configured parsers in order; fallback to the next parser on extraction errors.
- **Output Data Format**: Export parsed records with fields: `transaction_date`, `description`, `currency`, `amount`, `type` (`income`, `expense`, `note`, `investment`), `note`, `source_email_sender`, `source_email_title`, `source_email_id`.

## Testing Decisions

- **Behavioral Testing**: Test high-level command behavior and parser contracts without coupling to internal module implementation.
- **Parser Pipeline Testing**: Test `pdf-parse` regex extraction against sample text structures and verify fallback execution when a parser fails.
- **Config Loader Testing**: Verify YAML config parsing, default fallback handling, and offset date calculations.

## Out of Scope

- Real-time bank login or scraping (only Gmail email fetching).
- Automatic bank account credential management.
- Multi-user web dashboard or server deployment (CLI single-user execution only).

## Further Notes

- Relies on Google OAuth2 Desktop client application credentials (`credentials.json`).
- `gemini` fallback parser requires `GEMINI_API_KEY` when triggered.
