# 1. Fallback Parser Chain Architecture

## Context
Bank statements from different financial institutions arrive in various formats (PDFs with layout variations, password encryption, HTML bodies). Deterministic regex/text parsers are fast and free, but fragile to bank template updates. LLM parsers (e.g. Gemini) handle arbitrary layouts resiliently but incur latency and API token costs.

## Decision
We implement a `BankParser` interface and execute parsers in a configurable fallback chain (defined per bank in `config.yaml`).
1. Primary parser (e.g., `pdf-parse` deterministic extractor) executes first.
2. If primary parser fails or throws an extraction error, the next fallback parser in the chain (e.g., `gemini` LLM parser) is invoked.

## Consequences
- Fast, zero-cost parsing for standard bank layouts.
- Resilient fallback for broken or updated layouts without CLI failure.
- Unified `BankParser` interface standardizes input/output across deterministic and AI parsers.
