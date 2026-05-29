# Circular Dependencies Elimination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar los 50 ciclos de dependencias circulares del backend NestJS y dejar la arquitectura lista para microservicios.

**Architecture:** Cuatro estrategias por categoría: (1) `import type` + TypeORM string ref en entidades hijas intra-módulo; (2) eliminación de relaciones TypeORM cross-módulo entre dominios principales; (3) EventEmitter2 para ciclos de servicios; (4) reestructuración de imports de módulos.

**Tech Stack:** NestJS 10, TypeORM 0.3, @nestjs/event-emitter, TypeScript 5, PostgreSQL

---

## File Map

**Entidades a modificar (import type + string ref — lado hijo):**
- `account-segment.entity.ts`, `account-hierarchy-version.entity.ts`, `account-balance.entity.ts`
- `journal-entry-line.entity.ts`, `journal-entry-attachment.entity.ts`, `journal-entry-line-valuation.entity.ts`
- `ledger-mapping-rule-condition.entity.ts`, `dimension-value.entity.ts`, `approval-policy-step.entity.ts`
- `organization-subsidiary.entity.ts`, `plan-feature.entity.ts`, `plan-limit.entity.ts`
- `passkey.entity.ts`, `user-security.entity.ts`
- `coa-template.entity.ts`, `tax-template.entity.ts`, `localization-template.entity.ts`, `tax-scheme.entity.ts`, `fiscal-document-type-definition.entity.ts`
- `tax.entity.ts` (cross-module taxes→localization, mismo patrón)
- `vendor-bill-line.entity.ts`, `vendor-payment.entity.ts`, `bank-transaction.entity.ts`
- `budget-line.entity.ts`, `customer.entity.ts` (solo relación CustomerGroup), `customer-address.entity.ts`, `customer-contact.entity.ts`, `customer-payment-line.entity.ts`
- `invoice-line-item.entity.ts`, `bill-of-material-item.entity.ts`, `price-list-item.entity.ts`
- `proposed-adjustment-evidence.entity.ts`, `quote-line.entity.ts`

**Entidades cross-módulo a modificar (remover relaciones TypeORM):**
- `organization.entity.ts` — remover @OneToMany(User), @ManyToMany(User), @ManyToOne(Plan)
- `user.entity.ts` — remover @ManyToOne(Organization), @ManyToMany(Organization); agregar virtual property
- `role.entity.ts` — remover @ManyToOne(Organization)

**Interfaces y servicios:**
- `auth/interfaces/authenticated-user.interface.ts`
- `auth/strategies/jwt.strategy/jwt.strategy.ts`
- `users/users.service.ts` — remover EventsGateway, agregar org loading
- `auth/services/impersonation.service.ts` — remover 'organization' de relations
- `auth/services/password-recovery.service.ts` — remover 'organization' de relations
- `saas/guards/subscription-active.guard.ts`, `saas/guards/feature-flag.guard.ts`
- `payment/payment.controller.ts`, `saas/saas.controller.ts`

**Módulos:**
- `users/users.module.ts` — remover WebsocketsModule
- `websockets/websockets.module.ts` — remover AuthModule; agregar UserCacheModule
- `websockets/events.gateway.ts` — reemplazar SessionService con JwtService+UserCacheService; agregar @OnEvent handlers
- `audit/audit.module.ts` — remover forwardRef(AuthModule)
- `chart-of-accounts/chart-of-accounts.module.ts` — remover forwardRef(AuthModule), remover forwardRef(JournalEntriesModule)
- `journal-entries/journal-entries.module.ts` — remover forwardRef(AuthModule); agregar evento 'journal-entry.committed'
- `workflows/workflows.module.ts` — remover forwardRef(AuthModule)
- `chart-of-accounts/balance-update.service.ts` — agregar @OnEvent('journal-entry.committed')
- `customers/customers.module.ts` — remover forwardRef(InvoicesModule)

---

### Task 1: Fix CoA intra-module entity circulars

**Files:**
- Modify: `apps/backend/api/src/app/chart-of-accounts/entities/account-segment.entity.ts`
- Modify: `apps/backend/api/src/app/chart-of-accounts/entities/account-hierarchy-version.entity.ts`
- Modify: `apps/backend/api/src/app/chart-of-accounts/entities/account-balance.entity.ts`

- [ ] **Step 1: Fix account-segment.entity.ts**

Replace the file content:
```typescript
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import type { Account } from './account.entity';

@Entity({ name: 'account_segments' })
@Index(['account', 'order'])
export class AccountSegment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('Account', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Column({ type: 'int', comment: 'The order of the segment in the account code (e.g., 0, 1, 2)' })
  order: number;

  @Column({ type: 'varchar', length: 50, comment: 'The value of the segment (e.g., "1101", "01")' })
  value: string;

  @Column({ type: 'varchar', length: 100, nullable: true, comment: 'Optional description for the segment type (e.g., "Cuenta Mayor", "Centro de Costo")' })
  description?: string;
}
```

- [ ] **Step 2: Fix account-hierarchy-version.entity.ts**

Replace the file content:
```typescript
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import type { Account } from "./account.entity";

@Entity({ name: 'account_hierarchy_versions' })
export class AccountHierarchyVersion {
    @PrimaryGeneratedColumn('uuid') id: string;
    @Column() accountId: string;
    @Column({ type: 'uuid', nullable: true }) parentId: string | null;
    @Column() effectiveDate: Date;
    @ManyToOne('Account', { })
    @JoinColumn({ name: 'accountId' })
    account: Account;
}
```

- [ ] **Step 3: Fix account-balance.entity.ts**

Replace the file content:
```typescript
import { Ledger } from '../../accounting/entities/ledger.entity';
import { Entity, Column, ManyToOne, JoinColumn, PrimaryColumn, VersionColumn } from 'typeorm';
import type { Account } from './account.entity';

@Entity({ name: 'account_balances' })
export class AccountBalance {
  @PrimaryColumn({ type: 'uuid', name: 'account_id' })
  accountId: string;

  @PrimaryColumn({ type: 'uuid', name: 'ledger_id' })
  ledgerId: string;

  @ManyToOne('Account', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @ManyToOne(() => Ledger, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ledger_id' })
  ledger: Ledger;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0.0 })
  balance: number;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
    name: 'balance_in_foreign_currency',
    comment: 'Balance in the original foreign currency, if applicable.',
  })
  balanceInForeignCurrency?: number;

  @Column({ name: 'last_updated_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  lastUpdatedAt: Date;

  @VersionColumn({ comment: 'Optimistic lock version to prevent race conditions' })
  version: number;
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/backend/api/src/app/chart-of-accounts/entities/account-segment.entity.ts apps/backend/api/src/app/chart-of-accounts/entities/account-hierarchy-version.entity.ts apps/backend/api/src/app/chart-of-accounts/entities/account-balance.entity.ts
git commit -m "fix(entities): break CoA intra-module circular imports with import type"
```

---

### Task 2: Fix journal-entries intra-module entity circulars

**Files:**
- Modify: `apps/backend/api/src/app/journal-entries/entities/journal-entry-line.entity.ts`
- Modify: `apps/backend/api/src/app/journal-entries/entities/journal-entry-attachment.entity.ts`
- Modify: `apps/backend/api/src/app/journal-entries/entities/journal-entry-line-valuation.entity.ts`

- [ ] **Step 1: Fix journal-entry-line.entity.ts**

