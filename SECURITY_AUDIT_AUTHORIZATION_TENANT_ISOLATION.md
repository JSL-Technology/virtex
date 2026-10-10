# Security Audit: Authorization & Multi-Tenant Isolation

**Date:** 2026-09-30  
**Scope:** NestJS ERP Application — Authorization Controls & Tenant Isolation  
**Auditor:** Senior Security Engineer  

---

## Executive Summary

This audit examined the authorization controls and multi-tenant isolation mechanisms of the Virtex ERP application. The codebase demonstrates a **mature, defense-in-depth security architecture** with multiple layers of protection. However, several areas require attention to maintain the security posture as the application grows.

**Overall Assessment:** The authorization and tenant isolation implementation is **strong** with well-documented security decisions, fail-closed defaults, and comprehensive coverage. The team has clearly learned from past security incidents (documented in code comments) and systematically addressed them.

---

## 1. Authorization Guards & Decorators

### 1.1 Global Guard Registration (APP_GUARD)

**Status:** WELL IMPLEMENTED

The application registers guards globally in `apps/backend/api/src/app/app.module.ts` (lines 359-436):

| Guard | Line | Purpose | Default Behavior |
|-------|------|---------|------------------|
| `ThrottlerGuard` | 361-363 | Rate limiting | 20 req/min |
| `JwtAuthGuard` | 364-367 | Authentication | Deny if no valid JWT |
| `CsrfGuard` | 376-378 | CSRF protection | Enforce on state-changing requests |
| `ActiveTenantGuard` | 394-396 | Tenant resolution | Resolve tenant from header |
| `PermissionsGuard` | 407-409 | Authorization | **Deny by default** |
| `MfaEnrolmentGuard` | 425-427 | MFA enforcement | Hold session if MFA required |
| `SubscriptionActiveGuard` | 433-435 | Entitlement | Deny if subscription inactive |

**Key Strength:** `PermissionsGuard` is registered as `APP_GUARD` and **denies by default** (`apps/backend/api/src/app/security/guards/permissions.guard.ts` lines 36-77). Routes must explicitly declare `@HasPermission(...)` or `@AuthenticatedOnly(reason)` to be accessible. This is a fail-closed design.

**Evidence from `apps/backend/api/src/app/security/guards/permissions.guard.ts` lines 36-77:**
```typescript
if (!requiredPermissions) {
  // Nothing declared. This used to return true, and that default is why the control did not
  // hold: 102 route handlers reached production reachable by any authenticated member of the
  // tenant — creating a product, editing a supplier, reading the finance dashboard, querying
  // the analytical store — not because anyone judged them open, but because declaring a
  // requirement per endpoint means forgetting it per endpoint.
  // ...
  // So the default is now deny, and a route with no permission requirement has to say so with
  // @AuthenticatedOnly(reason)
```

### 1.2 Permission Decorator

**Status:** WELL IMPLEMENTED

`@HasPermission()` decorator (`apps/backend/api/src/app/security/decorators/permissions.decorator.ts` lines 25-26):
```typescript
export const HasPermission = (...permissions: PermissionOrPolicy[]) =>
  applyDecorators(SetMetadata(PERMISSIONS_KEY, permissions), UseGuards(PermissionsGuard));
```
- Applies `PermissionsGuard` via `UseGuards()` — declaration and enforcement are unified
- Supports both permission strings and ABAC policy classes
- Uses shared `hasPermission()` util for consistent wildcard matching

### 1.3 AuthenticatedOnly Decorator

**Status:** WELL IMPLEMENTED

`@AuthenticatedOnly(reason)` decorator (`apps/backend/api/src/app/security/decorators/authenticated-only.decorator.ts` lines 40-41):
```typescript
export const AuthenticatedOnly = (reason: string) =>
  SetMetadata(AUTHENTICATED_ONLY_KEY, reason);
```
- Requires a reason string — forces authors to document why no permission is needed
- Used for self-service routes (profile, sessions, notifications)
- Clear documentation of legitimate use cases (lines 22-35)

