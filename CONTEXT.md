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

### Output Storage
Parsed transaction rows exported to local CSV format (`transactions.csv`).

### Gmail Authentication
OAuth2 Desktop client flow saving authorization credentials in `credentials.json` and session tokens in `token.json`.

### Parser Chain
Ordered sequence of `BankParser` implementations (e.g. `esun-debit`, `ctbc-credit`, `pdf-parse`, `gemini`). Execute in priority order; fallback to next parser on extraction failure.

### Google Sheets Synchronization
Exports aggregated and classified summary rows into Google Sheets tabs partitioned by year (e.g. `2026`). Matches sub-types in Column D under `負債` (`計劃` / `非計劃`), appends formulas/values and detailed transaction notes, and automatically inserts new rows for unlisted sub-types with sum and percentage formulas.

### CLI Commands
- `auth`: Interactive OAuth2 authentication flow for Gmail and Google Sheets. Saves tokens to `token.json`.
- `fetch`: Downloads and parses bills into CSV. Accepts target month/year parameters (e.g. `--month 2026-01`).
- `classify`: Classifies transactions CSV into aggregated expense summary CSV.
- `sync-sheets`: Synchronizes classified summary CSV into Google Sheets for the specified month (e.g. `--month 2026-07`).


### Config Path Resolution
CLI `--config` flag overrides config path. Defaults to `./config.yaml` in current working directory.

### Environment Variables Resolution
`dotenv` loads local `.env` file first; falls back to process environment variables (`process.env`).





