---
title: Agents (replenishment and quotes)
route: /settings/ai
---

## What an agent is

An agent runs a process on its own, but never commits the company to anything: what it produces is a draft, or a request in the approval flow that already exists. Every run is kept in the log under Administration › AI, with what it proposed, what it could not do and why.

## Replenishment agent

Every morning, from the demand forecast, it reviews the products at risk of running out or below their reorder point and prepares purchase orders:

- to the supplier the product was last bought from, at the last price;
- for the suggested quantity minus what is already on order and has not arrived (including drafts the agent left before), so running it twice does not order twice;
- one order per supplier, branch and currency.

A product that was never bought has no supplier to ask: it shows up in the log instead of being guessed.

It is configured under Administration › AI › Agents: turn it on (it is off by default), send the orders for approval or leave them as drafts, and the largest order it may send for approval on its own; a larger order stays as a draft for someone to review. Nothing is ever sent to a supplier without human approval. It can also run on request or as the "Replenishment agent" step of a workflow.

## Quotes from a customer's message

Paste a customer's e-mail or message into the assistant and ask for the quote: it finds the customer and each product, and proposes a draft quote at catalogue prices. It tells you what it could not identify. The quote is created only when you confirm the proposal.
