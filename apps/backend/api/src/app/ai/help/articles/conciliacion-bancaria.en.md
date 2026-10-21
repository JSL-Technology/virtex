---
title: Assisted bank reconciliation
route: /accounting/reconciliation
---

## Which bank files can be imported

Under Accounting › Reconciliation › Import statement, the file your online banking exports is accepted:

- **OFX** (also called QFX or "Money"): it carries dates, signed amounts and the closing balance. No columns need to be named.
- **camt.053** (ISO 20022, XML): it carries dates, amounts and the opening and closing balances. No columns need to be named.
- **CSV**: each column has to be named. When you pick the file, the system reads the headers and the first rows and proposes the mapping: the date column and its format, the description, the reference, the money-in and money-out columns, and whether numbers use a decimal comma or point. Review the proposal before importing; if the headers say nothing useful, the assistant proposes it and says so.

With OFX and camt.053 the period and balances come from the file. If you type them by hand, they must match the file; if they do not, the import is refused and says which figure differs.

## How matches are proposed

For each bank movement, lines of the bank account's ledger with the same amount are looked for and scored:

- same or nearby date;
- a reference in common (cheque, invoice, fiscal or receipt number in the description);
- words in common in the description;
- the company having matched movements with the same description to the same account before.

Each candidate shows its score and its reasons. A movement is **certain** when it has a single clear candidate above the company's threshold (95 by default) that no other movement claims; otherwise it is left to **review**.

## Confirming the certain ones at once

"Confirm the certain ones" matches every certain movement of the statement. Each match is undone like a manual one, with "Undo".

The "Confirm automatically on import" box does the same when each statement is imported. It is off by default and turned on per company; the matches it makes are marked as automatic.

## Asking the assistant

When a movement has several lines of the same amount that the score cannot tell apart, "Ask the assistant" has it choose one and explain why. The assistant only marks the line: the person confirms the match. If none clearly corresponds, it says so.
