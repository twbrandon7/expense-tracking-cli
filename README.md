# Expense Tracking CLI

Automated CLI tool to retrieve electronic bank statements and bills from Gmail, extract monthly transaction records via a fallback parser chain (`pdf-parse` -> `gemini`), and export structured data to CSV.

---

## Features

- **Gmail OAuth2 Integration**: Secure desktop authorization to read statement emails.
- **Attachment Caching**: Automatically downloads and caches PDF attachments locally.
- **Fallback Parser Chain**: Attempts fast local layout parsing (`pdf-parse`) and falls back to Gemini LLM (`gemini-2.5-flash`) if parsing fails.
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
attachment_dir: ./attachments
output_file: ./transactions.csv

banks:
  - bank_id: cathay
    bank_name: Cathay United Bank
    enabled: true
    email_search_query: "from:cathaybk.com.tw subject:電子帳單"
    subject_pattern: "(\\d{4})年(\\d{1,2})月"
    year_offset: 0
    month_offset: 0
    parsers:
      - pdf-parse
      - gemini

  - bank_id: esun
    bank_name: E.SUN Bank
    enabled: true
    email_search_query: "from:esunbank.com.tw subject:信用卡帳單"
    subject_pattern: "(\\d{4})[/-](\\d{1,2})"
    year_offset: 0
    month_offset: -1
    parsers:
      - pdf-parse
      - gemini
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

#### Fetch all statements matching configured rules:
```bash
npm run fetch
```

#### Fetch statements for a specific billing month:
```bash
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
| `transaction_date` | Date of the transaction (`YYYY-MM-DD`) | `2026-01-15` |
| `currency` | Currency code | `TWD` |
| `amount` | Transaction amount (positive number) | `150` |
| `type` | `income`, `expense`, `note`, or `investment` | `expense` |
| `source_email_sender` | Email sender address | `statement@cathaybk.com.tw` |
| `source_email_summary` | Transaction description / subject | `Uber Eats` |
| `source_email_id` | Gmail Message ID | `18d45f9e2b10a8c2` |
