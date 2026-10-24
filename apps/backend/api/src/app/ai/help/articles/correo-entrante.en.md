---
title: Bills and orders that arrive by e-mail
route: /settings/integrations
---

## The addresses

In Settings › Integrations, the "Inbound e-mail" section creates two addresses for your company: one for supplier bills and one for customer orders. It needs the "Inbound e-mail" permission. The long part of the address is its key: if it leaks, "Change address" creates a new one and the old one stops working at once. You can limit who writes to each with a list of addresses or domains (@supplier.com). An e-mail whose sending domain says it is forged (failed SPF or DKIM) is discarded.

## Supplier bills

Each attached PDF, photo or XML (CFDI, e-CF, NF-e) is read with the same rules of your country as a bill uploaded by hand. If the supplier is registered with that tax identifier, the document number is valid, the totals add up, it is not a duplicate and every line has a product or an account, it is saved as a draft bill and linked to the open purchase order that clearly explains it (by total and products). If anything is in doubt, it waits in "Bills received by e-mail", on the supplier bills list, with the reason; "Review" opens the form already filled with what was read and the file attached. Nothing is approved or posted from e-mail.

## Customer orders

The customer is recognised by their e-mail address. The items they ask for are looked up by code and by name in your catalogue, and the order becomes a draft quote at catalogue prices. What could not be identified waits in "Orders received by e-mail", on the quotes list, to be completed. Approving the quote turns it into an order; from there it is invoiced as usual.

## What is recorded

Each draft carries the label "Received by e-mail and read by AI" with the message it came from. On bills that were read, the label says how many fields a person corrected before saving.