```typescript
import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, OneToMany,
} from 'typeorm';
import type { JournalEntry } from './journal-entry.entity';
import { Account } from '../../chart-of-accounts/entities/account.entity';
import { JournalEntryLineValuation } from './journal-entry-line-valuation.entity';

@Entity({ name: 'journal_entry_lines' })
export class JournalEntryLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('JournalEntry', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'journal_entry_id' })
  journalEntry: JournalEntry;

  @ManyToOne(() => Account, { nullable: false, eager: true })
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @Column({ name: 'account_id' })
  accountId: string;

  @Column('decimal', { precision: 18, scale: 2, default: 0.00, comment: 'Amount in base currency for the primary ledger' })
  debit: number;

  @Column('decimal', { precision: 18, scale: 2, default: 0.00, comment: 'Amount in base currency for the primary ledger' })
  credit: number;

  @Column('decimal', { precision: 18, scale: 2, nullable: true, name: 'foreign_currency_debit' })
  foreignCurrencyDebit?: number;

  @Column('decimal', { precision: 18, scale: 2, nullable: true, name: 'foreign_currency_credit' })
  foreignCurrencyCredit?: number;

  @Column({ length: 3, nullable: true, name: 'currency_code' })
  currencyCode?: string;

  @Column('decimal', { precision: 18, scale: 6, nullable: true, name: 'exchange_rate' })
  exchangeRate?: number;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'jsonb', nullable: true, name: 'dimensions' })
  dimensions?: Record<string, string>;

  @OneToMany(() => JournalEntryLineValuation, valuation => valuation.journalEntryLine, { cascade: true, eager: true })
  valuations: JournalEntryLineValuation[];

  @Column({ name: 'is_reconciled', default: false, comment: 'Indicates if the line has been reconciled against a bank statement.' })
  isReconciled: boolean;
}
```

- [ ] **Step 2: Fix journal-entry-attachment.entity.ts**

```typescript
import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn,
} from 'typeorm';
import type { JournalEntry } from './journal-entry.entity';
import { User } from '../../users/entities/user.entity/user.entity';

@Entity({ name: 'journal_entry_attachments' })
export class JournalEntryAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('JournalEntry', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'journal_entry_id' })
  journalEntry: JournalEntry;

  @Column({ name: 'journal_entry_id' })
  journalEntryId: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'file_name' })
  fileName: string;

  @Column({ name: 'file_type' })
  fileType: string;

  @Column({ name: 'file_size' })
  fileSize: number;

  @Column({ name: 'storage_key', comment: 'The key/path of the file in the storage service (e.g., S3 key)' })
  storageKey: string;

  @CreateDateColumn({ name: 'uploaded_at' })
  uploadedAt: Date;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'uploaded_by_user_id' })
  uploadedBy: User;

  @Column({ name: 'uploaded_by_user_id' })
  uploadedByUserId: string;
}
```

- [ ] **Step 3: Fix journal-entry-line-valuation.entity.ts**

```typescript
import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import type { JournalEntryLine } from './journal-entry-line.entity';
import { Ledger } from '../../accounting/entities/ledger.entity';

@Entity({ name: 'journal_entry_line_valuations' })
export class JournalEntryLineValuation {
  @PrimaryColumn({ type: 'uuid', name: 'journal_entry_line_id' })
  journalEntryLineId: string;

  @PrimaryColumn({ type: 'uuid', name: 'ledger_id' })
  ledgerId: string;

  @ManyToOne('JournalEntryLine', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'journal_entry_line_id' })
  journalEntryLine: JournalEntryLine;

  @ManyToOne(() => Ledger, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ledger_id' })
  ledger: Ledger;

  @Column('decimal', { precision: 18, scale: 2, comment: 'Debit amount in the context of the specified ledger' })
  debit: number;

  @Column('decimal', { precision: 18, scale: 2, comment: 'Credit amount in the context of the specified ledger' })
  credit: number;
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/backend/api/src/app/journal-entries/entities/
git commit -m "fix(entities): break journal-entries intra-module circular imports"
```

---

### Task 3: Fix remaining intra-module entity circulars (batch)

**Files:** 17 entity files across multiple modules

- [ ] **Step 1: Fix ledger-mapping-rule-condition.entity.ts**

In `apps/backend/api/src/app/accounting/entities/ledger-mapping-rule-condition.entity.ts`, change:
```typescript
// BEFORE
import { LedgerMappingRule } from './ledger-mapping-rule.entity';
// ...
@ManyToOne(() => LedgerMappingRule, (rule) => rule.conditions, { onDelete: 'CASCADE', nullable: false })
```
```typescript
// AFTER
import type { LedgerMappingRule } from './ledger-mapping-rule.entity';
// ...
@ManyToOne('LedgerMappingRule', { onDelete: 'CASCADE', nullable: false })
```

- [ ] **Step 2: Fix dimension-value.entity.ts**

In `apps/backend/api/src/app/dimensions/entities/dimension-value.entity.ts`, change:
```typescript
// BEFORE
import { Dimension } from './dimension.entity';
// ...
@ManyToOne(() => Dimension, (dimension) => dimension.values, { onDelete: 'CASCADE' })
```
```typescript
// AFTER
import type { Dimension } from './dimension.entity';
// ...
@ManyToOne('Dimension', { onDelete: 'CASCADE' })
```

- [ ] **Step 3: Fix approval-policy-step.entity.ts**

In `apps/backend/api/src/app/workflows/entities/approval-policy-step.entity.ts`, change:
```typescript
// BEFORE
import { ApprovalPolicy } from './approval-policy.entity';
// ...
@ManyToOne(() => ApprovalPolicy, (policy) => policy.steps)
policy: ApprovalPolicy;
```
```typescript
// AFTER
import type { ApprovalPolicy } from './approval-policy.entity';
// ...
@ManyToOne('ApprovalPolicy')
policy: ApprovalPolicy;
```

- [ ] **Step 4: Fix organization-subsidiary.entity.ts**

Replace full content of `apps/backend/api/src/app/organizations/entities/organization-subsidiary.entity.ts`:
```typescript
import { Entity, PrimaryColumn, ManyToOne, JoinColumn, Column } from 'typeorm';
import type { Organization } from './organization.entity';

@Entity({ name: 'organization_subsidiaries' })
export class OrganizationSubsidiary {
  @PrimaryColumn({ name: 'parent_organization_id' })
  parentOrganizationId: string;

  @PrimaryColumn({ name: 'subsidiary_organization_id' })
  subsidiaryOrganizationId: string;

  @ManyToOne('Organization', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_organization_id' })
  parent: Organization;

  @ManyToOne('Organization', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subsidiary_organization_id' })
  subsidiary: Organization;

  @Column({ type: 'decimal', precision: 5, scale: 2, comment: 'Porcentaje de propiedad' })
  ownership: number;
}
```

- [ ] **Step 5: Fix plan-feature.entity.ts**

In `apps/backend/api/src/app/saas/entities/plan-feature.entity.ts`, change:
```typescript
// BEFORE
import { Plan } from './plan.entity';
// ...
@ManyToOne(() => Plan, plan => plan.features, { onDelete: 'CASCADE' })
plan: Plan;
```
```typescript
// AFTER
import type { Plan } from './plan.entity';
// ...
@ManyToOne('Plan', { onDelete: 'CASCADE' })
plan: Plan;
```

- [ ] **Step 6: Fix plan-limit.entity.ts**

In `apps/backend/api/src/app/saas/entities/plan-limit.entity.ts`, change:
```typescript
// BEFORE
import { Plan } from './plan.entity';
// ...
@ManyToOne(() => Plan, (plan) => plan.limits)
@JoinColumn({ name: 'plan_id' })
plan: Plan;
```
```typescript
// AFTER
import type { Plan } from './plan.entity';
// ...
@ManyToOne('Plan')
@JoinColumn({ name: 'plan_id' })
plan: Plan;
```