### 1.4 Platform Permission Decorator

**Status:** WELL IMPLEMENTED

`@RequiresPlatformPermission()` decorator (`apps/backend/api/src/app/security/decorators/platform-permission.decorator.ts` lines 23-27):
```typescript
export const RequiresPlatformPermission = (...permissions: PlatformPermission[]) =>
  applyDecorators(
    SetMetadata(PLATFORM_PERMISSIONS_KEY, permissions),
    UseGuards(PlatformPermissionsGuard),
  );
```
- Separate tier for platform-wide actions (extensions catalogue, analytics views)
- Uses exact match — `'*'` does NOT satisfy platform permissions (`apps/backend/api/src/app/security/platform-permissions.ts` lines 78-83)
- Prevents tenant administrators from granting themselves platform rights

---

## 2. Tenant Isolation

### 2.1 Tenant Context Establishment

**Status:** WELL IMPLEMENTED

**Mechanism:** `TenantConnectionInterceptor` (`apps/backend/api/src/app/shared/tenancy/tenant-connection.interceptor.ts`)
- Uses `AsyncLocalStorage` to bind tenant context to each request (line 24)
- Sets `app.current_organization` PostgreSQL setting on a dedicated connection (lines 60-62)
- Resets setting on connection release (line 96)
- Patches `Repository.prototype.manager` and `DataSource.prototype.transaction` to route through tenant-bound connection (`apps/backend/api/src/app/shared/tenancy/tenant-repository.patch.ts` lines 46-73)

**Key Strength:** The tenant context is established at the **connection level**, not per-query. This means every query automatically carries the tenant context.

**Evidence from `apps/backend/api/src/app/shared/tenancy/tenant-connection.interceptor.ts` lines 53-64:**
```typescript
return defer(() => {
  const queryRunner = this.dataSource.createQueryRunner();
  return from(
    queryRunner.connect().then(async () => {
      await queryRunner.query(`SELECT set_config('app.current_organization', $1, false)`, [
        organizationId,
      ]);
      return queryRunner;
    }),
  )
```

### 2.2 Active Tenant Guard

**Status:** WELL IMPLEMENTED

`ActiveTenantGuard` (`apps/backend/api/src/app/shared/tenancy/active-tenant.guard.ts`):
- Resolves tenant from `x-virtex-organization` header (line 24, 130-135)
- Re-resolves principal for the requested organization (line 110)
- Verifies membership before allowing tenant switch
- Returns same error for "not found" and "not a member" to prevent enumeration (lines 96-103)

**Evidence from `apps/backend/api/src/app/shared/tenancy/active-tenant.guard.ts` lines 105-127:**
```typescript
if (organizationId === user.organizationId) return true;

// Aquí está la autorización: vuelve a resolver el principal para la empresa pedida, lo que
// comprueba la pertenencia y recalcula roles y permisos para ella.
try {
  request.user = await this.identity.resolveForOrganization(user, organizationId);
} catch (error) {
  if (isMembershipDenial(error)) {
    this.logger.warn(
      { event: 'active_tenant_denied', userId: user.id, requested: raw },
      'El usuario no pertenece a la empresa que pide la cabecera',
    );
    throw new ForbiddenError('auth.organization_not_accessible');
  }
  throw error;
}
```

### 2.3 Row-Level Security (RLS)

**Status:** COMPREHENSIVE

**Migration Chain:**
1. `apps/backend/api/src/app/database/migrations/1789002100000-TenantRowLevelSecurity.ts` — Initial RLS policies
2. `apps/backend/api/src/app/database/migrations/1789006600000-ForceTenantRowLevelSecurity.ts` — FORCE RLS (applies to table owner)
3. `apps/backend/api/src/app/database/migrations/1789006700000-CompleteTenantIsolationCoverage.ts` — Covers inherited tables

