# Domain Model Context

## Terms

### Transaction Row
Parsed expense/income record extracted from bank statements or bills. Contains:
- `transaction_date`
- `description`
- `currency`
- `amount`
- `type` (`income` | `expense` | `note` | `investment`)
- `note`
- `source_email_sender`
- `source_email_title`
- `source_email_id`

### Billing Cycle
Target statement period computed by applying `month_offset` and `year_offset` to parsed year/month from email subject.

### Workspace Directory
Default root `./workspace` directory organized by month (`workspace/<YYYY-MM>/`):
- `workspace/<YYYY-MM>/downloads/<bank_id>/`: Downloaded bank statement PDFs.
- `workspace/<YYYY-MM>/transactions.csv`: Extracted transaction rows.
- `workspace/<YYYY-MM>/classified_summary.csv`: Aggregated classification summary.

### CLI Commands
- `auth`: Interactive OAuth2 authentication flow for Gmail and Google Sheets. Saves tokens to `token.json`.
- `fetch`: Downloads statement PDFs and parses transactions into `workspace/<YYYY-MM>/transactions.csv`. Requires `--month <YYYY-MM>`.
- `classify`: Classifies transactions into `workspace/<YYYY-MM>/classified_summary.csv` using rules and Gemini.
- `sync-sheets`: Synchronizes classified summary CSV into Google Sheets for the specified month (e.g. `--month 2026-07`).
- `run`: End-to-end pipeline executing `fetch` -> `classify` -> `sync-sheets` sequentially with skip flags (`--skip-fetch`, `--skip-classify`, `--skip-sheets`).

### Config Path Resolution
CLI `--config` flag overrides config path. Defaults to `./config.yaml` in current working directory.

### Environment Variables Resolution
`dotenv` loads local `.env` file first; falls back to process environment variables (`process.env`).





