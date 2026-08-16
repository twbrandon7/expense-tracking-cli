# Expense Tracking CLI

Automated CLI tool to retrieve electronic bank statements and bills from Gmail, extract monthly transaction records via bank-specific parsers (`esun-debit`, `ctbc-credit`) or generic fallback chain (`pdf-parse` -> `gemini`), and export structured data to CSV.

---

## Features

- **Gmail OAuth2 Integration**: Secure desktop authorization to read statement emails.
- **Attachment Caching**: Automatically downloads and caches PDF attachments locally.
- **Bank-Specific & Fallback Parsers**: High-precision parsers for E.SUN (`esun-debit`) and CTBC (`ctbc-credit` with Gemini OCR for bitmap merchant names), plus generic fallback parser chain (`pdf-parse` -> `gemini`).
- **Billing Offset Calculation**: Handles mismatch between email statement dates and actual transaction billing cycles.
- **Structured CSV Export**: Saves clean, normalized transaction rows into `transactions.csv`.

---

## Prerequisites

- **Node.js**: v18.0.0 or higher
- **Google Cloud Account**: For Gmail API OAuth 2.0 Client ID
- **Google Gemini API Key**: For fallback parsing via Gemini 2.5 Flash

---

## Setup Guide

### 1. Install Dependencies

```bash
npm install
```

---

### 2. Google OAuth Credentials Setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or select an existing one).
3. Enable the **Gmail API**:
   - Navigate to **APIs & Services** > **Library**.
   - Search for **Gmail API** and click **Enable**.
4. Configure the **OAuth Consent Screen**:
   - Navigate to **APIs & Services** > **OAuth consent screen**.
   - Select User Type **External** and fill in the required app information.
   - Add scope: `https://www.googleapis.com/auth/gmail.readonly`.
   - Add your Google account email under **Test users**.
5. Create OAuth 2.0 Credentials:
   - Navigate to **APIs & Services** > **Credentials**.
   - Click **Create Credentials** > **OAuth client ID**.
   - Select Application type: **Desktop app**.
   - Set redirect URI to `http://localhost:3000/oauth2callback` if prompted.
6. Download Credentials:
   - Download the client configuration JSON file.
   - Save it as `credentials.json` in the root directory of this project:
     ```
     expense-tracking-cli/
     ├── credentials.json
     ├── ...
     ```

---

### 3. Environment Variables (`.env`)

Create a `.env` file in the project root to configure your Gemini API key:

```bash
cp .env.example .env 2>/dev/null || touch .env
```

Add your Gemini API Key to `.env`:

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

> **Note**: Get your Gemini API key from [Google AI Studio](https://aistudio.google.com/).

---

### 4. Configure Banks (`config.yaml`)

Create a `config.yaml` in the project root (or reference `docs/example-config.yaml`):

```yaml
version: "1.0"
date_timezone: "Asia/Taipei"

banks:
  - bank_id: esun
    bank_name: "E.SUN Bank"
    enabled: true
    sender: "Service@info.esunbank.com"
    title_pattern: '玉山銀行簽帳金融卡電子對帳單 \((?<roc_year>\d{2,3})(?<month>\d{1,2})\)'
    offset:
      year_offset: 0
      month_offset: 0
    attachment:
      file_extension: ".pdf"
      encrypted: true
    parsers:
      - type: "esun-debit"

  - bank_id: ctbc
    bank_name: "CTBC Bank"
    enabled: true
    sender: "ebill@estats.ctbcbank.com"
    title_pattern: '中國信託信用卡電子帳單 (?<roc_year>\d{3})(?<month>\d{2})'
    offset:
      year_offset: 0
      month_offset: -1
    attachment:
      file_extension: ".pdf"
      encrypted: true
    parsers:
      - type: "ctbc-credit"
```

---

## Usage

### 1. Build TypeScript

```bash
npm run build
```

---

### 2. Authorize Gmail Access

Run the interactive OAuth authentication command:

```bash
npm run auth
```

- A Google OAuth authorization link will be displayed in the terminal.
- Open the link in your browser, log in to your Google account, and grant readonly access.
- Upon approval, the CLI will capture the callback at `http://localhost:3000/oauth2callback` and save the credentials to `token.json`.

---

### 3. Fetch & Parse Statements

#### Fetch statements for a specific billing month:
```bash
npm run fetch -- -m 2026-01
# or
npx ts-node src/cli.ts fetch --month 2026-01
```

#### Use a custom configuration file:
```bash
npx ts-node src/cli.ts fetch --config custom-config.yaml --month 2026-01
```

#### Run with compiled code:
```bash
node dist/cli.js fetch -m 2026-01
```

---

## Output Format

Transactions are saved to `transactions.csv` (or the path specified in `config.yaml`):

| Column | Description | Example |
|---|---|---|
| `transaction_date` | Date of the transaction (`YYYY-MM-DD`) | `2026-07-06` |
| `description` | Item, merchant, or transaction description | `樂購蝦皮－ＡｓｉａＷｉＦｉ` |
| `currency` | Currency code | `TWD` |
| `amount` | Transaction amount (positive number) | `908` |
| `type` | `income`, `expense`, `note`, or `investment` | `expense` |
| `note` | Optional metadata (card suffix, FX amount, FX date) | `Card: 1719, Foreign: USD 6.35, FX Date: 07/02` |
| `source_email_sender` | Email sender address | `Service@info.esunbank.com` |
| `source_email_title` | Statement email title / subject | `玉山銀行簽帳金融卡電子對帳單(11507)` |
| `source_email_id` | Gmail Message ID | `1a0038afce63d0c3` |
