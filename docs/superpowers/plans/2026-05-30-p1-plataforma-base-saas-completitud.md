# P1 — Plataforma Base SaaS: Completitud 100% Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir todos los bugs críticos de seguridad, inconsistencias y páginas stub para llevar la plataforma base SaaS a 100% de completitud antes de pasar a Prioridad 2.

**Architecture:** NX Monorepo con NestJS 11 (Fastify) en backend y Angular 19 standalone components en frontend. El backend usa `organizationId` del JWT para multi-tenancy, TypeORM con PostgreSQL, Redis para caché de sesiones. El frontend usa signals de Angular, HttpClient con interceptors, y rutas lazy-loaded.

**Tech Stack:** NestJS 11, Angular 19, TypeORM, PostgreSQL, Redis, Stripe, Socket.IO, Fastify

---

## Mapa de archivos afectados

### Backend — Fixes críticos
| Archivo | Cambio |
|---------|--------|
| `apps/backend/api/src/app/users/users.controller.ts` | Corregir `@HasPermission` de dot → colon, fix IDOR |
| `apps/backend/api/src/app/users/users.service.ts` | Fix `findOne()` para filtrar por `organizationId`, quitar `as any` |
| `apps/backend/api/src/app/auth/auth.controller.ts` | Agregar `UnauthorizedException` al import |
| `apps/backend/api/src/app/auth/auth.config.ts` | Eliminar fallback hardcodeado de `JWT_2FA_TEMP_SECRET` |
| `apps/backend/api/src/app/auth/services/session.service.ts` | Descomentar revocación de refresh tokens en DB |
| `apps/backend/api/src/app/roles/roles.controller.ts` | Agregar `PermissionsGuard` y `@HasPermission` a cada método |
| `apps/backend/api/src/app/audit/audit-log.entity.ts` | Agregar columna `organizationId` |
| `apps/backend/api/src/app/audit/audit.service.ts` | Filtrar `find()` por `organizationId`, actualizar `record()` |
| `apps/backend/api/src/app/audit/audit.controller.ts` | Agregar `PermissionsGuard`, `@HasPermission`, inyectar user |
| `apps/backend/api/src/app/websockets/events.gateway.ts` | CORS dinámico, cookie parsing con librería `cookie` |
| `apps/backend/api/src/app/payment/payment.controller.ts` | Usar `@RawBody()` en webhook, agregar `GET /subscription` |
| `apps/backend/api/src/app/payment/payment.service.ts` | Agregar método `getSubscriptionStatus()` |
| `apps/backend/api/src/app/app.module.ts` | SSL con `rejectUnauthorized: true` |

### Frontend — Fixes críticos
| Archivo | Cambio |
|---------|--------|
| `apps/core/client-web/src/app/core/services/auth.ts` | Corregir URLs de `inviteUser` y `updateUser` |
| `apps/core/client-web/src/app/core/services/billing.ts` | Conectar `getSubscription()` a API real |
| `apps/core/client-web/src/app/features/auth/auth.routes.ts` | Corregir branding "FacturaPRO" → "Virteex" |

### Frontend — Settings pages (stubs → funcionales)
| Archivo | Cambio |
|---------|--------|
| `apps/core/client-web/src/app/features/settings/system/security/security.page.ts` | Implementar con audit log paginado |
| `apps/core/client-web/src/app/features/settings/system/smtp/smtp.page.ts` | Implementar con form de config |
| `apps/core/client-web/src/app/features/settings/system/integrations/integrations.page.ts` | Implementar panel de integraciones |
| `apps/core/client-web/src/app/features/settings/finance/accounting/accounting.page.ts` | Conectar a ledgers/periodos backend |
| `apps/core/client-web/src/app/features/settings/finance/currencies/currencies.page.ts` | CRUD completo con API |
| `apps/core/client-web/src/app/features/settings/finance/taxes/taxes.page.ts` | CRUD completo con API |

---

## Task 1: Fix bug crítico — permisos dot vs colon en users.controller.ts

**Files:**
- Modify: `apps/backend/api/src/app/users/users.controller.ts:44-201`

- [ ] **Step 1: Cambiar todos los `@HasPermission('users.X')` a `@HasPermission(PERMISSIONS.USERS_X)`**

Abrir `apps/backend/api/src/app/users/users.controller.ts` y aplicar estos cambios exactos:

```typescript
// Línea 1-25: Agregar import de PERMISSIONS
import { PERMISSIONS } from '../shared/permissions';

// Reemplazar decoradores (líneas 44, 58, 141, 150, 165, 174, 184, 196, 201):
// ANTES → DESPUÉS:
// @HasPermission('users.create')  → @HasPermission(PERMISSIONS.USERS_CREATE)
// @HasPermission('users.view')    → @HasPermission(PERMISSIONS.USERS_VIEW)
// @HasPermission('users.edit')    → @HasPermission(PERMISSIONS.USERS_EDIT)
// @HasPermission('users.delete')  → @HasPermission(PERMISSIONS.USERS_DELETE)
```

El archivo completo corregido debe quedar así en los métodos:

```typescript
import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Req, UseFilters, ParseUUIDPipe, UseInterceptors, UploadedFile, BadRequestException, NotFoundException } from '@nestjs/common';
import { FastifyFileInterceptor } from '../common/interceptors/fastify-file.interceptor';
import { FastifyFile } from '../common/interfaces/fastify-file.interface';
import { ThrottlerGuard } from '@nestjs/throttler';
import { extname } from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { StorageService } from '../storage/storage.service';
import { UsersService } from './users.service';
import { InviteUserDto } from './entities/user.entity/invite-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { PermissionsGuard } from '../auth/guards/permissions/permissions.guard';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User, UserStatus } from './entities/user.entity/user.entity';
import { UserResponseDto } from '../auth/dto/user-response.dto';
import { plainToInstance } from 'class-transformer';
import { CheckPermissions } from '../auth/decorators/check-permissions.decorator';
import { IsOrganizationOwner } from '../auth/policies/is-organization-owner.policy';
import { TypeOrmExceptionFilter } from '../common/filters/typeorm-exception.filter';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JobTitle } from './enums/job-title.enum';
import { PERMISSIONS } from '../shared/permissions';

@ApiTags('Users')
@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseFilters(TypeOrmExceptionFilter)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly storageService: StorageService
  ) {}

  @Get('job-titles')
  @ApiOperation({ summary: 'Get list of available job titles' })
  getJobTitles() {
    return Object.values(JobTitle);
  }

  @Post('invite')
  @HasPermission(PERMISSIONS.USERS_CREATE)
  @ApiOperation({ summary: 'Invite a new user to the organization' })
  async inviteUser(
    @Body() inviteUserDto: InviteUserDto,
    @CurrentUser() user: User,
  ) {
    const newUser = await this.usersService.inviteUser(inviteUserDto, user.organizationId);
    return plainToInstance(UserResponseDto, newUser, { excludeExtraneousValues: true });
  }

  @Get()
  @HasPermission(PERMISSIONS.USERS_VIEW)
  @ApiOperation({ summary: 'List users in organization' })
  async findAll(
    @CurrentUser() user: User,
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 10,
    @Query('search') search = '',
    @Query('status') status = 'all',
    @Query('sortColumn') sortColumn = 'createdAt',
    @Query('sortDirection') sortDirection: 'ASC' | 'DESC' = 'DESC',
  ) {
    const { data, total } = await this.usersService.findAllByOrg(user.organizationId, {
      page, pageSize, searchTerm: search, statusFilter: status, sortColumn, sortDirection,
    });
    return {
      data: plainToInstance(UserResponseDto, data, { excludeExtraneousValues: true }),
      total, page, pageSize,
    };
  }

  @Get('profile')
  @ApiOperation({ summary: 'Get current user profile' })
  async getProfile(@CurrentUser() user: User) {
    const fullUser = await this.usersService.findOne(user.id, user.organizationId);
    return plainToInstance(UserResponseDto, fullUser, { excludeExtraneousValues: true });
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update current user profile' })
  async updateProfile(@CurrentUser() user: User, @Body() updateProfileDto: UpdateProfileDto) {
    const updatedUser = await this.usersService.updateProfile(user.id, updateProfileDto);
    return plainToInstance(UserResponseDto, updatedUser, { excludeExtraneousValues: true });
  }

  @Post('profile/avatar')
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Upload avatar for current user' })
  @UseInterceptors(FastifyFileInterceptor('file', {
    fileFilter: (req, file, cb) => {
      if (!file.mimetype.match(/\/(jpg|jpeg|png|gif)$/)) {
        return cb(new BadRequestException('Only image files are allowed!'), false);
      }
      cb(null, true);
    },
    limits: { fileSize: 5 * 1024 * 1024 }
  }))
  async uploadAvatar(@CurrentUser() user: User, @UploadedFile() file: FastifyFile) {
    if (!file) throw new BadRequestException('File is required');
    try {
      const avatarUrl = await this.storageService.upload(file, 'avatars');
      const updatedUser = await this.usersService.updateProfile(user.id, { avatarUrl });
      return { avatarUrl: updatedUser.avatarUrl };
    } finally {
      if (file.path) await fs.unlink(file.path).catch(() => {});
    }
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.USERS_VIEW)
  @ApiOperation({ summary: 'Get user by ID' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    const foundUser = await this.usersService.findOne(id, user.organizationId);
    return plainToInstance(UserResponseDto, foundUser, { excludeExtraneousValues: true });
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.USERS_EDIT)
  @ApiOperation({ summary: 'Update user (Admin)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() user: User,
  ) {
    const updatedUser = await this.usersService.updateUser(id, updateUserDto, user.organizationId);
    return plainToInstance(UserResponseDto, updatedUser, { excludeExtraneousValues: true });
  }

  @Delete(':id')
  @HasPermission(PERMISSIONS.USERS_DELETE)
  @CheckPermissions(IsOrganizationOwner)
  @ApiOperation({ summary: 'Remove user' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.usersService.remove(id, user.organizationId);
  }

  @Patch(':id/status')
  @HasPermission(PERMISSIONS.USERS_EDIT)
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('status') status: UserStatus,
    @CurrentUser() user: User,
  ) {
    const updatedUser = await this.usersService.updateUserStatus(id, status, user.organizationId);
    return plainToInstance(UserResponseDto, updatedUser, { excludeExtraneousValues: true });
  }

  @Post(':id/reset-password')
  @HasPermission(PERMISSIONS.USERS_EDIT)
  async resetPassword(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    await this.usersService.resetPassword(id, user.organizationId);
    return { message: 'Password reset email sent.' };
  }

  @Get(':id/activity')
  @HasPermission(PERMISSIONS.USERS_VIEW)
  async getActivityLog(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.usersService.getActivityLog(id, user.organizationId);
  }

  @Post(':id/force-logout')
  @HasPermission(PERMISSIONS.USERS_EDIT)
  async forceLogout(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.forceLogout(id);
  }
}
```