- [ ] **Step 7: Fix passkey.entity.ts**

In `apps/backend/api/src/app/users/entities/passkey.entity.ts`, change:
```typescript
// BEFORE
import { User } from './user.entity/user.entity';
// ...
@ManyToOne(() => User, (user) => user.passkeys, { onDelete: 'CASCADE' })
@JoinColumn({ name: 'userId' })
user: User;
```
```typescript
// AFTER
import type { User } from './user.entity/user.entity';
// ...
@ManyToOne('User', { onDelete: 'CASCADE' })
@JoinColumn({ name: 'userId' })
user: User;
```

- [ ] **Step 8: Fix user-security.entity.ts**

In `apps/backend/api/src/app/users/entities/user-security.entity.ts`, change:
```typescript
// BEFORE
import { User } from './user.entity/user.entity';
// ...
@OneToOne(() => User, user => user.security, { onDelete: 'CASCADE' })
@JoinColumn({ name: 'user_id' })
user: User;
```
```typescript
// AFTER
import type { User } from './user.entity/user.entity';
// ...
@OneToOne('User', 'security', { onDelete: 'CASCADE' })
@JoinColumn({ name: 'user_id' })
user: User;
```

- [ ] **Step 9: Fix vendor-bill-line.entity.ts**

In `apps/backend/api/src/app/accounts-payable/entities/vendor-bill-line.entity.ts`, change:
```typescript
// BEFORE
import { VendorBill } from './vendor-bill.entity';
// ...
@ManyToOne(() => VendorBill, (vendorBill) => vendorBill.lines)
vendorBill: VendorBill;
```
```typescript
// AFTER
import type { VendorBill } from './vendor-bill.entity';
// ...
@ManyToOne('VendorBill')
vendorBill: VendorBill;
```

- [ ] **Step 10: Fix vendor-payment.entity.ts**

In `apps/backend/api/src/app/accounts-payable/entities/vendor-payment.entity.ts`, change:
```typescript
// BEFORE
import { PaymentBatch } from './payment-batch.entity';
// ...
@ManyToOne(() => PaymentBatch, batch => batch.payments, { onDelete: 'CASCADE' })
@JoinColumn({ name: 'payment_batch_id' })
paymentBatch: PaymentBatch;
```
```typescript
// AFTER
import type { PaymentBatch } from './payment-batch.entity';
// ...
@ManyToOne('PaymentBatch', { onDelete: 'CASCADE' })
@JoinColumn({ name: 'payment_batch_id' })
paymentBatch: PaymentBatch;
```

- [ ] **Step 11: Fix bank-transaction.entity.ts**

In `apps/backend/api/src/app/reconciliation/entities/bank-transaction.entity.ts`, change:
```typescript
// BEFORE
import { BankStatement } from './bank-statement.entity';
// ...
@ManyToOne(() => BankStatement, { onDelete: 'CASCADE' })
@JoinColumn({ name: 'statement_id' })
statement: BankStatement;
```
```typescript
// AFTER
import type { BankStatement } from './bank-statement.entity';
// ...
@ManyToOne('BankStatement', { onDelete: 'CASCADE' })
@JoinColumn({ name: 'statement_id' })
statement: BankStatement;
```

- [ ] **Step 12: Fix budget-line.entity.ts**

In `apps/backend/api/src/app/budgets/entities/budget-line.entity.ts`, change:
```typescript
// BEFORE
import { Budget } from './budget.entity';
// ...
@ManyToOne(() => Budget, (budget) => budget.lines, { onDelete: 'CASCADE' })
budget: Budget;
```
```typescript
// AFTER
import type { Budget } from './budget.entity';
// ...
@ManyToOne('Budget', { onDelete: 'CASCADE' })
budget: Budget;
```

- [ ] **Step 13: Fix customer-address.entity.ts**

In `apps/backend/api/src/app/customers/entities/customer-address.entity.ts`, change:
```typescript
// BEFORE
import { Customer } from './customer.entity';
// ...
@ManyToOne(() => Customer, (customer) => customer.addresses, { onDelete: 'CASCADE' })
@JoinColumn({ name: 'customer_id' })
customer: Customer;
```
```typescript
// AFTER
import type { Customer } from './customer.entity';
// ...
@ManyToOne('Customer', { onDelete: 'CASCADE' })
@JoinColumn({ name: 'customer_id' })
customer: Customer;
```

- [ ] **Step 14: Fix customer-contact.entity.ts**

In `apps/backend/api/src/app/customers/entities/customer-contact.entity.ts`, change:
```typescript
// BEFORE
import { Customer } from './customer.entity';
// ...
@ManyToOne(() => Customer, (customer) => customer.contacts, { onDelete: 'CASCADE' })
@JoinColumn({ name: 'customer_id' })
customer: Customer;
```
```typescript
// AFTER
import type { Customer } from './customer.entity';
// ...
@ManyToOne('Customer', { onDelete: 'CASCADE' })
@JoinColumn({ name: 'customer_id' })
customer: Customer;
```

- [ ] **Step 15: Fix customer.entity.ts (CustomerGroup relation only)**

In `apps/backend/api/src/app/customers/entities/customer.entity.ts`, change just the CustomerGroup import and decorator:
```typescript
// ADD this import (type-only):
import type { CustomerGroup } from './customer-group.entity';

// REMOVE the existing CustomerGroup import:
// import { CustomerGroup } from './customer-group.entity';  ← remove

// CHANGE the decorator:
// BEFORE:
@ManyToOne(() => CustomerGroup, (group) => group.customers, { nullable: true })
@JoinColumn({ name: 'customer_group_id' })
group?: CustomerGroup;

// AFTER:
@ManyToOne('CustomerGroup', { nullable: true })
@JoinColumn({ name: 'customer_group_id' })
group?: CustomerGroup;
```

- [ ] **Step 16: Fix customer-payment-line.entity.ts**

In `apps/backend/api/src/app/customers/entities/customer-payment-line.entity.ts`, change:
```typescript
// BEFORE
import { CustomerPayment } from './customer-payment.entity';
// ...
@ManyToOne(() => CustomerPayment, (payment) => payment.lines)
@JoinColumn({ name: 'payment_id' })
payment: CustomerPayment;
```
```typescript
// AFTER
import type { CustomerPayment } from './customer-payment.entity';
// ...
@ManyToOne('CustomerPayment')
@JoinColumn({ name: 'payment_id' })
payment: CustomerPayment;
```

- [ ] **Step 17: Fix invoice-line-item.entity.ts**

In `apps/backend/api/src/app/invoices/entities/invoice-line-item.entity.ts`, change:
```typescript
// BEFORE
import { Invoice } from './invoice.entity';
// ...
@ManyToOne(() => Invoice, (invoice) => invoice.lineItems)
invoice: Invoice;
```
```typescript
// AFTER
import type { Invoice } from './invoice.entity';
// ...
@ManyToOne('Invoice')
invoice: Invoice;
```

- [ ] **Step 18: Fix bill-of-material-item.entity.ts**

In `apps/backend/api/src/app/manufacturing/entities/bill-of-material-item.entity.ts`, change:
```typescript
// BEFORE
import { BillOfMaterial } from './bill-of-material.entity';
// ...
@ManyToOne(() => BillOfMaterial, (bom) => bom.items)
@JoinColumn({ name: 'bill_of_material_id' })
billOfMaterial: BillOfMaterial;
```
```typescript
// AFTER
import type { BillOfMaterial } from './bill-of-material.entity';
// ...
@ManyToOne('BillOfMaterial')
@JoinColumn({ name: 'bill_of_material_id' })
billOfMaterial: BillOfMaterial;
```

