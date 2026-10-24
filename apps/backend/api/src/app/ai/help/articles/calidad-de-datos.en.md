---
title: Data quality (duplicates)
route: /reports/data-quality
---

## What it looks for

Analysis › Data quality shows customers, suppliers and products that are probably entered twice. The search runs by itself every week and can also be started with "Find duplicates now".

## Why it proposes a pair

- the same tax identifier (RNC, RFC, NIT, EIN…; almost certainly the same party);
- the same barcode, for products;
- the same e-mail, phone or code;
- a very similar name, ignoring accents, punctuation and the legal form ("LLC", "Inc.", "S.A.", "SRL" and the like).

Two records with different tax identifiers are two different taxpayers even if they share a name: the pair scores lower and is almost never proposed.

## What to do with each pair

Mark "They are the same" or "Not duplicates". The decision is kept: a dismissed pair does not come back. Marking "They are the same" merges nothing; open both records from the pair, move what is needed to the one you keep and deactivate the other.

Each person sees only the record types they may read, and decides only on those they may edit.
