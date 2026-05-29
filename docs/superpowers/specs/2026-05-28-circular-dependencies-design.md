# Diseño: Eliminación de Dependencias Circulares y Preparación para Microservicios

**Fecha:** 2026-05-28  
**Proyecto:** Virteex ERP SaaS — Backend NestJS Monorepo  
**Estado:** Aprobado

---

## Contexto

El análisis con `madge` detectó **50 dependencias circulares** en el backend NestJS. Estas dependencias impiden la eventual migración a microservicios y pueden causar problemas de inicialización en NestJS.

El objetivo es eliminar los 50 ciclos con **cero regresiones** y dejar la arquitectura lista para la migración a microservicios por dominio.

---

## Categorías y Estrategias

### Categoría 1 — Entidades TypeORM intra-módulo (~33 casos)

**Problema:** Pares de entidades dentro del mismo módulo que se importan mutuamente para definir relaciones bi-direccionales TypeORM.

**Ejemplos:**
- `account.entity.ts` ↔ `account-segment.entity.ts`
- `journal-entry.entity.ts` ↔ `journal-entry-line.entity.ts`
- `customer.entity.ts` ↔ `customer-address.entity.ts`
- (y ~30 casos más listados en la sección de archivos)

**Estrategia:** En el lado "hijo" (la entidad con `@ManyToOne`), reemplazar:
1. `import { Parent } from './parent.entity'` → `import type { Parent } from './parent.entity'`
2. `@ManyToOne(() => Parent, ...)` → `@ManyToOne('Parent', ...)`

**Resultado:** TypeORM mantiene plena funcionalidad (joins, eager/lazy load). `import type` es borrado en runtime, eliminando el ciclo. Cero cambio funcional.

**Criterio para "hijo":** La entidad que tiene `@ManyToOne` hacia la otra es el "hijo".

---

### Categoría 2 — Entidades TypeORM cross-módulo (~4 casos)

**Problema:** Entidades en módulos distintos (futuros microservicios distintos) que se referencian mutuamente via TypeORM, acoplando dominios que deben ser independientes.

**Casos identificados:**

| Entidad (módulo) | Relación TypeORM a eliminar | Columna ID que queda |
|---|---|---|
| `user.entity.ts` (users) | `@ManyToOne(() => Organization)` | `organizationId: string` ✓ |
| `user.entity.ts` (users) | `@ManyToMany(() => Organization)` | tabla `user_organizations` (queries directas) |
| `organization.entity.ts` (organizations) | `@OneToMany(() => User)` | — |
| `organization.entity.ts` (organizations) | `@ManyToMany(() => User)` | — |
| `organization.entity.ts` (organizations) | `@ManyToOne(() => Plan)` | añadir `planId: string` column |
| `role.entity.ts` (roles) | `@ManyToOne(() => Organization)` | `organizationId: string` ✓ |

**Estrategia:** Remover decoradores TypeORM cross-módulo. Mantener columnas de ID. Actualizar código que usa esas relaciones.

**Archivos impactados (11):**

1. `user.entity.ts` — remover relaciones Organization
2. `organization.entity.ts` — remover relaciones User y Plan
3. `role.entity.ts` — remover relación Organization
4. `auth/interfaces/authenticated-user.interface.ts` — añadir `organizationSubscriptionStatus?: string`, remover `organization?: any`
5. `auth/strategies/jwt.strategy/jwt.strategy.ts` — `user.organization.id` → `user.organizationId`; cargar org por ID separado
6. `payment/payment.controller.ts` — `user.organization.id` → `user.organizationId`
7. `saas/saas.controller.ts` — `user.organization.id` → `user.organizationId`
8. `saas/guards/subscription-active.guard.ts` — `user.organization.subscriptionStatus` → `user.organizationSubscriptionStatus`
9. `saas/guards/feature-flag.guard.ts` — `user.organization.id` → `user.organizationId`
10. `users/users.service.ts` — remover `'organization'` de relations array; query Organization por repo cuando se necesite
11. `auth/services/impersonation.service.ts` — mismo cambio
12. `auth/services/password-recovery.service.ts` — mismo cambio
13. `saas/services/saas-cron.service.ts` — mismo cambio

**Cómo cargar Organization cuando se necesite:**
Registrar `OrganizationRepository` via `TypeOrmModule.forFeature([Organization])` en los módulos que lo necesiten, e inyectarlo donde haga falta.

---

### Categoría 3 — Guard global (rompe ciclos auth-dependientes)

**Problema:** Múltiples módulos importan `AuthModule` exclusivamente para tener acceso a `JwtAuthGuard`. Esto crea cadenas de ciclos: `audit → auth → audit`, `coa → auth → coa`, y chains más largas (ciclos 17, 28-36).

**Estrategia:** Registrar `JwtAuthGuard` como guard global en `AppModule`:

```typescript
// app.module.ts
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';

providers: [
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  // ... resto de providers
]
```

Una vez global, los módulos que solo importaban `AuthModule` para el guard pueden eliminar esa importación.

**Módulos que eliminarán su import de AuthModule:**
- `ChartOfAccountsModule`
- `AuditModule`
- `JournalEntriesModule`
- `WorkflowsModule`
- `WebsocketsModule`

**Nota:** Los módulos que usan servicios reales de AuthModule (AuthService, SessionService, etc.) mantienen su import.

---

### Categoría 4 — Ciclos de servicios: EventEmitter2 (~4 casos)