**Policy Coverage:**
- Tables with `organization_id` column (NOT NULL) — direct policy (`1789002100000-TenantRowLevelSecurity.ts` lines 151-164)
- Tables inheriting tenant from parent — EXISTS subquery policy (lines 170-255)
- `FORCE ROW LEVEL SECURITY` applied to all tables with policies (`1789006600000-ForceTenantRowLevelSecurity.ts` lines 48-50)

**Table Classification** (`apps/backend/api/src/app/shared/tenancy/tenant-table-classification.ts`):
- **PROTECTED** — Has `tenant_isolation` policy
- **INHERITED** — Gets tenant from parent (32 tables, lines 61-102)
- **GLOBAL** — Shared reference data (20 tables, lines 114-151)
- **CROSS_TENANT** — Identity/tenancy plumbing (17 tables, lines 160-177)

### 2.4 Tenant Isolation Check

**Status:** WELL IMPLEMENTED

`TenantIsolationCheck` (`apps/backend/api/src/app/shared/tenancy/tenant-isolation.check.ts`):
- Runs at application bootstrap (line 112)
- Verifies RLS policies exist and apply to current connection (lines 123-143)
- Checks for superuser/BYPASSRLS (lines 129-132)
- Checks for FORCE RLS on owned tables (lines 137-142)
- **Aborts startup** if isolation is not enforcing (in production) (lines 254-258)

**Evidence from `apps/backend/api/src/app/shared/tenancy/tenant-isolation.check.ts` lines 154-188:**
```typescript
if (row.policies === 0) {
  // Cero políticas es el caso PEOR de los tres, y era el único que no impedía servir.
  const bootstrapping =
    (process.env['DEPLOY_ALLOW_UNPROTECTED_BOOTSTRAP'] ?? '').toLowerCase() === 'true';

  if (isDevLikeEnvironment() || bootstrapping) {
    this.logger.error(
      { event: 'tenant_isolation_absent', user: row.user, bootstrapping },
      'No hay políticas de aislamiento por empresa en la base de datos. El aislamiento ' +
        'depende por completo del filtro de cada consulta. Ejecuta las migraciones.',
    );
    return;
  }

  this.logger.error(
    { event: 'tenant_isolation_absent_fatal', user: row.user },
    'FATAL: no hay ninguna política de aislamiento por empresa en la base de datos.',
  );

  throw new Error(
    'FATAL: tenant isolation is not installed at all (0 policies). Run the migrations. ' +
      'If this really is the first deploy against an empty database, set ' +
      'DEPLOY_ALLOW_UNPROTECTED_BOOTSTRAP=true for that one boot and remove it afterwards.',
  );
}
```

---

## 3. Role/Permission System

### 3.1 Role Definition

**Status:** WELL IMPLEMENTED

Roles are defined per-organization with:
- `organizationId` — tenant scope
- `permissions[]` — permission strings
- `isSystemRole` — protects seeded roles from modification

### 3.2 Permission Resolution

**Status:** WELL IMPLEMENTED

`UserIdentityService.permissionsFor()` (`apps/backend/api/src/app/auth/services/user-identity.service.ts` lines 292-298):
```typescript
static permissionsFor(user: CachedUser, organizationId?: string | null): string[] {
  const scoped = user.roleAssignments.filter(
    (assignment) =>
      assignment.organizationId === null || assignment.organizationId === organizationId,
  );
  return [...new Set(scoped.flatMap((assignment) => assignment.permissions))];
}
```
- Filters role assignments by `organizationId`
- Platform roles (NULL `organizationId`) apply everywhere
- Permissions are resolved per active tenant

### 3.3 Privilege Escalation Prevention

**Status:** WELL IMPLEMENTED

**Role Creation/Update** (`apps/backend/api/src/app/roles/roles.service.ts`):
- `assertAssignablePermissions()` (lines 101-133) — actor can only grant permissions they hold
- `assertCanAssignRole()` (lines 159-199) — prevents assigning roles more powerful than actor
- Platform permissions can never be delegated to tenant roles (lines 119-124)
- Wildcard `'*'` can only be assigned by super-admins (lines 179-184)