- [ ] **Step 19: Fix price-list-item.entity.ts**

In `apps/backend/api/src/app/price-lists/entities/price-list-item.entity.ts`, change:
```typescript
// BEFORE
import { PriceList } from './price-list.entity';
// ...
@ManyToOne(() => PriceList, (priceList) => priceList.items, { onDelete: 'CASCADE' })
@JoinColumn({ name: 'price_list_id' })
priceList: PriceList;
```
```typescript
// AFTER
import type { PriceList } from './price-list.entity';
// ...
@ManyToOne('PriceList', { onDelete: 'CASCADE' })
@JoinColumn({ name: 'price_list_id' })
priceList: PriceList;
```

- [ ] **Step 20: Fix proposed-adjustment-evidence.entity.ts**

In `apps/backend/api/src/app/audit/entities/proposed-adjustment-evidence.entity.ts`, change:
```typescript
// BEFORE
import { ProposedAdjustment } from './proposed-adjustment.entity';
// ...
@ManyToOne(() => ProposedAdjustment, (adjustment) => adjustment.evidence, { onDelete: 'CASCADE' })
@JoinColumn({ name: 'proposed_adjustment_id' })
proposedAdjustment: ProposedAdjustment;
```
```typescript
// AFTER
import type { ProposedAdjustment } from './proposed-adjustment.entity';
// ...
@ManyToOne('ProposedAdjustment', { onDelete: 'CASCADE' })
@JoinColumn({ name: 'proposed_adjustment_id' })
proposedAdjustment: ProposedAdjustment;
```

- [ ] **Step 21: Fix quote-line.entity.ts**

In `apps/backend/api/src/app/sales/entities/quote-line.entity.ts`, change:
```typescript
// BEFORE
import { Quote } from './quote.entity';
// ...
@ManyToOne(() => Quote, (quote) => quote.lines, { onDelete: 'CASCADE' })
@JoinColumn({ name: 'quote_id' })
quote: Quote;
```
```typescript
// AFTER
import type { Quote } from './quote.entity';
// ...
@ManyToOne('Quote', { onDelete: 'CASCADE' })
@JoinColumn({ name: 'quote_id' })
quote: Quote;
```

- [ ] **Step 22: Commit batch**

```bash
git add apps/backend/api/src/app/accounting/entities/ledger-mapping-rule-condition.entity.ts apps/backend/api/src/app/dimensions/entities/dimension-value.entity.ts apps/backend/api/src/app/workflows/entities/approval-policy-step.entity.ts apps/backend/api/src/app/organizations/entities/organization-subsidiary.entity.ts apps/backend/api/src/app/saas/entities/plan-feature.entity.ts apps/backend/api/src/app/saas/entities/plan-limit.entity.ts apps/backend/api/src/app/users/entities/passkey.entity.ts apps/backend/api/src/app/users/entities/user-security.entity.ts apps/backend/api/src/app/accounts-payable/entities/vendor-bill-line.entity.ts apps/backend/api/src/app/accounts-payable/entities/vendor-payment.entity.ts apps/backend/api/src/app/reconciliation/entities/bank-transaction.entity.ts apps/backend/api/src/app/budgets/entities/budget-line.entity.ts apps/backend/api/src/app/customers/entities/customer-address.entity.ts apps/backend/api/src/app/customers/entities/customer-contact.entity.ts apps/backend/api/src/app/customers/entities/customer.entity.ts apps/backend/api/src/app/customers/entities/customer-payment-line.entity.ts apps/backend/api/src/app/invoices/entities/invoice-line-item.entity.ts apps/backend/api/src/app/manufacturing/entities/bill-of-material-item.entity.ts apps/backend/api/src/app/price-lists/entities/price-list-item.entity.ts apps/backend/api/src/app/audit/entities/proposed-adjustment-evidence.entity.ts apps/backend/api/src/app/sales/entities/quote-line.entity.ts
git commit -m "fix(entities): break intra-module circular imports across all domains"
```

---

### Task 4: Fix localization module entity circulars

**Files:**
- Modify: `apps/backend/api/src/app/localization/entities/coa-template.entity.ts`
- Modify: `apps/backend/api/src/app/localization/entities/tax-template.entity.ts`
- Modify: `apps/backend/api/src/app/localization/entities/localization-template.entity.ts`
- Modify: `apps/backend/api/src/app/localization/entities/tax-scheme.entity.ts`
- Modify: `apps/backend/api/src/app/localization/entities/fiscal-document-type-definition.entity.ts`
- Modify: `apps/backend/api/src/app/taxes/entities/tax.entity.ts`

- [ ] **Step 1: Fix coa-template.entity.ts**

```typescript
import { CreateAccountDto } from "../../chart-of-accounts/dto/create-account.dto";
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from "typeorm";
import type { LocalizationTemplate } from "./localization-template.entity";

export interface AccountTemplateDto extends Omit<CreateAccountDto, 'parentId'> {
    children?: AccountTemplateDto[];
}

@Entity({ name: 'coa_templates' })
export class CoaTemplate {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    countryCode: string;

    @Column({ type: 'jsonb' })
    accounts: AccountTemplateDto[];

    @ManyToOne('LocalizationTemplate', 'coaTemplate')
    template: LocalizationTemplate;
}
```

- [ ] **Step 2: Fix tax-template.entity.ts**

```typescript
import { CreateTaxDto } from "../../taxes/dto/create-tax.dto";
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, ManyToMany } from "typeorm";
import type { LocalizationTemplate } from "./localization-template.entity";
import type { FiscalRegion } from "./fiscal-region.entity";

@Entity({ name: 'tax_templates' })
export class TaxTemplate {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    countryCode: string;

    @Column()
    name: string;

    @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
    rate: number;

    @Column({ default: 'VAT' })
    type: string;

    @ManyToOne('LocalizationTemplate', 'taxTemplates')
    template: LocalizationTemplate;

    @ManyToMany('FiscalRegion', 'defaultTaxes')
    fiscalRegions: FiscalRegion[];
}
```

- [ ] **Step 3: Fix localization-template.entity.ts**

```typescript
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import type { FiscalRegion } from './fiscal-region.entity';
import { CoaTemplate } from './coa-template.entity';
import { TaxTemplate } from './tax-template.entity';

@Entity({ name: 'localization_templates' })
export class LocalizationTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('FiscalRegion')
  @JoinColumn({ name: 'fiscal_region_id' })
  fiscalRegion: FiscalRegion;

  @Column({ name: 'fiscal_region_id' })
  fiscalRegionId: string;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ default: true })
  isActive: boolean;

  @OneToMany(() => CoaTemplate, (coa) => coa.template, { cascade: true })
  coaTemplate: CoaTemplate[];

  @OneToMany(() => TaxTemplate, (tax) => tax.template, { cascade: true })
  taxTemplates: TaxTemplate[];
}
```

- [ ] **Step 4: Fix tax-scheme.entity.ts**

```typescript
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import type { FiscalRegion } from './fiscal-region.entity';
import { TaxConfiguration } from '../../taxes/entities/tax-configuration.entity';

@Entity({ name: 'tax_schemes' })
export class TaxScheme {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ name: 'fiscal_region_id' })
  fiscalRegionId: string;

  @ManyToOne('FiscalRegion', 'taxSchemes')
  @JoinColumn({ name: 'fiscal_region_id' })
  fiscalRegion: FiscalRegion;

  @Column({ type: 'jsonb' })
  configurations: Partial<TaxConfiguration>[];
}
```

