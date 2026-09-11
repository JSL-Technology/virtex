# Point of sale (POS)

Till shifts and transactions, consolidated from special-enigma's POS domain into a NestJS module
(`apps/backend/api/src/app/pos`) on the platform's TypeORM data source. The existing point-of-sale
screen (`features/sales/pos`) is wired to it.

## Model

- **`PosShift`** — a till session on one terminal: who opened it, opening float, running totals,
  open/closed status. A terminal has **at most one open shift** at a time (enforced by the service).
- **`PosSale`** — an immutable ticket; its lines are stored as JSON (a ticket is never edited
  line-by-line). Links to a fiscal invoice via `invoiceId` when one is issued.

Both are tenant-scoped by `organizationId` and cascade on tenant deletion.

## Atomic sale

`PosService.processSale` runs in a single transaction that:

1. verifies an open shift exists for the terminal (a sale outside one is refused);
2. decrements catalogue stock for every real-product line via the existing
   `InventoryService.decreaseStock` — row-locked and tenant-scoped, so two concurrent sales of the
   last unit cannot both succeed; ad-hoc (non-catalogue) lines are skipped;
3. records the ticket and updates the shift totals.

Because it is one transaction, a sale and the stock it consumed can never diverge, and an oversold
unit rolls the whole ticket back.

## API (`/pos`, behind auth + permissions)

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/pos/shifts/active?terminalId=` | `pos:view` | Current open shift |
| POST | `/pos/shifts` | `pos:operate` | Open a shift |
| POST | `/pos/shifts/:id/close` | `pos:operate` | Close a shift |
| POST | `/pos/sales` | `pos:operate` | Ring a sale |
| GET | `/pos/sales?shiftId=` | `pos:view` | Sales journal |

The screen loads its catalogue from inventory, auto-opens the terminal's shift, and persists sales.