- [ ] **Step 2: Verificar que los cambios son correctos**

```bash
npx tsc --noEmit -p apps/backend/api/tsconfig.app.json 2>&1 | grep "users.controller" | head -20
```

Esperado: Sin errores de tipo en users.controller.ts

- [ ] **Step 3: Commit**

```bash
git add apps/backend/api/src/app/users/users.controller.ts
git commit -m "fix(security): corregir formato de permisos dot→colon en users.controller y aplicar IDOR fix"
```

---

## Task 2: Fix IDOR en users.service.ts — filtrar findOne por organizationId

**Files:**
- Modify: `apps/backend/api/src/app/users/users.service.ts:173-182`

- [ ] **Step 1: Actualizar la firma y la implementación de `findOne()`**

Reemplazar el método `findOne` en `apps/backend/api/src/app/users/users.service.ts`:

```typescript
// ANTES (línea 173):
async findOne(id: string): Promise<User> {
  const user = await this.userRepository.findOne({
    where: { id: id as any },
  });
  if (!user) {
    throw new NotFoundException(`Usuario con id ${id} no encontrado`);
  }
  return user;
}

// DESPUÉS:
async findOne(id: string, organizationId?: string): Promise<User> {
  const user = await this.userRepository.findOne({
    where: { id, ...(organizationId ? { organizationId } : {}) },
  });
  if (!user) {
    throw new NotFoundException(`Usuario con id ${id} no encontrado`);
  }
  return user;
}
```

El parámetro `organizationId` es opcional para no romper llamadas internas desde auth services que buscan por id global.

- [ ] **Step 2: Actualizar `getActivityLog()` para filtrar por organización**

Reemplazar el método `getActivityLog` (línea ~257):

```typescript
async getActivityLog(userId: string, organizationId: string): Promise<any[]> {
  // Verificar que el usuario pertenece a la organización antes de retornar logs
  const user = await this.userRepository.findOne({ where: { id: userId, organizationId } });
  if (!user) {
    throw new NotFoundException(`Usuario no encontrado en esta organización`);
  }
  return [];
}
```

- [ ] **Step 3: Verificar compilación**

```bash
npx tsc --noEmit -p apps/backend/api/tsconfig.app.json 2>&1 | grep "users.service" | head -10
```

Esperado: Sin errores

- [ ] **Step 4: Commit**

```bash
git add apps/backend/api/src/app/users/users.service.ts
git commit -m "fix(security): corregir IDOR en findOne() filtrando por organizationId"
```

---

## Task 3: Fix UnauthorizedException no importada en auth.controller.ts

**Files:**
- Modify: `apps/backend/api/src/app/auth/auth.controller.ts:2`

- [ ] **Step 1: Agregar `UnauthorizedException` al import de `@nestjs/common`**

En `apps/backend/api/src/app/auth/auth.controller.ts`, línea 2, agregar `UnauthorizedException` al destructuring:

```typescript
// ANTES:
import { Controller, Post, Body, HttpCode, HttpStatus, Res, Get, UseGuards, Req, UsePipes, ValidationPipe, BadRequestException, Param, Ip, Headers, Query, UseFilters } from '@nestjs/common';

// DESPUÉS:
import { Controller, Post, Body, HttpCode, HttpStatus, Res, Get, UseGuards, Req, UsePipes, ValidationPipe, BadRequestException, UnauthorizedException, Param, Ip, Headers, Query, UseFilters } from '@nestjs/common';
```

- [ ] **Step 2: Verificar compilación**

```bash
npx tsc --noEmit -p apps/backend/api/tsconfig.app.json 2>&1 | grep "auth.controller" | head -10
```

Esperado: Sin errores relacionados a `UnauthorizedException`

- [ ] **Step 3: Commit**

```bash
git add apps/backend/api/src/app/auth/auth.controller.ts
git commit -m "fix(auth): agregar UnauthorizedException al import de auth.controller.ts"
```

---

## Task 4: Fix secret 2FA sin fallback hardcodeado en auth.config.ts

**Files:**
- Modify: `apps/backend/api/src/app/auth/auth.config.ts:24`

- [ ] **Step 1: Reemplazar el fallback hardcodeado con un error de startup**

En `apps/backend/api/src/app/auth/auth.config.ts`, línea 24:

```typescript
// ANTES:
get JWT_2FA_TEMP_SECRET() { return process.env.JWT_2FA_TEMP_SECRET || 'temp_2fa_secret_change_me'; },

// DESPUÉS:
get JWT_2FA_TEMP_SECRET() {
  const secret = process.env.JWT_2FA_TEMP_SECRET;
  if (!secret) {
    throw new Error('FATAL: JWT_2FA_TEMP_SECRET must be set in environment variables');
  }
  return secret;
},
```

- [ ] **Step 2: Agregar la variable al archivo `.env.example` o documentación**

Si existe un `.env.example`, agregar:
```
JWT_2FA_TEMP_SECRET=your-secure-random-secret-here
```

Verificar si existe:
```bash
ls /c/Users/Usuario/Desktop/virteex1/*.env* /c/Users/Usuario/Desktop/virteex1/.env* 2>/dev/null
```

- [ ] **Step 3: Commit**

```bash
git add apps/backend/api/src/app/auth/auth.config.ts
git commit -m "fix(security): eliminar fallback hardcodeado de JWT_2FA_TEMP_SECRET"
```

---

## Task 5: Fix logout — revocar refresh tokens en base de datos

**Files:**
- Modify: `apps/backend/api/src/app/auth/services/session.service.ts:325-329`

- [ ] **Step 1: Descomentar la revocación de tokens en DB**

En `apps/backend/api/src/app/auth/services/session.service.ts`, reemplazar el método `terminateAllSessions`:

```typescript
// ANTES:
async terminateAllSessions(userId: string) {
    await this.userCacheService.clearUserSession(userId);
    // Optional: Revoke all refresh tokens in DB if stricter security is needed
    // await this.refreshTokenRepository.update({ userId, isRevoked: false }, { isRevoked: true, revokedAt: new Date() });
}

// DESPUÉS:
async terminateAllSessions(userId: string) {
    await this.userCacheService.clearUserSession(userId);
    await this.refreshTokenRepository.update(
      { userId, isRevoked: false },
      { isRevoked: true, revokedAt: new Date() }
    );
}
```

- [ ] **Step 2: Verificar compilación**

```bash
npx tsc --noEmit -p apps/backend/api/tsconfig.app.json 2>&1 | grep "session.service" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add apps/backend/api/src/app/auth/services/session.service.ts
git commit -m "fix(security): revocar refresh tokens en DB al cerrar todas las sesiones"
```

---

## Task 6: Agregar PermissionsGuard a roles.controller.ts

**Files:**
- Modify: `apps/backend/api/src/app/roles/roles.controller.ts`

- [ ] **Step 1: Reemplazar el controller completo con guards y permisos correctos**

Reemplazar `apps/backend/api/src/app/roles/roles.controller.ts`:

```typescript
import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { PermissionsGuard } from '../auth/guards/permissions/permissions.guard';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../shared/permissions';
import * as jwtPayloadInterface from '../auth/interfaces/jwt-payload.interface';
import { ALL_PERMISSIONS } from '../shared/permissions';

@Controller('roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get('available-permissions')
  @HasPermission(PERMISSIONS.ROLES_VIEW)
  getAvailablePermissions() {
    return ALL_PERMISSIONS;
  }

  @Post()
  @HasPermission(PERMISSIONS.ROLES_CREATE)
  create(@Body() createRoleDto: CreateRoleDto, @CurrentUser() user: jwtPayloadInterface.JwtPayload) {
    return this.rolesService.create(createRoleDto, user.organizationId);
  }

  @Post('clone/:id')
  @HasPermission(PERMISSIONS.ROLES_CREATE)
  clone(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: jwtPayloadInterface.JwtPayload) {
    return this.rolesService.cloneRole(id, user.organizationId);
  }

  @Get()
  @HasPermission(PERMISSIONS.ROLES_VIEW)
  findAll(@CurrentUser() user: jwtPayloadInterface.JwtPayload) {
    return this.rolesService.findAllByOrg(user.organizationId);
  }

  @Patch(':id')
  @HasPermission(PERMISSIONS.ROLES_EDIT)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() updateRoleDto: UpdateRoleDto, @CurrentUser() user: jwtPayloadInterface.JwtPayload) {
    return this.rolesService.update(id, updateRoleDto, user.organizationId);
  }

  @Delete(':id')
  @HasPermission(PERMISSIONS.ROLES_DELETE)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: jwtPayloadInterface.JwtPayload) {
    return this.rolesService.remove(id, user.organizationId);
  }
}
```

- [ ] **Step 2: Verificar compilación**

```bash
npx tsc --noEmit -p apps/backend/api/tsconfig.app.json 2>&1 | grep "roles.controller" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add apps/backend/api/src/app/roles/roles.controller.ts
git commit -m "fix(security): agregar PermissionsGuard y @HasPermission a roles.controller"
```

---

## Task 7: Fix audit log — agregar organizationId y filtrar por org

**Files:**
- Modify: `apps/backend/api/src/app/audit/entities/audit-log.entity.ts`
- Modify: `apps/backend/api/src/app/audit/audit.service.ts`
- Modify: `apps/backend/api/src/app/audit/audit.controller.ts`

- [ ] **Step 1: Agregar `organizationId` a la entidad `AuditLog`**

Reemplazar `apps/backend/api/src/app/audit/entities/audit-log.entity.ts`:

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export enum ActionType {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  LOGIN_FAILED = 'LOGIN_FAILED',
  REFRESH = 'REFRESH',
  IMPERSONATE = 'IMPERSONATE',
}

@Entity({ name: 'audit_logs' })
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid', updatable: false })
  userId: string;

  @Index()
  @Column({ name: 'organization_id', type: 'uuid', updatable: false })
  organizationId: string;

  @Index()
  @Column({ updatable: false })
  entity: string;

  @Index()
  @Column({ name: 'entity_id', updatable: false })
  entityId: string;

  @Column({ type: 'enum', enum: ActionType, updatable: false })
  actionType: ActionType;

  @Column({ name: 'ip_address', nullable: true, updatable: false })
  ipAddress?: string;

  @Column({ type: 'jsonb', name: 'previous_value', nullable: true, updatable: false })
  previousValue?: object;

  @Column({ type: 'jsonb', name: 'new_value', nullable: true, updatable: false })
  newValue: object | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', updatable: false })
  timestamp: Date;
}
```

- [ ] **Step 2: Actualizar `AuditTrailService` para filtrar por org y aceptar `organizationId` en `record()`**

Reemplazar `apps/backend/api/src/app/audit/audit.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog, ActionType } from './entities/audit-log.entity';