- [ ] **Step 5: Fix fiscal-document-type-definition.entity.ts**

```typescript
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import type { FiscalRegion } from './fiscal-region.entity';

@Entity({ name: 'fiscal_document_type_definitions' })
export class FiscalDocumentTypeDefinition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  code: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  sequenceFormat: string;

  @Column({ default: false })
  expirationRequired: boolean;

  @ManyToOne('FiscalRegion', 'documentDefinitions')
  fiscalRegion: FiscalRegion;
}
```

- [ ] **Step 6: Fix tax.entity.ts (cross-module taxes→localization)**

In `apps/backend/api/src/app/taxes/entities/tax.entity.ts`, change:
```typescript
// BEFORE
import { TaxGroup } from '../../localization/entities/tax-group.entity';
// ...
@ManyToOne(() => TaxGroup, group => group.taxes, { nullable: true })
@JoinColumn({ name: 'tax_group_id' })
taxGroup?: TaxGroup;
```
```typescript
// AFTER
import type { TaxGroup } from '../../localization/entities/tax-group.entity';
// ...
@ManyToOne('TaxGroup', { nullable: true })
@JoinColumn({ name: 'tax_group_id' })
taxGroup?: TaxGroup;
```

- [ ] **Step 7: Commit**

```bash
git add apps/backend/api/src/app/localization/entities/ apps/backend/api/src/app/taxes/entities/tax.entity.ts
git commit -m "fix(entities): break localization and taxes-localization circular imports"
```

---

### Task 5: Break Organization ↔ User cross-module entity cycle

**Files:**
- Modify: `apps/backend/api/src/app/organizations/entities/organization.entity.ts`

- [ ] **Step 1: Remove User and Plan TypeORM relations from Organization entity**

Replace the full content of `apps/backend/api/src/app/organizations/entities/organization.entity.ts`:
```typescript
import { Entity, PrimaryGeneratedColumn, Column, OneToMany, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { OrganizationSubsidiary } from './organization-subsidiary.entity';

@Entity('organizations')
@Index(['taxId', 'fiscalRegionId'], { unique: true, where: '"tax_id" IS NOT NULL' })
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'legal_name' })
  legalName: string;

  @Column({ name: 'tax_id', nullable: true })
  taxId: string;

  @Column({ nullable: true })
  address: string;

  @Column({ nullable: true })
  city: string;

  @Column({ nullable: true })
  country: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  website: string;

  @Column({ nullable: true })
  industry: string;

  @Column({ name: 'logo_url', nullable: true })
  logoUrl: string;

  @Column({ name: 'fiscal_region_id', nullable: true })
  fiscalRegionId: string;

  @Column({ name: 'stripe_customer_id', nullable: true })
  externalCustomerId: string;

  @Column({ name: 'stripe_subscription_id', nullable: true })
  externalSubscriptionId: string;

  @Column({ name: 'subscription_status', nullable: true })
  subscriptionStatus: string;

  @Column({ name: 'subscription_period_start', type: 'timestamptz', nullable: true })
  subscriptionPeriodStart: Date;

  @Column({ name: 'subscription_period_end', type: 'timestamptz', nullable: true })
  subscriptionPeriodEnd: Date;

  @Column({ name: 'grace_period_end', type: 'timestamptz', nullable: true })
  gracePeriodEnd: Date;

  @Column({ default: 'UTC' })
  timezone: string;

  @Column({ name: 'plan_id', nullable: true })
  planId: string;

  @OneToMany(() => OrganizationSubsidiary, sub => sub.parent)
  subsidiaries: OrganizationSubsidiary[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/backend/api/src/app/organizations/entities/organization.entity.ts
git commit -m "fix(entities): remove cross-module User/Plan TypeORM relations from Organization"
```

---

### Task 6: Update User entity — remove cross-module TypeORM relations

**Files:**
- Modify: `apps/backend/api/src/app/users/entities/user.entity/user.entity.ts`

- [ ] **Step 1: Remove Organization TypeORM decorators, keep ID column + virtual property**

Replace the full content of `apps/backend/api/src/app/users/entities/user.entity/user.entity.ts`:
```typescript
import {
  Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn,
  ManyToMany, JoinTable, OneToOne,
} from 'typeorm';
import type { Organization } from '../../../organizations/entities/organization.entity';
import { Role } from '../../../roles/entities/role.entity';
import { Passkey } from '../passkey.entity';
import { UserSecurity } from '../user-security.entity';

export enum UserStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  ARCHIVED = 'ARCHIVED',
  BLOCKED = 'BLOCKED',
}

@Entity({ name: 'users' })
export class User {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  firstName: string;

  @Column({ length: 100 })
  lastName: string;

  @Column({ length: 255, unique: true })
  email: string;

  @Column({ name: 'auth_provider', nullable: true })
  authProvider?: string;

  @Column({ name: 'auth_provider_id', nullable: true })
  authProviderId?: string;

  @Column({ nullable: true })
  avatarUrl?: string;

  @Column({ nullable: true })
  department?: string;

  @Column({ name: 'job_title', nullable: true })
  jobTitle?: string;

  @Column({
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.ACTIVE,
  })
  status: UserStatus;

  @Column({ name: 'is_online', default: false })
  isOnline: boolean;

  @Column({ name: 'last_activity', type: 'timestamptz', nullable: true })
  lastActivity?: Date;

  @Column({ name: 'organization_id' })
  organizationId: string;

  // Virtual property — populated manually by services, NOT a TypeORM relation.
  // TypeORM does not persist this field.
  organization?: Organization;

  // Virtual property — populated manually for multi-tenant access checks.
  organizations?: Array<{ id: string; legalName: string }>;

  @ManyToMany(() => Role, { eager: false })
  @JoinTable({
    name: 'user_roles',
    joinColumn: { name: 'user_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'role_id', referencedColumnName: 'id' },
  })
  roles: Role[];

  permissions?: string[];

  isImpersonating?: boolean;
  originalUserId?: string;

  @Column({ name: 'preferred_language', length: 5, nullable: true })
  preferredLanguage?: string;

  @Column({ type: 'varchar', length: 20, unique: true, nullable: true })
  phone?: string | null;

  @Column({ name: 'is_phone_verified', default: false })
  isPhoneVerified: boolean;

  @Column({ name: 'is_email_verified', default: false })
  isEmailVerified: boolean;

  @OneToOne(() => UserSecurity, (security) => security.user, {
    cascade: true,
    eager: false,
  })
  security: UserSecurity;

  @Column({ nullable: true })
  invitationToken?: string;

  @Column({ type: 'timestamptz', nullable: true })
  invitationTokenExpires?: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToMany(() => Passkey, { cascade: true })
  passkeys: Passkey[];
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/backend/api/src/app/users/entities/user.entity/user.entity.ts
git commit -m "fix(entities): remove cross-module Organization TypeORM relations from User"
```

---

### Task 7: Update Role entity — remove Organization TypeORM relation

**Files:**
- Modify: `apps/backend/api/src/app/roles/entities/role.entity.ts`

- [ ] **Step 1: Remove Organization TypeORM relation**

Replace the full content of `apps/backend/api/src/app/roles/entities/role.entity.ts`:
```typescript
import {
    Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'roles' })
export class Role {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ length: 100 })
    name: string;

    @Column({ type: 'text', nullable: true })
    description: string;

    @Column('simple-array')
    permissions: string[];

    @Column({ name: 'is_system_role', default: false })
    isSystemRole: boolean;

    @Column({ name: 'organization_id' })
    organizationId: string;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt: Date;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/backend/api/src/app/roles/entities/role.entity.ts
git commit -m "fix(entities): remove cross-module Organization TypeORM relation from Role"
```