**Ciclo principal (ciclos 18-20):**
`UsersService → EventsGateway → SessionService → UsersService`

**Fix:**
- `users.service.ts`: Remover inyección de `EventsGateway`. Emitir evento:
  ```typescript
  this.eventEmitter.emit('user.status.changed', { userId, isOnline: true });
  ```
- `events.gateway.ts`: Añadir listener:
  ```typescript
  @OnEvent('user.status.changed')
  handleUserStatusChanged(payload: { userId: string; isOnline: boolean }) {
    this.server.emit('user-status-update', payload);
  }
  ```

**Ciclo secundario (ciclo 18):**
`SecurityAnalysisService → UsersService` (con `forwardRef`)

Una vez que `UsersService` no depende de `EventsGateway`, el ciclo `SecurityAnalysis → UsersService → EventsGateway → SessionService → SecurityAnalysis` se rompe porque ya no hay ruta circular completa. El `forwardRef` en `SecurityAnalysisService` se puede eliminar.

---

### Categoría 5 — Módulos restantes

**`ChartOfAccountsModule` ↔ `JournalEntriesModule` (ciclo 32):**

Actualmente ambos se importan mutuamente. La dependencia real es:
- JE necesita CoA para validar cuentas → JE importa CoA (mantener)
- CoA necesita JE para actualizar balances → ROMPER con EventEmitter2

Fix:
- `JournalEntriesService` emite `journal-entry.committed` al confirmar un asiento
- `BalanceUpdateService` (CoA) escucha ese evento
- CoA elimina `forwardRef(() => JournalEntriesModule)`

**`CustomersModule` ↔ `InvoicesModule` (ciclo 46):**

InvoicesModule importa CustomersModule (para validar clientes). CustomersModule importa InvoicesModule con forwardRef (para `CustomerPaymentsService` que trabaja con facturas).

Fix:
- `CustomersModule` registra la entidad `Invoice` via `TypeOrmModule.forFeature([Invoice])` directamente (sin importar InvoicesModule)
- `CustomerPaymentsService` usa `InjectRepository(Invoice)` directamente
- Eliminar `forwardRef(() => InvoicesModule)` de CustomersModule

---

## Archivos a Crear (Nuevos)

Ninguno requerido. Todos los cambios son en archivos existentes. El `EventEmitter2` y `@OnEvent` ya están disponibles via `@nestjs/event-emitter`.

---

## Archivos de Entidades Intra-módulo a Actualizar

Los siguientes 33 archivos reciben el patrón `import type` + string ref:

**accounting/** (1): `ledger-mapping-rule-condition.entity.ts`

**chart-of-accounts/** (3): `account-segment.entity.ts`, `account-hierarchy-version.entity.ts`, `account-balance.entity.ts`

**journal-entries/** (3): `journal-entry-line.entity.ts`, `journal-entry-attachment.entity.ts`, `journal-entry-line-valuation.entity.ts`

**dimensions/** (1): `dimension-value.entity.ts`

**workflows/** (1): `approval-policy-step.entity.ts`

**organizations/** (1): `organization-subsidiary.entity.ts`

**saas/** (2): `plan-feature.entity.ts`, `plan-limit.entity.ts`

**users/** (2): `passkey.entity.ts`, `user-security.entity.ts`

**localization/** (6): `localization-template.entity.ts`, `coa-template.entity.ts`, `tax-template.entity.ts`, `fiscal-document-type-definition.entity.ts`, `tax-scheme.entity.ts`, `fiscal-region.entity.ts` (importa múltiples entidades de localization — aplica el mismo patrón en los hijos)

**taxes/** (1): `tax.entity.ts` (importa `TaxGroup` de localization — cross-module, usar mismo patrón)

**accounts-payable/** (3): `vendor-bill-line.entity.ts`, `vendor-payment.entity.ts`

**reconciliation/** (1): `bank-transaction.entity.ts`

**budgets/** (1): `budget-line.entity.ts`

**customers/** (4): `customer-address.entity.ts`, `customer-contact.entity.ts`, `customer-group.entity.ts`, `customer-payment-line.entity.ts`

**invoices/** (1): `invoice-line-item.entity.ts`

**manufacturing/** (1): `bill-of-material-item.entity.ts`

**price-lists/** (1): `price-list-item.entity.ts`

**audit/** (1): `proposed-adjustment-evidence.entity.ts`

**sales/** (1): `quote-line.entity.ts`

---

## Verificación de Éxito

```bash
npx madge --circular --extensions ts apps/backend/api/src
# Resultado esperado: "✓ No circular dependency found!"
```

Adicionalmente:
- `npx nx build api` sin errores TypeScript
- `npx nx test api` sin regressions
- La aplicación arranca y los endpoints responden normalmente

---

## Preparación para Microservicios

Una vez aplicado este diseño, cada módulo tiene:
- Entidades sin imports cross-dominio (ID-only para referencias externas)
- Comunicación cross-módulo via EventEmitter2 (→ reemplazable por message broker: Kafka/RabbitMQ)
- Sin dependencias circulares en módulos NestJS (cada módulo puede extraerse a un servicio independiente)

Para migrar un módulo a microservicio:
1. Mover el módulo a su propio proyecto NX
2. Reemplazar `EventEmitter2.emit` por publicación a Kafka/RabbitMQ
3. Reemplazar queries cross-módulo por llamadas HTTP/gRPC al servicio del otro dominio