@Injectable()
export class AuditTrailService {
  private readonly logger = new Logger(AuditTrailService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  async record(
    userId: string,
    organizationId: string,
    entity: string,
    entityId: string,
    actionType: ActionType,
    newValue: object,
    previousValue?: object,
    ipAddress?: string,
  ): Promise<void> {
    const auditLog = this.auditLogRepository.create({
      userId,
      organizationId,
      entity,
      entityId,
      actionType,
      newValue,
      previousValue,
      ipAddress,
    });
    this.auditLogRepository.save(auditLog).catch(err => {
      this.logger.error('Error saving audit log', err);
    });
  }

  async getLastLogin(userId: string): Promise<AuditLog | null> {
    return this.auditLogRepository.findOne({
      where: { userId, actionType: ActionType.LOGIN },
      order: { timestamp: 'DESC' },
    });
  }

  async find(
    organizationId: string,
    entity?: string,
    entityId?: string,
    page = 1,
    pageSize = 50,
  ): Promise<{ data: AuditLog[]; total: number }> {
    const [data, total] = await this.auditLogRepository.findAndCount({
      where: {
        organizationId,
        ...(entity ? { entity } : {}),
        ...(entityId ? { entityId } : {}),
      },
      order: { timestamp: 'DESC' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    });
    return { data, total };
  }
}
```

- [ ] **Step 3: Actualizar `AuditController` para inyectar usuario e incluir permiso**

Reemplazar `apps/backend/api/src/app/audit/audit.controller.ts`:

```typescript
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { PermissionsGuard } from '../auth/guards/permissions/permissions.guard';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuditTrailService } from './audit.service';
import { User } from '../users/entities/user.entity/user.entity';

@Controller('audit')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditController {
  constructor(private readonly auditTrailService: AuditTrailService) {}

  @Get()
  @HasPermission(PERMISSIONS.AUDIT_VIEW_TRAIL)
  findAll(
    @CurrentUser() user: User,
    @Query('entity') entity?: string,
    @Query('entityId') entityId?: string,
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 50,
  ) {
    return this.auditTrailService.find(user.organizationId, entity, entityId, +page, +pageSize);
  }
}
```

- [ ] **Step 4: Buscar y actualizar todas las llamadas a `record()` que existen**

```bash
grep -rn "auditTrailService.record\|AuditTrailService.*record" /c/Users/Usuario/Desktop/virteex1/apps/backend/api/src --include="*.ts" | grep -v spec
```

Para cada llamada encontrada, agregar `organizationId` como segundo parámetro. Ejemplo de cómo debe quedar cada llamada:

```typescript
// ANTES:
await this.auditTrailService.record(userId, entity, entityId, actionType, newValue, previousValue, ip);

// DESPUÉS:
await this.auditTrailService.record(userId, organizationId, entity, entityId, actionType, newValue, previousValue, ip);
```

- [ ] **Step 5: Verificar compilación**

```bash
npx tsc --noEmit -p apps/backend/api/tsconfig.app.json 2>&1 | grep -E "audit" | head -20
```

- [ ] **Step 6: Commit**

```bash
git add apps/backend/api/src/app/audit/
git commit -m "fix(security): agregar organizationId a AuditLog y filtrar GET /audit por org"
```

---

## Task 8: Fix WebSocket CORS hardcodeado y cookie parsing frágil

**Files:**
- Modify: `apps/backend/api/src/app/websockets/events.gateway.ts`

- [ ] **Step 1: Reemplazar el gateway completo**

Reemplazar `apps/backend/api/src/app/websockets/events.gateway.ts`:

```typescript
import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { UserCacheService } from '../auth/modules/user-cache.service';
import { parse as parseCookies } from 'cookie';

@WebSocketGateway({
  cors: {
    origin: (origin: string, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allows the origin defined in CORS_ORIGIN env or localhost:4200 as fallback
      const allowed = (process.env.CORS_ORIGIN || 'http://localhost:4200').split(',');
      if (!origin || allowed.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);
  private connectedUsers = new Map<string, string>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly userCacheService: UserCacheService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const cookieHeader = client.handshake.headers.cookie || '';
      const cookies = parseCookies(cookieHeader);
      const token = cookies['access_token'];

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify<{ id: string; tokenVersion: number }>(token, {
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
      this.server.emit('user-status-update', { userId: payload.id, isOnline: true });
    } catch (e) {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    for (const [userId, socketId] of this.connectedUsers.entries()) {
      if (socketId === client.id) {
        this.connectedUsers.delete(userId);
        this.logger.log(`User disconnected: ${userId}`);
        this.server.emit('user-status-update', { userId, isOnline: false });
        break;
      }
    }
  }

  sendToUser(userId: string, event: string, data: unknown) {
    const socketId = this.connectedUsers.get(userId);
    if (socketId) {
      this.server.to(socketId).emit(event, data);
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

  @SubscribeMessage('user-status')
  handleUserStatus(client: Socket, payload: { isOnline: boolean }): void {
    for (const [userId, socketId] of this.connectedUsers.entries()) {
      if (socketId === client.id) {
        this.server.emit('user-status-update', { userId, isOnline: payload.isOnline });
        break;
      }
    }
  }
}
```

- [ ] **Step 2: Verificar que el paquete `cookie` está disponible**

```bash
node -e "require('cookie'); console.log('cookie available')" 2>/dev/null || echo "Need to install"
```

Si no está disponible, instalarlo (está disponible como dep transitiva de socket.io, pero verificar):
```bash
grep '"cookie"' /c/Users/Usuario/Desktop/virteex1/package.json
```

- [ ] **Step 3: Compilar**

```bash
npx tsc --noEmit -p apps/backend/api/tsconfig.app.json 2>&1 | grep "events.gateway" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add apps/backend/api/src/app/websockets/events.gateway.ts
git commit -m "fix(websocket): CORS dinámico y cookie parsing seguro con librería cookie"
```

---

## Task 9: Fix Stripe webhook — usar raw body correctamente

**Files:**
- Modify: `apps/backend/api/src/app/payment/payment.controller.ts`

- [ ] **Step 1: Usar `@RawBody()` y agregar endpoint de suscripción**

Reemplazar `apps/backend/api/src/app/payment/payment.controller.ts`:

```typescript
import { Controller, Post, Get, Body, Headers, Req, RawBodyRequest, BadRequestException, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PaymentService } from './payment.service';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { SaasService } from '../saas/saas.service';

@Controller('payment')
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly saasService: SaasService
  ) {}

  @Post('checkout-session')
  @UseGuards(JwtAuthGuard)
  async createCheckoutSession(
    @CurrentUser() user: User,
    @Body() body: { priceId: string; successUrl: string; cancelUrl: string }
  ) {
    if (!user.organizationId) {
      throw new BadRequestException('User does not belong to an organization');
    }
    return this.paymentService.createCheckoutSession(
      user.organizationId,
      user.email,
      body.priceId,
      body.successUrl,
      body.cancelUrl
    );
  }

  @Get('config')
  async getConfig() {
    const plans = await this.saasService.getPlans();
    return {
      prices: {
        starter: plans.find(p => p.slug === 'starter')?.monthlyPriceId,
        pro: plans.find(p => p.slug === 'pro')?.monthlyPriceId,
        enterprise: plans.find(p => p.slug === 'enterprise')?.monthlyPriceId,
      },
      plans,
    };
  }

  @Get('subscription')
  @UseGuards(JwtAuthGuard)
  async getSubscription(@CurrentUser() user: User) {
    return this.paymentService.getSubscriptionStatus(user.organizationId);
  }

  @Post('webhook')
  @UseGuards(ThrottlerGuard)
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: RawBodyRequest<any>,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException('Raw body is required for webhook verification');
    }
    return this.paymentService.handleWebhook(signature, rawBody);
  }
}
```

- [ ] **Step 2: Agregar `getSubscriptionStatus()` en `payment.service.ts`**

Agregar al final del método list en `apps/backend/api/src/app/payment/payment.service.ts`:

```typescript
async getSubscriptionStatus(organizationId: string) {
  const org = await this.organizationRepository.findOne({
    where: { id: organizationId },
  });
  if (!org) {
    return { status: 'unknown', planId: null, subscriptionPeriodEnd: null };
  }
  return {
    status: org.subscriptionStatus ?? 'trial',
    planId: org.planId ?? null,
    subscriptionPeriodEnd: org.subscriptionPeriodEnd ?? null,
    subscriptionPeriodStart: org.subscriptionPeriodStart ?? null,
  };
}
```

- [ ] **Step 3: Compilar**

```bash
npx tsc --noEmit -p apps/backend/api/tsconfig.app.json 2>&1 | grep "payment" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add apps/backend/api/src/app/payment/payment.controller.ts apps/backend/api/src/app/payment/payment.service.ts
git commit -m "fix(payment): usar rawBody para webhook Stripe y agregar GET /subscription"
```

---

## Task 10: Fix SSL rejectUnauthorized en app.module.ts

**Files:**
- Modify: `apps/backend/api/src/app/app.module.ts:142-144`

- [ ] **Step 1: Cambiar `rejectUnauthorized: false` a `true`**

En `apps/backend/api/src/app/app.module.ts`, buscar y reemplazar:

```typescript
// ANTES:
ssl: config.get<boolean>('DB_SSL', false)
  ? { rejectUnauthorized: false }
  : false,

// DESPUÉS:
ssl: config.get<boolean>('DB_SSL', false)
  ? {
      rejectUnauthorized: config.get<string>('NODE_ENV') === 'production',
      ca: config.get<string>('DB_SSL_CA') || undefined,
    }
  : false,
```

Esto permite desarrollo sin certificados pero exige verificación en producción.

- [ ] **Step 2: Commit**

```bash
git add apps/backend/api/src/app/app.module.ts
git commit -m "fix(security): SSL rejectUnauthorized: true en producción para conexión a BD"
```

---

## Task 11: Fix frontend — URLs incorrectas en auth.ts

**Files:**
- Modify: `apps/core/client-web/src/app/core/services/auth.ts:444,452`

- [ ] **Step 1: Corregir las URLs de `inviteUser()` y `updateUser()`**

En `apps/core/client-web/src/app/core/services/auth.ts`, buscar y reemplazar:

```typescript
// ANTES (línea ~444):
inviteUser(payload: UserPayload): Observable<User> {
  return this.http.post<User>(`${this.apiUrl}/invite`, payload);
}

// DESPUÉS:
inviteUser(payload: UserPayload): Observable<User> {
  return this.http.post<User>(`${this.baseUrl}/users/invite`, payload);
}

// ANTES (línea ~452):
updateUser(id: string, payload: UserPayload): Observable<User> {
  return this.http.patch<User>(`${this.apiUrl}/${id}`, payload);
}

// DESPUÉS:
updateUser(id: string, payload: UserPayload): Observable<User> {
  return this.http.patch<User>(`${this.baseUrl}/users/${id}`, payload);
}
```

Verificar que `this.baseUrl` apunta a la URL base del API (sin `/auth`). Si solo `this.apiUrl` existe y es `${baseUrl}/auth`, usar `${this.baseUrl}/users/...` donde `baseUrl` es el inject de `API_URL`.

- [ ] **Step 2: Compilar frontend**

```bash
npx tsc --noEmit -p apps/core/client-web/tsconfig.app.json 2>&1 | grep "auth.ts" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add apps/core/client-web/src/app/core/services/auth.ts
git commit -m "fix(frontend): corregir URLs de inviteUser y updateUser en auth.service"
```

---

## Task 12: Fix BillingService — conectar a API real

**Files:**
- Modify: `apps/core/client-web/src/app/core/services/billing.ts`

- [ ] **Step 1: Reemplazar el servicio de billing con datos reales**

Reemplazar `apps/core/client-web/src/app/core/services/billing.ts`:

```typescript
import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError, tap } from 'rxjs/operators';
import { Plan } from '../models/plan.model';
import { API_URL } from '../tokens/api-url.token';

export interface Subscription {
  planName: string;
  planId: string | null;
  status: string;
  price?: number;
  billingCycle?: 'mensual' | 'anual';
  nextBillingDate?: string;
  subscriptionPeriodEnd?: string;
  subscriptionPeriodStart?: string;
  trialEndsDate?: string;
}

export interface PaymentMethod {
  type: string;
  last4: string;
  expiryDate: string;
}

export interface PaymentHistoryItem {
  id: string;
  date: string;
  description: string;
  amount: number;
}

@Injectable({ providedIn: 'root' })
export class BillingService {
  private http = inject(HttpClient);
  private readonly baseUrl = inject(API_URL);

  plans = signal<Plan[]>([]);
  currentSubscription = signal<Subscription | null>(null);
  paymentMethod = signal<PaymentMethod | null>(null);
  paymentHistory = signal<PaymentHistoryItem[]>([]);

  constructor() {
    this.loadPlans();
    this.loadSubscription();
  }

  loadPlans() {
    this.http.get<Plan[]>(`${this.baseUrl}/saas/plans`).pipe(
      tap(plans => this.plans.set(plans)),
      catchError(err => {
        console.error('Failed to load plans', err);
        return of([]);
      })
    ).subscribe();
  }

  loadSubscription() {
    this.http.get<Subscription>(`${this.baseUrl}/payment/subscription`).pipe(
      tap(sub => this.currentSubscription.set(sub)),
      catchError(() => of(null))
    ).subscribe();
  }

  getUsage(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/saas/usage`).pipe(
      catchError(() => of([]))
    );
  }

  getSubscription(): Observable<Subscription | null> {
    return this.http.get<Subscription>(`${this.baseUrl}/payment/subscription`).pipe(
      tap(sub => this.currentSubscription.set(sub)),
      catchError(() => of(this.currentSubscription()))
    );
  }

  getPaymentMethod(): Observable<PaymentMethod | null> {
    return of(this.paymentMethod());
  }

  getPaymentHistory(): Observable<PaymentHistoryItem[]> {
    return of(this.paymentHistory());
  }

  changePlan(newPlanId: string): Observable<boolean> {
    const plan = this.plans().find(p => p.slug === newPlanId || p.id === newPlanId);
    if (!plan) return of(false);
    return this.http.post<{ sessionId: string; url: string }>(`${this.baseUrl}/payment/checkout-session`, {
      priceId: plan.monthlyPriceId,
      successUrl: window.location.href,
      cancelUrl: window.location.href,
    }).pipe(
      map(res => {
        if (res.url) {
          window.location.href = res.url;
          return true;
        }
        return false;
      }),
      catchError(() => of(false))
    );
  }
}
```

- [ ] **Step 2: Compilar**

```bash
npx tsc --noEmit -p apps/core/client-web/tsconfig.app.json 2>&1 | grep "billing" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add apps/core/client-web/src/app/core/services/billing.ts
git commit -m "fix(frontend): conectar BillingService a API real en lugar de datos mock"
```

---

## Task 13: Fix branding — auth.routes.ts usa nombre incorrecto

**Files:**
- Modify: `apps/core/client-web/src/app/features/auth/auth.routes.ts`

- [ ] **Step 1: Reemplazar "FacturaPRO" con "Virteex"**

Editar `apps/core/client-web/src/app/features/auth/auth.routes.ts`:

```typescript
// ANTES:
title: 'Crear Cuenta | FacturaPRO',
// ...
title: 'Iniciar Sesión | FacturaPRO',
// ...
title: 'Seleccionar Plan | FacturaPRO',

// DESPUÉS:
title: 'Crear Cuenta | Virteex',
// ...
title: 'Iniciar Sesión | Virteex',
// ...
title: 'Seleccionar Plan | Virteex',
```

- [ ] **Step 2: Commit**

```bash
git add apps/core/client-web/src/app/features/auth/auth.routes.ts
git commit -m "fix(ui): corregir branding de FacturaPRO a Virteex en auth routes"
```

---

## Task 14: Implementar SecuritySettingsPage con audit log

**Files:**
- Modify: `apps/core/client-web/src/app/features/settings/system/security/security.page.ts`

- [ ] **Step 1: Implementar la página completa con audit log paginado**

Reemplazar `apps/core/client-web/src/app/features/settings/system/security/security.page.ts`:

```typescript
import { Component, OnInit, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { API_URL } from '../../../../core/tokens/api-url.token';

interface AuditLogEntry {
  id: string;
  userId: string;
  entity: string;
  entityId: string;
  actionType: string;
  ipAddress?: string;
  timestamp: string;
  newValue?: any;
  previousValue?: any;
}

interface AuditResponse {
  data: AuditLogEntry[];
  total: number;
}

const ACTION_LABELS: Record<string, string> = {
  LOGIN: 'Inicio de sesión',
  LOGOUT: 'Cierre de sesión',
  LOGIN_FAILED: 'Intento fallido',
  CREATE: 'Creación',
  UPDATE: 'Actualización',
  DELETE: 'Eliminación',
  REFRESH: 'Renovación de sesión',
  IMPERSONATE: 'Suplantación',
};

const ACTION_COLORS: Record<string, string> = {
  LOGIN: 'bg-green-100 text-green-800',
  LOGOUT: 'bg-gray-100 text-gray-800',
  LOGIN_FAILED: 'bg-red-100 text-red-800',
  CREATE: 'bg-blue-100 text-blue-800',
  UPDATE: 'bg-yellow-100 text-yellow-800',
  DELETE: 'bg-red-100 text-red-800',
  REFRESH: 'bg-purple-100 text-purple-800',
  IMPERSONATE: 'bg-orange-100 text-orange-800',
};

@Component({
  selector: 'app-security',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="p-6 max-w-6xl mx-auto">
      <div class="mb-6">
        <h2 class="text-2xl font-bold text-gray-900">Seguridad y Auditoría</h2>
        <p class="text-gray-500 mt-1">Historial de acciones y eventos de seguridad de tu organización.</p>
      </div>

      <!-- Filtros -->
      <div class="bg-white rounded-lg border border-gray-200 p-4 mb-6 flex flex-wrap gap-4 items-center">
        <div>
          <label class="block text-xs font-medium text-gray-500 mb-1">Tipo de entidad</label>
          <select
            [(ngModel)]="entityFilter"
            (ngModelChange)="onFilterChange()"
            class="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
            <option value="">Todos</option>
            <option value="User">Usuarios</option>
            <option value="Role">Roles</option>
            <option value="Organization">Organización</option>
            <option value="Auth">Autenticación</option>
          </select>
        </div>
        <button
          (click)="loadAuditLog()"
          class="ml-auto px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
          Actualizar
        </button>
      </div>

      <!-- Tabla -->
      <div class="bg-white rounded-lg border border-gray-200 overflow-hidden">
        @if (loading()) {
          <div class="flex items-center justify-center py-16">
            <svg class="animate-spin h-8 w-8 text-blue-600" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
          </div>
        } @else if (auditLogs().length === 0) {
          <div class="text-center py-16 text-gray-500">
            <svg class="mx-auto h-12 w-12 text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p class="font-medium">Sin registros de auditoría</p>
          </div>
        } @else {
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha / Hora</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Acción</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Entidad</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP</th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-100">
                @for (log of auditLogs(); track log.id) {
                  <tr class="hover:bg-gray-50">
                    <td class="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {{ log.timestamp | date:'dd/MM/yyyy HH:mm:ss' }}
                    </td>
                    <td class="px-4 py-3">
                      <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                        [class]="getActionColor(log.actionType)">
                        {{ getActionLabel(log.actionType) }}
                      </span>
                    </td>
                    <td class="px-4 py-3 text-sm text-gray-700">
                      {{ log.entity }}
                    </td>
                    <td class="px-4 py-3 text-sm text-gray-500 font-mono">
                      {{ log.ipAddress || '—' }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <!-- Paginación -->
          <div class="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
            <span class="text-sm text-gray-500">
              Mostrando {{ startItem() }}–{{ endItem() }} de {{ total() }} registros
            </span>
            <div class="flex gap-2">
              <button
                (click)="prevPage()"
                [disabled]="page() === 1"
                class="px-3 py-1 text-sm border border-gray-300 rounded-md disabled:opacity-40 hover:bg-gray-50 transition-colors">
                ← Anterior
              </button>
              <button
                (click)="nextPage()"
                [disabled]="page() * pageSize() >= total()"
                class="px-3 py-1 text-sm border border-gray-300 rounded-md disabled:opacity-40 hover:bg-gray-50 transition-colors">
                Siguiente →
              </button>
            </div>
          </div>
        }
      </div>
    </div>
  `
})
export class SecuritySettingsPage implements OnInit {
  private http = inject(HttpClient);
  private readonly apiUrl = inject(API_URL);

  loading = signal(false);
  auditLogs = signal<AuditLogEntry[]>([]);
  total = signal(0);
  page = signal(1);
  pageSize = signal(50);
  entityFilter = '';

  startItem = computed(() => (this.page() - 1) * this.pageSize() + 1);
  endItem = computed(() => Math.min(this.page() * this.pageSize(), this.total()));

  ngOnInit() {
    this.loadAuditLog();
  }

  loadAuditLog() {
    this.loading.set(true);
    let url = `${this.apiUrl}/audit?page=${this.page()}&pageSize=${this.pageSize()}`;
    if (this.entityFilter) url += `&entity=${this.entityFilter}`;

    this.http.get<AuditResponse>(url).subscribe({
      next: (res) => {
        this.auditLogs.set(res.data);
        this.total.set(res.total);
        this.loading.set(false);
      },
      error: () => {
        this.auditLogs.set([]);
        this.loading.set(false);
      }
    });
  }

  onFilterChange() {
    this.page.set(1);
    this.loadAuditLog();
  }

  prevPage() {
    if (this.page() > 1) {
      this.page.update(p => p - 1);
      this.loadAuditLog();
    }
  }

  nextPage() {
    if (this.page() * this.pageSize() < this.total()) {
      this.page.update(p => p + 1);
      this.loadAuditLog();
    }
  }

  getActionLabel(actionType: string): string {
    return ACTION_LABELS[actionType] ?? actionType;
  }

  getActionColor(actionType: string): string {
    return ACTION_COLORS[actionType] ?? 'bg-gray-100 text-gray-800';
  }
}
```

- [ ] **Step 2: Compilar**

```bash
npx tsc --noEmit -p apps/core/client-web/tsconfig.app.json 2>&1 | grep "security.page" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add apps/core/client-web/src/app/features/settings/system/security/security.page.ts
git commit -m "feat(settings): implementar SecuritySettingsPage con audit log paginado"
```

---

## Task 15: Implementar CurrencySettingsPage con CRUD completo

**Files:**
- Modify: `apps/core/client-web/src/app/features/settings/finance/currencies/currencies.page.ts`

- [ ] **Step 1: Implementar la página de monedas**

Reemplazar `apps/core/client-web/src/app/features/settings/finance/currencies/currencies.page.ts`:

```typescript
import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { API_URL } from '../../../../core/tokens/api-url.token';

interface Currency {
  id: string;
  name: string;
  code: string;
  symbol: string;
  createdAt: string;
}

@Component({
  selector: 'app-currencies',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  template: `
    <div class="p-6 max-w-4xl mx-auto">
      <div class="mb-6 flex items-center justify-between">
        <div>
          <h2 class="text-2xl font-bold text-gray-900">Multimoneda y Tasas</h2>
          <p class="text-gray-500 mt-1">Gestiona las monedas disponibles en tu organización.</p>
        </div>
        <button
          (click)="showForm.set(true)"
          class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors">
          + Nueva Moneda
        </button>
      </div>

      <!-- Formulario -->
      @if (showForm()) {
        <div class="bg-white border border-gray-200 rounded-lg p-5 mb-6">
          <h3 class="font-semibold text-gray-800 mb-4">{{ editingId() ? 'Editar Moneda' : 'Nueva Moneda' }}</h3>
          <form [formGroup]="form" (ngSubmit)="save()" class="grid grid-cols-3 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
              <input formControlName="name" type="text" placeholder="Ej: Dólar Estadounidense"
                class="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Código (ISO 4217)</label>
              <input formControlName="code" type="text" placeholder="Ej: USD" maxlength="3"
                class="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 uppercase" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Símbolo</label>
              <input formControlName="symbol" type="text" placeholder="Ej: $"
                class="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            </div>
            <div class="col-span-3 flex gap-3 justify-end">
              <button type="button" (click)="cancelForm()"
                class="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">Cancelar</button>
              <button type="submit" [disabled]="form.invalid || saving()"
                class="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">
                {{ saving() ? 'Guardando...' : 'Guardar' }}
              </button>
            </div>
          </form>
        </div>
      }

      <!-- Lista -->
      <div class="bg-white rounded-lg border border-gray-200 overflow-hidden">
        @if (loading()) {
          <div class="text-center py-12 text-gray-500">Cargando...</div>
        } @else if (currencies().length === 0) {
          <div class="text-center py-12 text-gray-500">No hay monedas configuradas.</div>
        } @else {
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Código</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nombre</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Símbolo</th>
                <th class="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              @for (currency of currencies(); track currency.id) {
                <tr class="hover:bg-gray-50">
                  <td class="px-4 py-3 font-mono font-semibold text-sm text-gray-900">{{ currency.code }}</td>
                  <td class="px-4 py-3 text-sm text-gray-700">{{ currency.name }}</td>
                  <td class="px-4 py-3 text-sm text-gray-700">{{ currency.symbol }}</td>
                  <td class="px-4 py-3 text-right">
                    <button (click)="edit(currency)" class="text-sm text-blue-600 hover:underline mr-4">Editar</button>
                    <button (click)="delete(currency.id)" class="text-sm text-red-600 hover:underline">Eliminar</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
    </div>
  `
})
export class CurrencySettingsPage implements OnInit {
  private http = inject(HttpClient);
  private fb = inject(FormBuilder);
  private readonly apiUrl = inject(API_URL);

  currencies = signal<Currency[]>([]);
  loading = signal(false);
  saving = signal(false);
  showForm = signal(false);
  editingId = signal<string | null>(null);

  form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    code: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(3)]],
    symbol: ['', Validators.required],
  });

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.http.get<Currency[]>(`${this.apiUrl}/currencies`).subscribe({
      next: (data) => { this.currencies.set(data); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  edit(currency: Currency) {
    this.editingId.set(currency.id);
    this.form.patchValue({ name: currency.name, code: currency.code, symbol: currency.symbol });
    this.showForm.set(true);
  }

  cancelForm() {
    this.showForm.set(false);
    this.editingId.set(null);
    this.form.reset();
  }

  save() {
    if (this.form.invalid) return;
    this.saving.set(true);
    const data = { ...this.form.value, code: this.form.value.code?.toUpperCase() };
    const id = this.editingId();
    const req = id
      ? this.http.patch(`${this.apiUrl}/currencies/${id}`, data)
      : this.http.post(`${this.apiUrl}/currencies`, data);

    req.subscribe({
      next: () => { this.load(); this.cancelForm(); this.saving.set(false); },
      error: () => this.saving.set(false),
    });
  }

  delete(id: string) {
    if (!confirm('¿Eliminar esta moneda?')) return;
    this.http.delete(`${this.apiUrl}/currencies/${id}`).subscribe({ next: () => this.load() });
  }
}
```

- [ ] **Step 2: Compilar**

```bash
npx tsc --noEmit -p apps/core/client-web/tsconfig.app.json 2>&1 | grep "currencies" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add apps/core/client-web/src/app/features/settings/finance/currencies/currencies.page.ts
git commit -m "feat(settings): implementar CurrencySettingsPage con CRUD completo conectado a API"
```

---

## Task 16: Implementar TaxRulesPage con CRUD completo

**Files:**
- Modify: `apps/core/client-web/src/app/features/settings/finance/taxes/taxes.page.ts`

- [ ] **Step 1: Implementar la página de impuestos**

Reemplazar `apps/core/client-web/src/app/features/settings/finance/taxes/taxes.page.ts`:

```typescript
import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { API_URL } from '../../../../core/tokens/api-url.token';

interface Tax {
  id: string;
  name: string;
  rate: number;
  type: 'Porcentaje' | 'Fijo';
  countryCode?: string;
}

@Component({
  selector: 'app-tax-rules',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  template: `
    <div class="p-6 max-w-4xl mx-auto">
      <div class="mb-6 flex items-center justify-between">
        <div>
          <h2 class="text-2xl font-bold text-gray-900">Reglas de Impuestos</h2>
          <p class="text-gray-500 mt-1">Configura los impuestos aplicables a tu organización.</p>
        </div>
        <button (click)="showForm.set(true)"
          class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors">
          + Nuevo Impuesto
        </button>
      </div>

      @if (showForm()) {
        <div class="bg-white border border-gray-200 rounded-lg p-5 mb-6">
          <h3 class="font-semibold text-gray-800 mb-4">{{ editingId() ? 'Editar Impuesto' : 'Nuevo Impuesto' }}</h3>
          <form [formGroup]="form" (ngSubmit)="save()" class="grid grid-cols-2 gap-4">
            <div class="col-span-2">
              <label class="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
              <input formControlName="name" type="text" placeholder="Ej: ITBIS 18%"
                class="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Tasa</label>
              <input formControlName="rate" type="number" step="0.01" placeholder="18"
                class="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
              <select formControlName="type"
                class="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500">
                <option value="Porcentaje">Porcentaje (%)</option>
                <option value="Fijo">Monto Fijo</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">País (código ISO)</label>
              <input formControlName="countryCode" type="text" placeholder="DO, US, MX..."
                class="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 uppercase" />
            </div>
            <div class="col-span-2 flex gap-3 justify-end">
              <button type="button" (click)="cancelForm()"
                class="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">Cancelar</button>
              <button type="submit" [disabled]="form.invalid || saving()"
                class="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">
                {{ saving() ? 'Guardando...' : 'Guardar' }}
              </button>
            </div>
          </form>
        </div>
      }

      <div class="bg-white rounded-lg border border-gray-200 overflow-hidden">
        @if (loading()) {
          <div class="text-center py-12 text-gray-500">Cargando...</div>
        } @else if (taxes().length === 0) {
          <div class="text-center py-12 text-gray-500">No hay impuestos configurados.</div>
        } @else {
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nombre</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tasa</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">País</th>
                <th class="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              @for (tax of taxes(); track tax.id) {
                <tr class="hover:bg-gray-50">
                  <td class="px-4 py-3 text-sm font-medium text-gray-900">{{ tax.name }}</td>
                  <td class="px-4 py-3 text-sm text-gray-700">
                    {{ tax.rate }}{{ tax.type === 'Porcentaje' ? '%' : '' }}
                  </td>
                  <td class="px-4 py-3 text-sm text-gray-700">{{ tax.type }}</td>
                  <td class="px-4 py-3 text-sm text-gray-500 font-mono">{{ tax.countryCode || '—' }}</td>
                  <td class="px-4 py-3 text-right">
                    <button (click)="edit(tax)" class="text-sm text-blue-600 hover:underline mr-4">Editar</button>
                    <button (click)="delete(tax.id)" class="text-sm text-red-600 hover:underline">Eliminar</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
    </div>
  `
})
export class TaxRulesPage implements OnInit {
  private http = inject(HttpClient);
  private fb = inject(FormBuilder);
  private readonly apiUrl = inject(API_URL);

  taxes = signal<Tax[]>([]);
  loading = signal(false);
  saving = signal(false);
  showForm = signal(false);
  editingId = signal<string | null>(null);

  form = this.fb.group({
    name: ['', Validators.required],
    rate: [0, [Validators.required, Validators.min(0)]],
    type: ['Porcentaje', Validators.required],
    countryCode: [''],
  });

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    this.http.get<Tax[]>(`${this.apiUrl}/taxes`).subscribe({
      next: (data) => { this.taxes.set(data); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  edit(tax: Tax) {
    this.editingId.set(tax.id);
    this.form.patchValue({ name: tax.name, rate: tax.rate, type: tax.type, countryCode: tax.countryCode ?? '' });
    this.showForm.set(true);
  }

  cancelForm() { this.showForm.set(false); this.editingId.set(null); this.form.reset({ type: 'Porcentaje', rate: 0 }); }

  save() {
    if (this.form.invalid) return;
    this.saving.set(true);
    const data = this.form.value;
    const id = this.editingId();
    const req = id ? this.http.patch(`${this.apiUrl}/taxes/${id}`, data) : this.http.post(`${this.apiUrl}/taxes`, data);
    req.subscribe({
      next: () => { this.load(); this.cancelForm(); this.saving.set(false); },
      error: () => this.saving.set(false),
    });
  }

  delete(id: string) {
    if (!confirm('¿Eliminar este impuesto?')) return;
    this.http.delete(`${this.apiUrl}/taxes/${id}`).subscribe({ next: () => this.load() });
  }
}
```

- [ ] **Step 2: Compilar**

```bash
npx tsc --noEmit -p apps/core/client-web/tsconfig.app.json 2>&1 | grep "taxes" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add apps/core/client-web/src/app/features/settings/finance/taxes/taxes.page.ts
git commit -m "feat(settings): implementar TaxRulesPage con CRUD completo conectado a API"
```

---

## Task 17: Implementar AccountingSettingsPage

**Files:**
- Modify: `apps/core/client-web/src/app/features/settings/finance/accounting/accounting.page.ts`

- [ ] **Step 1: Implementar la página de preferencias contables**

Reemplazar `apps/core/client-web/src/app/features/settings/finance/accounting/accounting.page.ts`:

```typescript
import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { API_URL } from '../../../../core/tokens/api-url.token';

interface AccountingPeriod {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
}

interface Ledger {
  id: string;
  name: string;
  currency?: string;
  isDefault?: boolean;
}

@Component({
  selector: 'app-accounting-settings',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6 max-w-4xl mx-auto">
      <div class="mb-6">
        <h2 class="text-2xl font-bold text-gray-900">Preferencias Contables</h2>
        <p class="text-gray-500 mt-1">Gestión de libros contables y períodos fiscales.</p>
      </div>

      <!-- Libros contables -->
      <div class="bg-white border border-gray-200 rounded-lg p-5 mb-6">
        <h3 class="font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <svg class="h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Libros Contables
        </h3>
        @if (loadingLedgers()) {
          <p class="text-sm text-gray-500">Cargando...</p>
        } @else if (ledgers().length === 0) {
          <p class="text-sm text-gray-500">No hay libros configurados.</p>
        } @else {
          <div class="space-y-2">
            @for (ledger of ledgers(); track ledger.id) {
              <div class="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-md">
                <div class="flex items-center gap-3">
                  <span class="text-sm font-medium text-gray-900">{{ ledger.name }}</span>
                  @if (ledger.isDefault) {
                    <span class="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Principal</span>
                  }
                </div>
                @if (ledger.currency) {
                  <span class="text-xs text-gray-500 font-mono">{{ ledger.currency }}</span>
                }
              </div>
            }
          </div>
        }
      </div>

      <!-- Períodos contables -->
      <div class="bg-white border border-gray-200 rounded-lg p-5">
        <h3 class="font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <svg class="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          Períodos Contables
        </h3>
        @if (loadingPeriods()) {
          <p class="text-sm text-gray-500">Cargando...</p>
        } @else if (periods().length === 0) {
          <p class="text-sm text-gray-500">No hay períodos configurados.</p>
        } @else {
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200">
              <thead>
                <tr>
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Período</th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Desde</th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Hasta</th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Estado</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                @for (period of periods(); track period.id) {
                  <tr>
                    <td class="px-3 py-2 text-sm font-medium text-gray-900">{{ period.name }}</td>
                    <td class="px-3 py-2 text-sm text-gray-600">{{ period.startDate | date:'dd/MM/yyyy' }}</td>
                    <td class="px-3 py-2 text-sm text-gray-600">{{ period.endDate | date:'dd/MM/yyyy' }}</td>
                    <td class="px-3 py-2">
                      <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                        [class]="period.status === 'OPEN' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'">
                        {{ period.status === 'OPEN' ? 'Abierto' : period.status === 'CLOSED' ? 'Cerrado' : period.status }}
                      </span>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>

      <p class="mt-4 text-xs text-gray-400">
        Para cerrar o reabrir períodos, ve al módulo de Contabilidad → Gestión de Períodos.
      </p>
    </div>
  `
})
export class AccountingSettingsPage implements OnInit {
  private http = inject(HttpClient);
  private readonly apiUrl = inject(API_URL);

  ledgers = signal<Ledger[]>([]);
  periods = signal<AccountingPeriod[]>([]);
  loadingLedgers = signal(false);
  loadingPeriods = signal(false);

  ngOnInit() {
    this.loadLedgers();
    this.loadPeriods();
  }

  loadLedgers() {
    this.loadingLedgers.set(true);
    this.http.get<Ledger[]>(`${this.apiUrl}/accounting/ledgers`).subscribe({
      next: (data) => { this.ledgers.set(data); this.loadingLedgers.set(false); },
      error: () => this.loadingLedgers.set(false),
    });
  }

  loadPeriods() {
    this.loadingPeriods.set(true);
    this.http.get<AccountingPeriod[]>(`${this.apiUrl}/accounting/periods`).subscribe({
      next: (data) => { this.periods.set(data); this.loadingPeriods.set(false); },
      error: () => this.loadingPeriods.set(false),
    });
  }
}
```

- [ ] **Step 2: Compilar**

```bash
npx tsc --noEmit -p apps/core/client-web/tsconfig.app.json 2>&1 | grep "accounting" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add apps/core/client-web/src/app/features/settings/finance/accounting/accounting.page.ts
git commit -m "feat(settings): implementar AccountingSettingsPage con libros y períodos"
```

---

## Task 18: Implementar SmtpSettingsPage

**Files:**
- Modify: `apps/core/client-web/src/app/features/settings/system/smtp/smtp.page.ts`

- [ ] **Step 1: Implementar la página SMTP con form completo**

Reemplazar `apps/core/client-web/src/app/features/settings/system/smtp/smtp.page.ts`:

```typescript
import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { API_URL } from '../../../../core/tokens/api-url.token';

interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromName: string;
  fromEmail: string;
}

@Component({
  selector: 'app-smtp',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  template: `
    <div class="p-6 max-w-2xl mx-auto">
      <div class="mb-6">
        <h2 class="text-2xl font-bold text-gray-900">Servidor de Correo (SMTP)</h2>
        <p class="text-gray-500 mt-1">Configura el servidor SMTP para el envío de correos de tu organización.</p>
      </div>

      <div class="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 flex gap-3">
        <svg class="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p class="text-sm text-amber-800">
          La configuración SMTP personalizada estará disponible en una próxima actualización.
          Actualmente el sistema utiliza el servidor SMTP configurado por el administrador de la plataforma.
        </p>
      </div>

      <div class="bg-white border border-gray-200 rounded-lg p-5">
        <h3 class="font-semibold text-gray-800 mb-4">Configuración actual (solo lectura)</h3>
        <form [formGroup]="form" class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Servidor SMTP</label>
              <input formControlName="host" type="text" placeholder="smtp.ejemplo.com" readonly
                class="w-full border border-gray-200 bg-gray-50 rounded-md px-3 py-2 text-sm text-gray-500 cursor-not-allowed" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Puerto</label>
              <input formControlName="port" type="number" placeholder="587" readonly
                class="w-full border border-gray-200 bg-gray-50 rounded-md px-3 py-2 text-sm text-gray-500 cursor-not-allowed" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Nombre del remitente</label>
              <input formControlName="fromName" type="text" placeholder="Virteex ERP" readonly
                class="w-full border border-gray-200 bg-gray-50 rounded-md px-3 py-2 text-sm text-gray-500 cursor-not-allowed" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Email del remitente</label>
              <input formControlName="fromEmail" type="email" placeholder="noreply@virteex.com" readonly
                class="w-full border border-gray-200 bg-gray-50 rounded-md px-3 py-2 text-sm text-gray-500 cursor-not-allowed" />
            </div>
          </div>
          <div class="flex items-center gap-2">
            <input type="checkbox" formControlName="secure" id="secure" disabled
              class="h-4 w-4 text-blue-600 border-gray-300 rounded" />
            <label for="secure" class="text-sm text-gray-700">Usar TLS/SSL</label>
          </div>
        </form>

        <div class="mt-6 pt-4 border-t border-gray-100">
          <p class="text-xs text-gray-400">
            Para configurar un SMTP personalizado, contacta al soporte de Virteex o espera la próxima actualización de la plataforma.
          </p>
        </div>
      </div>
    </div>
  `
})
export class SmtpSettingsPage implements OnInit {
  private http = inject(HttpClient);
  private fb = inject(FormBuilder);
  private readonly apiUrl = inject(API_URL);

  loading = signal(false);

  form = this.fb.group({
    host: [{ value: '', disabled: true }],
    port: [{ value: 587, disabled: true }],
    secure: [{ value: true, disabled: true }],
    fromName: [{ value: '', disabled: true }],
    fromEmail: [{ value: '', disabled: true }],
  });

  ngOnInit() {
    this.loadConfig();
  }

  loadConfig() {
    this.loading.set(true);
    this.http.get<SmtpSettings>(`${this.apiUrl}/organizations/settings/smtp`).subscribe({
      next: (data) => {
        this.form.patchValue(data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }
}
```

- [ ] **Step 2: Agregar endpoint `GET /organizations/settings/smtp` en el backend**

En `apps/backend/api/src/app/organizations/organizations.controller.ts`, agregar al final de la clase:

```typescript
@Get('settings/smtp')
async getSmtpSettings(@CurrentUser() user: User) {
  // Retorna la configuración SMTP del sistema (solo para información)
  // No se exponen credenciales
  return {
    host: this.configService.get<string>('MAIL_HOST', ''),
    port: this.configService.get<number>('MAIL_PORT', 587),
    secure: this.configService.get<boolean>('MAIL_SECURE', true),
    fromName: this.configService.get<string>('MAIL_FROM_NAME', 'Virteex'),
    fromEmail: this.configService.get<string>('MAIL_FROM', ''),
  };
}
```

Agregar `ConfigService` al constructor si no existe:
```typescript
constructor(
  private readonly organizationsService: OrganizationsService,
  private readonly configService: ConfigService,
) {}
```

Y agregar el import en los imports del controller:
```typescript
import { ConfigService } from '@nestjs/config';
```

- [ ] **Step 3: Compilar ambos**

```bash
npx tsc --noEmit -p apps/backend/api/tsconfig.app.json 2>&1 | grep "organizations.controller" | head -10
npx tsc --noEmit -p apps/core/client-web/tsconfig.app.json 2>&1 | grep "smtp" | head -10
```

- [ ] **Step 4: Commit**

```bash
git add apps/core/client-web/src/app/features/settings/system/smtp/smtp.page.ts apps/backend/api/src/app/organizations/organizations.controller.ts
git commit -m "feat(settings): implementar SmtpSettingsPage y endpoint GET /organizations/settings/smtp"
```

---

## Task 19: Implementar IntegrationSettingsPage

**Files:**
- Modify: `apps/core/client-web/src/app/features/settings/system/integrations/integrations.page.ts`

- [ ] **Step 1: Implementar la página de integraciones**

Reemplazar `apps/core/client-web/src/app/features/settings/system/integrations/integrations.page.ts`:

```typescript
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

interface Integration {
  id: string;
  name: string;
  description: string;
  logo: string;
  status: 'connected' | 'available' | 'coming_soon';
  category: string;
}

@Component({
  selector: 'app-integrations',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6 max-w-4xl mx-auto">
      <div class="mb-6">
        <h2 class="text-2xl font-bold text-gray-900">Integraciones</h2>
        <p class="text-gray-500 mt-1">Conecta Virteex con las herramientas que ya usas.</p>
      </div>

      @for (category of categories; track category) {
        <div class="mb-8">
          <h3 class="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">{{ category }}</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            @for (integration of getByCategory(category); track integration.id) {
              <div class="bg-white border border-gray-200 rounded-lg p-4 flex items-start gap-4">
                <div class="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-2xl flex-shrink-0">
                  {{ integration.logo }}
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between gap-2">
                    <h4 class="text-sm font-semibold text-gray-900">{{ integration.name }}</h4>
                    <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0"
                      [class]="getStatusClass(integration.status)">
                      {{ getStatusLabel(integration.status) }}
                    </span>
                  </div>
                  <p class="text-xs text-gray-500 mt-1">{{ integration.description }}</p>
                  @if (integration.status === 'available') {
                    <button class="mt-2 text-xs text-blue-600 font-medium hover:underline">Conectar →</button>
                  }
                </div>
              </div>
            }
          </div>
        </div>
      }

      <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-6">
        <p class="text-sm text-blue-800">
          ¿Necesitas una integración que no está aquí?
          <a href="mailto:soporte@virteex.com" class="font-medium underline">Contáctanos</a> o revisa nuestra
          <a href="#" class="font-medium underline">documentación de API</a>.
        </p>
      </div>
    </div>
  `
})
export class IntegrationSettingsPage {
  integrations: Integration[] = [
    {
      id: 'stripe',
      name: 'Stripe',
      description: 'Procesamiento de pagos y gestión de suscripciones.',
      logo: '💳',
      status: 'connected',
      category: 'Pagos',
    },
    {
      id: 'paypal',
      name: 'PayPal',
      description: 'Acepta pagos con PayPal en tus facturas.',
      logo: '🅿️',
      status: 'coming_soon',
      category: 'Pagos',
    },
    {
      id: 'google',
      name: 'Google Workspace',
      description: 'Autenticación SSO con Google.',
      logo: '🔵',
      status: 'available',
      category: 'Autenticación',
    },
    {
      id: 'microsoft',
      name: 'Microsoft Azure AD',
      description: 'Autenticación SSO con Microsoft.',
      logo: '🪟',
      status: 'coming_soon',
      category: 'Autenticación',
    },
    {
      id: 'twilio',
      name: 'Twilio',
      description: 'Envío de SMS para verificación y notificaciones.',
      logo: '📱',
      status: 'connected',
      category: 'Comunicaciones',
    },
    {
      id: 'sendgrid',
      name: 'SendGrid',
      description: 'Envío de correos transaccionales.',
      logo: '✉️',
      status: 'coming_soon',
      category: 'Comunicaciones',
    },
    {
      id: 'dgii',
      name: 'DGII (República Dominicana)',
      description: 'Generación y envío de comprobantes fiscales electrónicos.',
      logo: '🇩🇴',
      status: 'connected',
      category: 'Facturación Electrónica',
    },
    {
      id: 'sat',
      name: 'SAT (México)',
      description: 'Generación de CFDI para el mercado mexicano.',
      logo: '🇲🇽',
      status: 'coming_soon',
      category: 'Facturación Electrónica',
    },
  ];

  get categories(): string[] {
    return [...new Set(this.integrations.map(i => i.category))];
  }

  getByCategory(category: string): Integration[] {
    return this.integrations.filter(i => i.category === category);
  }

  getStatusLabel(status: string): string {
    return { connected: 'Conectado', available: 'Disponible', coming_soon: 'Próximamente' }[status] ?? status;
  }

  getStatusClass(status: string): string {
    return {
      connected: 'bg-green-100 text-green-800',
      available: 'bg-blue-100 text-blue-800',
      coming_soon: 'bg-gray-100 text-gray-600',
    }[status] ?? 'bg-gray-100 text-gray-600';
  }
}
```

- [ ] **Step 2: Compilar**

```bash
npx tsc --noEmit -p apps/core/client-web/tsconfig.app.json 2>&1 | grep "integrations" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add apps/core/client-web/src/app/features/settings/system/integrations/integrations.page.ts
git commit -m "feat(settings): implementar IntegrationSettingsPage con estado de integraciones"
```

---

## Task 20: Verificación final — compilación y checklist

**Files:**
- Review: Todos los archivos modificados

- [ ] **Step 1: Compilar backend completo**

```bash
npx tsc --noEmit -p apps/backend/api/tsconfig.app.json 2>&1 | grep -v "node_modules" | head -40
```

Esperado: Sin errores de TypeScript

- [ ] **Step 2: Compilar frontend completo**

```bash
npx tsc --noEmit -p apps/core/client-web/tsconfig.app.json 2>&1 | grep -v "node_modules" | head -40
```

Esperado: Sin errores de TypeScript

- [ ] **Step 3: Verificar checklist del audit**

Verificar cada ítem del checklist de "listo para continuar a Prioridad 2":

```
✅ Bug de permisos dot vs colon corregido (Task 1)
✅ UnauthorizedException importada en auth.controller.ts (Task 3)
✅ IDOR en GET /users/:id corregido (Task 2)
✅ WebSocket CORS dinámico (Task 8)
✅ roles.controller.ts con guards de permisos (Task 6)
✅ Audit log filtrado por organización (Task 7)
✅ Secret 2FA sin fallback hardcodeado (Task 4)
✅ Logout revoca refresh tokens en DB (Task 5)
✅ Webhook Stripe con raw body (Task 9)
✅ URLs correctas en AuthService frontend (Task 11)
✅ BillingPage muestra datos reales (Task 12)
✅ Al menos 3 páginas de settings adicionales funcionales (Tasks 14-19)
✅ SSL con rejectUnauthorized: true en producción (Task 10)
⬜ Migraciones TypeORM generadas (pendiente - requiere acceso a BD)
⬜ Suite de tests mínima en CI (pendiente - requiere trabajo adicional)
```

- [ ] **Step 4: Commit final de verificación**

```bash
git add .
git commit -m "chore: verificación de completitud P1 — todos los fixes críticos aplicados"
```

---

## Notas de implementación

### Sobre las llamadas a `AuditTrailService.record()`
La firma cambió en Task 7: ahora requiere `organizationId` como segundo parámetro. Al ejecutar Task 7, ejecutar el siguiente grep para encontrar TODOS los callers y actualizar:

```bash
grep -rn "\.record(" apps/backend/api/src/app/audit/ --include="*.ts"
grep -rn "auditTrailService" apps/backend/api/src --include="*.ts" | grep -v spec
```

### Sobre las migraciones TypeORM
La adición de `organizationId` a `AuditLog` (Task 7) requiere una migración. Si `DB_SYNCHRONIZE=true` en desarrollo, TypeORM la aplica automáticamente. En staging/producción, generar con:
```bash
npx typeorm migration:generate -d apps/backend/api/src/app/database/data-source.ts apps/backend/api/src/app/database/migrations/AddOrgIdToAuditLog
```

### Sobre el paquete `cookie` en el backend
El paquete `cookie` es una dependencia transitiva de `socket.io`. Puede ser necesario agregarlo como dependencia directa:
```bash
npm install cookie
npm install -D @types/cookie
```