---

### Task 8: Update UsersService — load organization explicitly

**Files:**
- Modify: `apps/backend/api/src/app/users/users.service.ts`
- Modify: `apps/backend/api/src/app/users/users.module.ts`

- [ ] **Step 1: Add OrganizationRepository injection and update findUserForAuth/findUserByIdForAuth**

In `users.service.ts`, add `@InjectRepository(Organization)` in constructor and update the two auth methods. Add to imports at the top:
```typescript
import { Organization } from '../organizations/entities/organization.entity';
```

Update constructor to add:
```typescript
@InjectRepository(Organization)
private readonly orgRepository: Repository<Organization>,
```

Update `findUserForAuth`:
```typescript
async findUserForAuth(email: string): Promise<User | null> {
    const user = await this.userRepository.findOne({
        where: { email },
        relations: ['roles', 'security'],
    });
    if (!user) return null;
    user.organization = await this.orgRepository.findOneBy({ id: user.organizationId }) ?? undefined;
    return user;
}
```

Update `findUserByIdForAuth`:
```typescript
async findUserByIdForAuth(id: string): Promise<User | null> {
    const user = await this.userRepository.createQueryBuilder('user')
        .where('user.id = :id', { id })
        .leftJoinAndSelect('user.roles', 'roles')
        .leftJoinAndSelect('user.security', 'security')
        .getOne();

    if (!user) return null;

    user.organization = await this.orgRepository.findOneBy({ id: user.organizationId }) ?? undefined;

    const userOrgRows = await this.orgRepository.query(
        'SELECT o.id, o.legal_name as "legalName" FROM organizations o INNER JOIN user_organizations uo ON uo.organization_id = o.id WHERE uo.user_id = $1',
        [id]
    ) as Array<{ id: string; legalName: string }>;
    user.organizations = userOrgRows;

    return user;
}
```

- [ ] **Step 2: Verify UsersModule registers Organization entity**

In `apps/backend/api/src/app/users/users.module.ts`, confirm `Organization` is in `TypeOrmModule.forFeature`. The current code already has:
```typescript
TypeOrmModule.forFeature([User, Organization]),
```
No change needed.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/api/src/app/users/users.service.ts
git commit -m "fix(users): load Organization explicitly after removing TypeORM relation"
```

---

### Task 9: Update impersonation and password-recovery services

**Files:**
- Modify: `apps/backend/api/src/app/auth/services/impersonation.service.ts`
- Modify: `apps/backend/api/src/app/auth/services/password-recovery.service.ts`

- [ ] **Step 1: Fix impersonation.service.ts**

In `impersonation.service.ts`, change both findOne calls — remove `'organization'` from relations arrays:

Line ~40-43:
```typescript
// BEFORE
const targetUser = await this.userRepository.findOne({
  where: { id: targetUserId },
  relations: ['roles', 'organization'],
});

// AFTER
const targetUser = await this.userRepository.findOne({
  where: { id: targetUserId },
  relations: ['roles'],
});
```

Line ~80-84:
```typescript
// BEFORE
const adminUser = await this.userRepository.findOne({
  where: { id: impersonatingUser.originalUserId },
  relations: ['roles', 'organization'],
});

// AFTER
const adminUser = await this.userRepository.findOne({
  where: { id: impersonatingUser.originalUserId },
  relations: ['roles'],
});
```

- [ ] **Step 2: Fix password-recovery.service.ts**

In `password-recovery.service.ts`, line ~146-153:
```typescript
// BEFORE
const user = await this.userRepository.findOne({
  where: {
    invitationToken: token,
    status: UserStatus.PENDING,
    invitationTokenExpires: MoreThan(new Date()),
  },
  relations: ['roles', 'organization', 'security'],
});