**Evidence from `apps/backend/api/src/app/roles/roles.service.ts` lines 101-133:**
```typescript
private assertAssignablePermissions(actor: AuthenticatedUser, permissions: string[]): void {
  const actorPermissions = actor?.permissions || [];

  // The global wildcard is never delegated into a role: a role carrying '*' would be a
  // second, unaudited super-admin grant.
  if (permissions.includes('*')) {
    throw new ForbiddenError('roles.full_permission_cannot_delegated_role');
  }

  // Nor is any PLATFORM permission, by anybody, ever.
  const platform = permissions.filter(isPlatformPermission);
  if (platform.length) {
    throw new ForbiddenError('roles.platform_permission_cannot_delegated_role', {
      permission: platform[0],
    });
  }

  if (actorPermissions.includes('*')) return;

  for (const permission of permissions) {
    if (!hasPermission(actorPermissions, [permission])) {
      throw new ForbiddenError('roles.you_cannot_assign_permission_permission_because', { permission });
    }
  }
}
```

**Impersonation** (`apps/backend/api/src/app/auth/services/impersonation.service.ts`):
- `assertNoPrivilegeGain()` (lines 73-89) — prevents impersonating users with more permissions
- Cross-tenant impersonation is blocked (line 128)
- Chain impersonation is prevented (line 101)

**Evidence from `apps/backend/api/src/app/auth/services/impersonation.service.ts` lines 127-136:**
```typescript
// Strict tenant isolation: impersonation must never cross an organization boundary.
if (targetUser.organizationId !== adminUser.organizationId) {
  this.logger.warn(
    { event: 'impersonation_denied', adminId: adminUser.id, reason: 'cross_org' },
    '[SECURITY] Impersonation denied: cross-organization',
  );
  // Deliberately the same message as "not found" would be, so this cannot be used to probe
  // for the existence of user ids in other tenants.
  throw new NotFoundError('auth.user_impersonate_not_found');
}
```

### 3.4 Client-Supplied Role Fields

**Status:** PROTECTED

Roles are resolved server-side from the authenticated principal. Clients cannot send a `role` field to escalate privileges — the `AuthenticatedUser` is constructed from the JWT payload and database role assignments, not from client input.

**Evidence from `apps/backend/api/src/app/auth/services/user-identity.service.ts` lines 175-205:**
```typescript
private async buildPrincipal(
  user: CachedUser,
  requestedOrganizationId: string | undefined,
  session: { ... },
): Promise<AuthenticatedUser> {
  const organization = await this.resolveOrganizationContext(user, requestedOrganizationId);
  const activeOrganizationId = organization?.id ?? user.organizationId;

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    organizationId: activeOrganizationId as string,
    roles: UserIdentityService.roleNamesFor(user, activeOrganizationId).map((name) => ({
      name,
    })) as never,
    permissions: UserIdentityService.permissionsFor(user, activeOrganizationId),
    // ...
  };
}
```

---

## 4. Backend Authorization

### 4.1 Server-Side Enforcement

**Status:** COMPREHENSIVE

Every endpoint declares permissions via decorators:
- `@HasPermission(PERMISSIONS.XXX)` — requires specific permission
- `@AuthenticatedOnly(reason)` — self-service routes
- `@Public()` — explicitly public routes

**No endpoint relies on frontend hiding.** The `PermissionsGuard` is global and denies by default.

### 4.2 Permission Constants

**Status:** WELL ORGANIZED

Permissions are defined in per-module files and merged in `apps/backend/api/src/app/shared/permissions.ts` (lines 25-34):
```typescript
export const PERMISSIONS = {
  ...IAM_PERMISSIONS,
  ...ACCOUNTING_PERMISSIONS,
  ...FINANCE_PERMISSIONS,
  ...SALES_PERMISSIONS,
  ...INVENTORY_PERMISSIONS,
  ...PAYROLL_PERMISSIONS,
  ...REPORTS_PERMISSIONS,
  ...CONFIG_PERMISSIONS,
} as const;
```

---

