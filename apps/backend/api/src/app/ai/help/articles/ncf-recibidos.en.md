---
title: NCF and e-CF on purchases
route: /accounts-payable
countries: DO
---

## Format

A traditional NCF has 11 characters: the letter B, two digits for the document type and eight for the sequence (for example B0100000123). An e-CF has 13: the letter E, two digits for the type and ten for the sequence (for example E310000000123). Spaces and hyphens are ignored. An NCF in any other format, or of a type the DGII does not define, is not accepted: it could not be reported on the 606.

## The supplier's RNC

The 606 identifies each purchase by the supplier's RNC or cédula, so a bill with an NCF needs a supplier with a valid RNC (its check digit is verified). The exceptions are the documents your own company issues for minor expenses (B13, E43) and for payments abroad (B17, E47), where the counterparty has no Dominican RNC.

## Repeated NCF

An NCF is unique to its issuer. If you try to enter two live bills from the same supplier with the same NCF, the second is refused: it is almost always the same purchase entered twice. A voided or rejected bill does not count.

## Types worth checking

A consumer invoice (B02, E32) is valid as a purchase but gives no ITBIS credit. A credit note (B04, E34) is entered as a supplier note, not as a bill.