// AFTER
const user = await this.userRepository.findOne({
  where: {
    invitationToken: token,
    status: UserStatus.PENDING,
    invitationTokenExpires: MoreThan(new Date()),
  },
  relations: ['roles', 'security'],
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/backend/api/src/app/auth/services/impersonation.service.ts apps/backend/api/src/app/auth/services/password-recovery.service.ts
git commit -m "fix(auth): remove stale 'organization' relation from auth service queries"
```

---

### Task 10: Update AuthenticatedUser interface and JWT strategy

**Files:**
- Modify: `apps/backend/api/src/app/auth/interfaces/authenticated-user.interface.ts`
- Modify: `apps/backend/api/src/app/auth/strategies/jwt.strategy/jwt.strategy.ts`

- [ ] **Step 1: Update authenticated-user.interface.ts**

Replace the full content:
```typescript
import { User } from '../../users/entities/user.entity/user.entity';
import type { Organization } from '../../organizations/entities/organization.entity';

export interface SafeUser extends Partial<Omit<User, 'password' | 'twoFactorSecret'>> {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  organizationId: string;
  roles: any[];
  permissions: string[];
  organization?: Organization;
  isTwoFactorEnabled?: boolean;
}

export interface AuthenticatedUser extends SafeUser {
  isImpersonating?: boolean;
  originalUserId?: string;
}
```

- [ ] **Step 2: Update jwt.strategy.ts**

In `jwt.strategy.ts`, the `validate` method uses `user.organization` and `user.organizations` which are now virtual properties populated by `findUserByIdForAuth`. The code at lines 130, 139, 142, 153-156, 167, 170 must be updated:

```typescript
// Line 130 — BEFORE:
if (!user.organization) {
// AFTER — same check still works because organization is virtual property set by findUserByIdForAuth

// Line 139 — BEFORE:
const isCurrentOrg = user.organization?.id === organizationId;
// AFTER — same, works with virtual property

// Line 142 — BEFORE:
const hasAccess = isCurrentOrg || (user.organizations && user.organizations.some(o => o.id === organizationId));
// AFTER — same, works with virtual property array

// Line 153-156 — BEFORE:
const switchedOrg = user.organizations.find(o => o.id === organizationId);
if (switchedOrg) { user.organization = switchedOrg; }
// AFTER — organizations is now Array<{id, legalName}>, need to load full org for switch:
if (!isCurrentOrg && hasAccess) {
    const switchedOrgId = organizationId;
    if (user.organizations?.some(o => o.id === switchedOrgId)) {
        // Load full org object for the switched context — inject orgRepository
        const switchedOrg = await this.orgRepository.findOneBy({ id: switchedOrgId });
        if (switchedOrg) { (user as any).organization = switchedOrg; }
    }
}

// Line 167 — BEFORE:
organizationId: user.organization.id,
// AFTER:
organizationId: user.organizationId,

// Line 170 — BEFORE:
organization: user.organization,
// AFTER — same, works with virtual property
```

Add to constructor of `JwtStrategy`:
```typescript
@InjectRepository(Organization)
private readonly orgRepository: Repository<Organization>,
```

Add import at top:
```typescript
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from '../../../organizations/entities/organization.entity';
```

Add to `auth.module.ts` TypeOrmModule.forFeature (already has Organization, no change needed).

- [ ] **Step 3: Commit**

```bash
git add apps/backend/api/src/app/auth/interfaces/authenticated-user.interface.ts apps/backend/api/src/app/auth/strategies/jwt.strategy/jwt.strategy.ts
git commit -m "fix(auth): update JWT strategy to work with virtual Organization property on User"
```

---

### Task 11: Update guards and controllers that use user.organization

**Files:**
- Modify: `apps/backend/api/src/app/payment/payment.controller.ts`
- Modify: `apps/backend/api/src/app/saas/saas.controller.ts`
- Modify: `apps/backend/api/src/app/saas/guards/feature-flag.guard.ts`

- [ ] **Step 1: Fix payment.controller.ts**

Find line: `user.organization.id`
Replace with: `user.organizationId`

- [ ] **Step 2: Fix saas.controller.ts**

Find line: `user.organization.id`
Replace with: `user.organizationId`

- [ ] **Step 3: Fix feature-flag.guard.ts**

Find line: `this.saasService.checkFeature(user.organization.id, featureKey)`
Replace with: `this.saasService.checkFeature(user.organizationId, featureKey)`

Note: `subscription-active.guard.ts` uses `user.organization.subscriptionStatus`. Since `user.organization` is still populated as a virtual property by the JWT strategy, this continues to work. No change needed.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/api/src/app/payment/payment.controller.ts apps/backend/api/src/app/saas/saas.controller.ts apps/backend/api/src/app/saas/guards/feature-flag.guard.ts
git commit -m "fix(guards): use organizationId directly instead of user.organization.id"
```

---

### Task 12: Break UsersService → EventsGateway service cycle

**Files:**
- Modify: `apps/backend/api/src/app/users/users.service.ts`
- Modify: `apps/backend/api/src/app/users/users.module.ts`
- Modify: `apps/backend/api/src/app/websockets/events.gateway.ts`

- [ ] **Step 1: Remove EventsGateway from UsersService, emit events instead**

In `apps/backend/api/src/app/users/users.service.ts`:

Remove import:
```typescript
// REMOVE:
import { EventsGateway } from '../websockets/events.gateway';
```

Remove from constructor:
```typescript
// REMOVE:
private readonly eventsGateway: EventsGateway,
```

Replace `forceLogout` method body (line 327):
```typescript
// BEFORE:
this.eventsGateway.sendToUser(userId, 'force-logout', {
  reason: 'Su sesión ha sido cerrada por un administrador.',
});

// AFTER:
this.eventEmitter.emit('user.force-logout', {
  userId,
  reason: 'Su sesión ha sido cerrada por un administrador.',
});
```

Replace `blockAndLogout` method body (line 347):
```typescript
// BEFORE:
this.eventsGateway.sendToUser(userId, 'force-logout', {
  reason: 'Su cuenta ha sido bloqueada y su sesión ha sido cerrada por un administrador.',
});

// AFTER:
this.eventEmitter.emit('user.force-logout', {
  userId,
  reason: 'Su cuenta ha sido bloqueada y su sesión ha sido cerrada por un administrador.',
});
```

Replace `setOnlineStatus` method body (line 362):
```typescript
// BEFORE:
this.eventsGateway.server.emit('user-status-update', { userId, isOnline });

// AFTER:
this.eventEmitter.emit('user.status.changed', { userId, isOnline });
```

- [ ] **Step 2: Remove WebsocketsModule from UsersModule**

In `apps/backend/api/src/app/users/users.module.ts`, remove `WebsocketsModule`:
```typescript
// BEFORE imports array:
imports: [
    TypeOrmModule.forFeature([User, Organization]),
    RolesModule,
    MailModule,
    WebsocketsModule,    // ← REMOVE this line
    UserCacheModule,
    StorageModule,
],

// AFTER:
imports: [
    TypeOrmModule.forFeature([User, Organization]),
    RolesModule,
    MailModule,
    UserCacheModule,
    StorageModule,
],
```

Also remove `WebsocketsModule` import at top of `users.module.ts`.

- [ ] **Step 3: Add @OnEvent handlers to EventsGateway**

In `apps/backend/api/src/app/websockets/events.gateway.ts`, add event handlers. Add imports:
```typescript
import { OnEvent } from '@nestjs/event-emitter';
```

Add these methods to `EventsGateway` class:
```typescript
@OnEvent('user.force-logout')
handleForceLogout(payload: { userId: string; reason: string }) {
  this.sendToUser(payload.userId, 'force-logout', { reason: payload.reason });
}

@OnEvent('user.status.changed')
handleUserStatusChanged(payload: { userId: string; isOnline: boolean }) {
  this.server.emit('user-status-update', payload);
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/backend/api/src/app/users/users.service.ts apps/backend/api/src/app/users/users.module.ts apps/backend/api/src/app/websockets/events.gateway.ts
git commit -m "fix(users): replace EventsGateway injection with EventEmitter2 to break service cycle"
```

---

### Task 13: Break EventsGateway → AuthModule cycle

**Files:**
- Modify: `apps/backend/api/src/app/websockets/events.gateway.ts`
- Modify: `apps/backend/api/src/app/websockets/websockets.module.ts`

- [ ] **Step 1: Replace SessionService with JwtService + UserCacheService in EventsGateway**

Replace the full content of `apps/backend/api/src/app/websockets/events.gateway.ts`:
```typescript
import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserCacheService } from '../auth/modules/user-cache.service';
import { OnEvent } from '@nestjs/event-emitter';

interface JwtPayload {
  id: string;
  tokenVersion: number;
  organizationId?: string;
}

@WebSocketGateway({
  cors: {
    origin: 'http://localhost:4200',
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private connectedUsers = new Map<string, string>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly userCacheService: UserCacheService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.headers.cookie
        ?.split('; ')
        .find((row) => row.startsWith('access_token='))
        ?.split('=')[1];

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      });

      const cachedUser = await this.userCacheService.getUser(payload.id);
      if (!cachedUser) {
        client.disconnect();
        return;
      }

      const cachedVersion = (cachedUser as any)?.security?.tokenVersion ?? 0;
      if (cachedVersion !== payload.tokenVersion) {
        client.disconnect();
        return;
      }

      this.connectedUsers.set(payload.id, client.id);

      this.server.emit('user-status-update', {
        userId: payload.id,
        isOnline: true,
      });
    } catch (e) {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    for (const [userId, socketId] of this.connectedUsers.entries()) {
      if (socketId === client.id) {
        this.connectedUsers.delete(userId);
        this.server.emit('user-status-update', { userId, isOnline: false });
        break;
      }
    }
  }

  sendToUser(userId: string, event: string, data: any) {
    const socketId = this.connectedUsers.get(userId);
    if (socketId) {
      this.server.to(socketId).emit(event, data);
    }
  }

  @SubscribeMessage('user-status')
  handleUserStatus(client: Socket, payload: { isOnline: boolean }): void {
    for (const [userId, socketId] of this.connectedUsers.entries()) {
      if (socketId === client.id) {
        this.server.emit('user-status-update', { userId, isOnline: payload.isOnline });
        break;
      }
    }
  }

  @OnEvent('user.force-logout')
  handleForceLogout(payload: { userId: string; reason: string }) {
    this.sendToUser(payload.userId, 'force-logout', { reason: payload.reason });
  }

  @OnEvent('user.status.changed')
  handleUserStatusChanged(payload: { userId: string; isOnline: boolean }) {
    this.server.emit('user-status-update', payload);
  }
}
```

- [ ] **Step 2: Update WebsocketsModule — remove AuthModule, add UserCacheModule**

Replace the full content of `apps/backend/api/src/app/websockets/websockets.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { EventsGateway } from './events.gateway';
import { UserCacheModule } from '../auth/modules/user-cache.module';

@Module({
  imports: [
    UserCacheModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRATION_TIME'),
        },
      }),
    }),
  ],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class WebsocketsModule {}
```

- [ ] **Step 3: Commit**

```bash
git add apps/backend/api/src/app/websockets/events.gateway.ts apps/backend/api/src/app/websockets/websockets.module.ts
git commit -m "fix(websockets): replace SessionService with JwtService+UserCacheService to break AuthModule cycle"
```

---

### Task 14: Remove unnecessary AuthModule imports from modules

**Files:**
- Modify: `apps/backend/api/src/app/audit/audit.module.ts`
- Modify: `apps/backend/api/src/app/chart-of-accounts/chart-of-accounts.module.ts`
- Modify: `apps/backend/api/src/app/journal-entries/journal-entries.module.ts`
- Modify: `apps/backend/api/src/app/workflows/workflows.module.ts`

- [ ] **Step 1: Fix AuditModule**

In `apps/backend/api/src/app/audit/audit.module.ts`, remove `forwardRef(() => AuthModule)` from imports array and remove the `AuthModule` import at the top. Also remove `forwardRef` from `@nestjs/common` import if it's only used for that.

```typescript
// BEFORE:
import { Module, forwardRef } from '@nestjs/common';
// ...
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog]),
    forwardRef(() => AuthModule),
  ],

// AFTER:
import { Module } from '@nestjs/common';
// (remove AuthModule import)

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog]),
  ],
```

- [ ] **Step 2: Fix ChartOfAccountsModule**

In `apps/backend/api/src/app/chart-of-accounts/chart-of-accounts.module.ts`, remove `forwardRef(() => AuthModule)` from imports and remove the AuthModule import:

```typescript
// REMOVE from imports array:
forwardRef(() => AuthModule),

// REMOVE from top-level imports:
import { AuthModule } from '../auth/auth.module';
```

- [ ] **Step 3: Fix JournalEntriesModule**

In `apps/backend/api/src/app/journal-entries/journal-entries.module.ts`, remove `forwardRef(() => AuthModule)`:

```typescript
// REMOVE:
forwardRef(() => AuthModule),

// REMOVE import:
import { AuthModule } from '../auth/auth.module';
```

- [ ] **Step 4: Fix WorkflowsModule**

In `apps/backend/api/src/app/workflows/workflows.module.ts`, remove `forwardRef(() => AuthModule)`:

```typescript
// BEFORE:
import { Module, forwardRef } from '@nestjs/common';
// ...
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ApprovalPolicy, ApprovalPolicyStep, ApprovalRequest]),
    forwardRef(() => AuthModule),
  ],

// AFTER:
import { Module } from '@nestjs/common';

@Module({
  imports: [
    TypeOrmModule.forFeature([ApprovalPolicy, ApprovalPolicyStep, ApprovalRequest]),
  ],
```

- [ ] **Step 5: Commit**

```bash
git add apps/backend/api/src/app/audit/audit.module.ts apps/backend/api/src/app/chart-of-accounts/chart-of-accounts.module.ts apps/backend/api/src/app/journal-entries/journal-entries.module.ts apps/backend/api/src/app/workflows/workflows.module.ts
git commit -m "fix(modules): remove unnecessary AuthModule forwardRef from audit, coa, journal-entries, workflows"
```

---

### Task 15: Break ChartOfAccounts ↔ JournalEntries module cycle

**Files:**
- Modify: `apps/backend/api/src/app/chart-of-accounts/chart-of-accounts.module.ts`
- Modify: `apps/backend/api/src/app/chart-of-accounts/balance-update.service.ts`
- Modify: `apps/backend/api/src/app/journal-entries/journal-entries.service.ts`

- [ ] **Step 1: Remove JournalEntriesModule from ChartOfAccountsModule**

In `chart-of-accounts.module.ts`, remove:
```typescript
// REMOVE:
forwardRef(() => JournalEntriesModule),

// REMOVE import:
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
```

Also remove `JournalEntryLine` from `TypeOrmModule.forFeature` if it was only needed for BalanceUpdateService (check the service to verify).

- [ ] **Step 2: Add @OnEvent('journal-entry.committed') to BalanceUpdateService**

Read `apps/backend/api/src/app/chart-of-accounts/balance-update.service.ts` to understand the current trigger mechanism, then add event listener. Add import:
```typescript
import { OnEvent } from '@nestjs/event-emitter';
```

Add a listener method that calls the existing balance update logic:
```typescript
@OnEvent('journal-entry.committed')
async handleJournalEntryCommitted(payload: { journalEntryId: string; organizationId: string }) {
  await this.updateBalancesForEntry(payload.journalEntryId, payload.organizationId);
}
```

(The exact method name to call depends on what already exists in BalanceUpdateService — read the file and adapt.)

- [ ] **Step 3: Emit 'journal-entry.committed' event in JournalEntriesService**

In `apps/backend/api/src/app/journal-entries/journal-entries.service.ts`, find where a journal entry is posted/committed (status changed to POSTED), and add:
```typescript
this.eventEmitter.emit('journal-entry.committed', {
  journalEntryId: entry.id,
  organizationId: entry.organizationId,
});
```

Ensure `EventEmitter2` is injected:
```typescript
constructor(
  // ... existing ...
  private readonly eventEmitter: EventEmitter2,
) {}
```

Add import:
```typescript
import { EventEmitter2 } from '@nestjs/event-emitter';
```

- [ ] **Step 4: Commit**

```bash
git add apps/backend/api/src/app/chart-of-accounts/ apps/backend/api/src/app/journal-entries/journal-entries.service.ts
git commit -m "fix(modules): break CoA<->JournalEntries cycle with event-driven balance updates"
```

---

### Task 16: Break Customers ↔ Invoices module cycle

**Files:**
- Modify: `apps/backend/api/src/app/customers/customers.module.ts`

- [ ] **Step 1: Remove forwardRef(InvoicesModule) from CustomersModule**

In `apps/backend/api/src/app/customers/customers.module.ts`, `Invoice` is already registered in `TypeOrmModule.forFeature`. Remove the `forwardRef(() => InvoicesModule)` import:

```typescript
// BEFORE:
import { InvoicesModule } from '../invoices/invoices.module';
// ...
forwardRef(() => InvoicesModule),

// AFTER: remove both the import and the forwardRef from the imports array
```

The `CustomerPaymentsService` injects `Repository<Invoice>` via `@InjectRepository(Invoice)`. Since `Invoice` is already in `TypeOrmModule.forFeature` in `CustomersModule`, this works without importing `InvoicesModule`.

- [ ] **Step 2: Verify CustomerPaymentsService compiles correctly**

Check `apps/backend/api/src/app/customers/customer-payments.service.ts` to ensure it only uses `@InjectRepository(Invoice)` and does not call any method from `InvoicesService`. If it does call `InvoicesService`, refactor those calls to use the repository directly.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/api/src/app/customers/customers.module.ts
git commit -m "fix(modules): break Customers<->Invoices cycle by removing InvoicesModule forwardRef"
```

---

### Task 17: Final verification

- [ ] **Step 1: Run madge circular check**

```bash
cd apps/backend/api && npx madge --circular --extensions ts src
```

Expected output: `✓ No circular dependency found!`

If any cycles remain, read the reported files and apply the corresponding fix (import type for entity, remove forwardRef for modules, EventEmitter2 for services).

- [ ] **Step 2: TypeScript build check**

```bash
npx nx build api --skip-nx-cache
```

Expected: no TypeScript errors. Fix any type errors that arise from the entity changes (usually related to accessing `.organization` on User — these should work since `organization` is now a virtual property).

- [ ] **Step 3: Run tests**

```bash
npx nx test api --passWithNoTests
```

Expected: all existing tests pass.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "fix(circular-deps): resolve all 50 circular dependencies — zero regressions"
```