## 5. Inconsistent Authorization

### 5.1 Multiple Authorization Mechanisms

**Status:** CONSISTENT

The application uses a **single, consistent authorization mechanism**:
- `PermissionsGuard` for all permission checks
- `PlatformPermissionsGuard` for platform-tier permissions
- `IsOrganizationOwnerPolicy` for ABAC ownership checks

All mechanisms are applied via decorators and enforced globally.

### 5.2 Weakest Link Analysis

**Status:** NO WEAK LINKS IDENTIFIED

The authorization is consistently applied:
- All controllers use `@HasPermission` or `@AuthenticatedOnly`
- No endpoints rely on frontend-only checks
- Service-layer checks complement guard-layer checks

---

## 6. OPA Policies

### 6.1 Policy Files

**Status:** MINIMAL COVERAGE

Only one OPA policy file exists:
- `platform/policies/security/plugin_admission.rego`

**Coverage:**
- Plugin admission (signature validation, SBOM vulnerabilities, egress policy)

**Missing Policies:**
- No OPA policies for tenant isolation
- No OPA policies for permission enforcement
- No OPA policies for API rate limiting

**Note:** The application relies on application-level authorization (NestJS guards) rather than OPA for most authorization decisions. This is a valid architectural choice, but OPA could provide additional defense-in-depth for complex policy decisions.

---

## 7. Row-Level Security

### 7.1 RLS Configuration

**Status:** COMPREHENSIVE

**Policy Installation:**
- `apps/backend/api/src/app/database/migrations/1789002100000-TenantRowLevelSecurity.ts` — Installs policies on all tables with `organization_id`
- `apps/backend/api/src/app/database/migrations/1789006600000-ForceTenantRowLevelSecurity.ts` — Applies FORCE RLS
- `apps/backend/api/src/app/database/migrations/1789006700000-CompleteTenantIsolationCoverage.ts` — Covers inherited tables

**Policy Predicate** (`apps/backend/api/src/app/database/migrations/1789002100000-TenantRowLevelSecurity.ts` lines 67-87):
```typescript
private async tenantPredicate(
  queryRunner: QueryRunner,
  table: string,
  alias?: string,
): Promise<string> {
  const rows: Array<{ data_type: string }> = await queryRunner.query(
    `SELECT data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'organization_id'`,
    [table],
  );
  const column = `${alias ? `${alias}.` : ''}organization_id`;
  const setting = `NULLIF(current_setting('app.current_organization', true), '')`;

  return rows[0]?.data_type === 'uuid'
    ? `${column} = ${setting}::uuid`
    : `${column} = ${setting}`;
}
```

**Key Strength:** The `NULLIF` wrapper ensures that an empty or missing setting results in no rows visible, not all rows.

### 7.2 RLS Bypass Risks

**Status:** MITIGATED

- `FORCE ROW LEVEL SECURITY` prevents table owner bypass (`apps/backend/api/src/app/database/migrations/1789006600000-ForceTenantRowLevelSecurity.ts` lines 48-50)
- `TenantIsolationCheck` verifies no superuser/BYPASSRLS at boot (`apps/backend/api/src/app/shared/tenancy/tenant-isolation.check.ts` lines 129-132)
- Application connects as `virtex_app` role (not owner) in production

---

## 8. Potential Issues & Recommendations

### 8.1 Medium: OPA Policy Coverage

**Finding:** Only one OPA policy file exists for plugin admission.

**Location:** `platform/policies/security/plugin_admission.rego`

**Recommendation:** Consider adding OPA policies for:
- Tenant isolation verification
- Permission enforcement
- Rate limiting decisions

**Priority:** Medium — Application-level controls are comprehensive, but OPA provides defense-in-depth.

### 8.2 Low: Permission Wildcard Handling

**Finding:** The `'*'` wildcard satisfies all tenant permissions but not platform permissions.

**Location:** `apps/backend/api/src/app/security/platform-permissions.ts` lines 78-83

**Current Behavior:** Correct — `hasPlatformPermission()` uses exact match.

