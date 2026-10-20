# Point of sale (POS)

The point of sale is **its own application** — `apps/pos` — deployed apart from the ERP. The ERP no
longer embeds a till: its *Ventas › Punto de venta* entry is a door that opens the POS, and its
*Tickets de punto de venta* list is the back-office journal of what the tills sold.

There used to be two tills: a screen embedded in the ERP (`features/sales/pos`) and this
application. They had different features, different rules and different bugs — the embedded one,
for instance, never sent the `Idempotency-Key` that `POST /pos/sales` requires, so every sale it
attempted was refused with `common.idempotency_key_required`. They are now one application with the
union of both feature sets, and the API behind them is the same `pos` module.

## Sign-in: same accounts, same session

- There is no separate POS account. Anyone whose role carries **`pos:view`** signs in to the POS with
  their usual email and password (and second factor, if their account has one).
- The POS and the ERP are served from the **same origin** (the POS under `/pos/`), so the host-only
  session and CSRF cookies are shared: signing in to either signs in to both, and *Abrir el punto de
  venta* in the ERP opens the till already signed in. Locally, `localhost:4200` (ERP) and
  `localhost:4300` (POS) share cookies the same way — cookies do not distinguish ports.
- An expired access token is renewed from the refresh cookie (one renewal for a burst of 401s) and
  the request replayed; a session that cannot be renewed sends the till to the sign-in screen with
  the reason. The shift lives on the server, so nothing is lost.
- A person whose role lacks the till is told so on the sign-in screen. If they signed in from the
  POS, the session is closed again; if they arrived signed in from the ERP, it is left alone (it is
  the ERP's session too).
- reCAPTCHA v3 is honoured exactly as the ERP does it (`RECAPTCHA_DISABLED` decides on the server).

| Permission | Allows |
| --- | --- |
| `pos:view` | Open the POS: catalogue, shift, its sales and reports. |
| `pos:operate` | Open/close one's own shift and ring sales on it. |
| `pos:manage_shifts` | Supervisor: act on another cashier's shift, void sales. |

The tenant administrator's `*` holds all three — `dev@virtex.local` signs in to both applications.

## What the till does

- **Catalogue** — `GET /pos/catalog`: active products priced and taxed exactly as the server will
  charge them (the tax rule is resolved on the server, never re-derived in the browser). Search by
  name, SKU or barcode; category chips; pictures with an initials fallback; stock badges; goods out
  of stock cannot be added, services never run out.
- **Barcode scanning** — a handheld scanner types the code and Enter into the search box; an exact
  barcode/SKU match is added and the box cleared for the next scan.
- **Ticket** — customer name (walk-in by default), quantity steppers and direct entry, per-line
  totals, subtotal / tax at its rate / total, the market's "configure your tax" warning.
- **Park and recall** tickets (per terminal, kept across reloads).
- **Payment** — cash with quick note amounts and change, card, transfer (with reference) and split
  card + cash. The server checks the tenders cover the total and that only cash produces change.
- **Receipt** — printed for 80 mm thermal paper through a hidden iframe (no pop-up to unblock),
  optionally automatically after every sale.
- **Shift** — opened with the counted float, in a branch; the X report (by tender, best sellers,
  average ticket, voids) at any time; cash-up against the counted drawer with the difference shown
  as it is typed; the Z report after closing, printable for signature.
- **Journal** — the shift's sales: search, reprint, and — supervisors — **void** with a reason. A
  void returns the goods to stock and takes the sale out of the takings, in one transaction; it is
  refused on a shift already cashed up.
- **Idempotent sales** — every charge carries an `Idempotency-Key` kept across retries of the same
  cart, so a sale whose response was lost is never rung (nor its stock moved) twice.
- **Terminal per device** — each device is configured as its own till (`CAJA-1`, …); each till has
  its own shift.
- Keyboard: `F2` search/scan, `F4` customer, `F6` journal, `F7` shift, `F8` park, `F9` charge,
  `+`/`−`/`Supr` on the selected line, `Esc` closes dialogs. Full-screen mode, online indicator.
- Text in Spanish, English and Portuguese from the shared catalogue; amounts in the tenant's
  currency and locale.

## API (`/pos`, behind auth + permissions)

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/pos/catalog` | `pos:view` | Sellable catalogue, priced and taxed |
| GET | `/pos/context` | `pos:view` | Currency, standard rate, company identity for the ticket |
| GET | `/pos/shifts/active?terminalId=` | `pos:view` | Current open shift |
| POST | `/pos/shifts` | `pos:operate` | Open a shift |
| POST | `/pos/shifts/:id/close` | `pos:operate` | Close and cash up |
| GET | `/pos/shifts/:id/report` | `pos:view` | X report (open) / Z report (closed) |
| POST | `/pos/sales` | `pos:operate` | Ring a sale (`Idempotency-Key` required) |
| GET | `/pos/sales?shiftId=` | `pos:view` | Sales journal |
| GET | `/pos/sales/:id` | `pos:view` | One sale (reprint) |
| POST | `/pos/sales/:id/void` | `pos:manage_shifts` | Void on an open shift (`Idempotency-Key` required) |

A cashier therefore needs nothing but `pos:*` (plus their own branches, `GET
/organizations/branches/mine`) — no back-office catalogue or invoicing permission.

## Model

- **`PosShift`** — a till session on one terminal: who opened it, opening float, running totals,
  cash takings, voids, and at close the expected drawer, the counted cash and the variance. At most
  one open shift per terminal (partial unique index).
- **`PosSale`** — an immutable ticket; lines as JSON, priced by the server; tenders, cash handed over
  and change; and, when voided, who, when and why (`voided_at`, `voided_by_id`, `void_reason`).

`PosService.processSale` runs in one transaction with the shift row locked: stock moves (row-locked,
tenant-scoped), the ticket is recorded and the shift totals updated, or none of it happens.
`voidSale` is the mirror image.

## Running it

```bash
npm run dev:api     # :3000
npm run dev:web     # ERP on :4200
npm run dev:pos     # POS on :4300
```

`CORS_ORIGIN` defaults in development to both dev servers (`http://localhost:4200,http://localhost:4300`).

## Deployment

```bash
API_URL=https://app.example.com/api/v1 RECAPTCHA_V3_SITE_KEY=… npm run build:pos
```

`tools/generate-environment.mjs --app=pos` writes the POS's production environment (`ERP_URL`
defaults to `/`), and the bundle is built with `<base href="/pos/">`. Serve `dist/apps/pos/browser`
under `/pos/` **on the ERP's origin**, with SPA fallback to `/pos/index.html`. Its security headers
are in `apps/pos/public/serve.json` (the ERP's policy plus Google's reCAPTCHA hosts); replicate them
if another server fronts the bundle. The ERP's link to the till is `POS_URL` (default `/pos/`).