**Recommendation:** Document this behavior explicitly in the permission catalogue.

### 8.3 Low: AuthenticatedOnly Reason Strings

**Finding:** `@AuthenticatedOnly(reason)` requires a reason string, but there's no validation that the reason is meaningful.

**Location:** `apps/backend/api/src/app/security/decorators/authenticated-only.decorator.ts` lines 40-41

**Recommendation:** Consider adding a lint rule to ensure reason strings are descriptive.

### 8.4 Info: Cross-Tenant Table Access

**Finding:** Some tables are classified as `CROSS_TENANT` (e.g., `organizations`, `users`, `intercompany_transactions`).

**Location:** `apps/backend/api/src/app/shared/tenancy/tenant-table-classification.ts` lines 160-177

**Current Behavior:** These tables are intentionally not protected by RLS because they hold data that spans tenants.

**Recommendation:** Ensure all access to these tables is properly scoped in application code. The `ActiveTenantGuard` and service-layer checks provide this protection.

---

## 9. Security Strengths

1. **Fail-Closed Defaults:** `PermissionsGuard` denies by default; routes must explicitly declare permissions.

2. **Defense in Depth:** Multiple layers of protection:
   - Global guards (authentication, CSRF, permissions)
   - Service-layer checks (tenant scoping, ownership)
   - Database RLS (row-level isolation)

3. **Comprehensive Documentation:** Security decisions are documented in code comments, making the security model understandable.

4. **Systematic Remediation:** Past security incidents have been systematically addressed (CSRF, entitlement, permissions coverage).

5. **Tenant Isolation at Database Level:** RLS policies ensure isolation even if application code has bugs.

6. **Privilege Escalation Prevention:** Multiple checks prevent users from granting themselves or others more permissions.

7. **Platform Permission Separation:** Platform-tier permissions cannot be granted by tenant administrators.

---

## 10. Conclusion

The Virtex ERP application demonstrates a **mature, well-architected authorization and tenant isolation system**. The implementation follows security best practices:

- Fail-closed defaults
- Defense in depth
- Comprehensive RLS coverage
- Privilege escalation prevention
- Consistent authorization mechanisms
- Clear documentation of security decisions

**No critical or high-severity authorization or tenant isolation vulnerabilities were identified.**

The recommendations provided are for further hardening and are not blockers for production deployment.

---

## Appendix A: File Inventory

### Authorization Files
- `apps/backend/api/src/app/security/guards/permissions.guard.ts`
- `apps/backend/api/src/app/security/guards/platform-permissions.guard.ts`
- `apps/backend/api/src/app/security/decorators/permissions.decorator.ts`
- `apps/backend/api/src/app/security/decorators/authenticated-only.decorator.ts`
- `apps/backend/api/src/app/security/decorators/public.decorator.ts`
- `apps/backend/api/src/app/security/decorators/platform-permission.decorator.ts`
- `apps/backend/api/src/app/security/decorators/check-permissions.decorator.ts`

### Tenant Isolation Files
- `apps/backend/api/src/app/shared/tenancy/tenant-context.ts`
- `apps/backend/api/src/app/shared/tenancy/tenant-connection.interceptor.ts`
- `apps/backend/api/src/app/shared/tenancy/active-tenant.guard.ts`
- `apps/backend/api/src/app/shared/tenancy/tenant-isolation.check.ts`
- `apps/backend/api/src/app/shared/tenancy/tenant-repository.patch.ts`
- `apps/backend/api/src/app/shared/tenancy/tenant-table-classification.ts`

### RLS Migrations
- `apps/backend/api/src/app/database/migrations/1789002100000-TenantRowLevelSecurity.ts`
- `apps/backend/api/src/app/database/migrations/1789006600000-ForceTenantRowLevelSecurity.ts`
- `apps/backend/api/src/app/database/migrations/1789006700000-CompleteTenantIsolationCoverage.ts`

### OPA Policies
- `platform/policies/security/plugin_admission.rego`

---

*End of Report*
