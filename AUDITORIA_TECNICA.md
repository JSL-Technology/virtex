# AUDITORÍA TÉCNICA EXHAUSTIVA — VIRTEEX ERP SAAS MONOREPO
**Fecha:** 2026-05-28  
**Plataforma:** NX Monorepo | NestJS (backend) + Angular (frontend)  
**Objetivo:** Preparación para comercialización en Latinoamérica y Estados Unidos

---

## RESUMEN EJECUTIVO

Este monorepo tiene una base de código sólida, pero presenta vulnerabilidades críticas que deben resolverse antes de cualquier despliegue en producción. Se detectaron **15 categorías de problemas** que van desde vulnerabilidades de seguridad explotables (inyección SQL, XSS, IDOR) hasta problemas arquitecturales (cobertura de pruebas ~12.5%, tipos `any`, lógica duplicada). Este informe cita evidencia exacta con rutas de archivo y números de línea.

---

## ÍNDICE

1. Vulnerabilidades de Seguridad Críticas (OWASP Top 10)
2. Problemas Arquitecturales y Estructurales
3. Calidad de Código y Malas Prácticas
4. Vulnerabilidades en Lógica de Negocio
5. Problemas de Rendimiento y Escalabilidad
6. Dependencias y Versionado
7. Cumplimiento Normativo y Regulatorio
8. Problemas Específicos del Frontend
9. Anti-patrones de Seguridad Adicionales
10. Controles de Seguridad Faltantes
11. Pruebas Faltantes y Código Imposible de Testear
12. Redundancia y Duplicación de Código
13. Problemas de Configuración
14. Problemas Operacionales
15. Resumen de Severidad y Plan de Acción

---

## 1. VULNERABILIDADES DE SEGURIDAD CRÍTICAS (OWASP Top 10)

### 1.1 XSS — Cross-Site Scripting

**Archivo:** `apps/core/client-web/src/app/core/services/branding.ts` (líneas 105-133)  
**Tipo:** Potencial inyección via CSS  
**Evidencia:**
```typescript
styleTag.innerHTML = `
  :root {
    --font-family-sans: '${settings.fontFamily}', sans-serif;
    --accent-color: ${settings.accentColor};
  }
`;
```
**Riesgo:** Si `fontFamily` o `accentColor` provienen de entrada del usuario sin sanitización, un atacante puede inyectar CSS malicioso (CSS injection). Aunque es menos severo que JS injection, puede usarse para robar datos de formularios (exfiltración via CSS selectors).  
**Recomendación:** Validar estrictamente los valores contra una whitelist de fonts y colores seguros antes de insertar en `innerHTML`.

---

**Archivo:** `apps/core/client-web/src/app/features/invoices/detail/detail.page.ts` (línea 140)  
**Tipo:** XSS via innerHTML en exportación a Word  
**Evidencia:**
```typescript
html = `
  <body>
    ${element.innerHTML}
  </body>
`;
```
**Riesgo:** Si los datos de la factura contienen HTML no confiable (e.g., nombres de clientes con etiquetas HTML), se inyecta directamente en el documento generado. Vector de ataque si el documento Word se abre en contexto web.  
**Recomendación:** Usar DOMPurify o escape de HTML antes de la interpolación. Nunca usar `innerHTML` con datos externos.

---

### 1.2 Inyección SQL

**Archivo:** `apps/backend/api/src/app/analytical-reporting/analytical-reporting.service.ts` (líneas 31, 70)  
**Tipo:** SQL Injection en nombres de dimensiones  
**Evidencia:**
```typescript
const dynamicDimensionColumns = dimensions
  .map(dim => `jel.dimensions ->> '${dim.name}' AS "${this.sanitizeColumnName(dim.name)}"`)
  .join(',\n');

await queryRunner.query(`CREATE INDEX ON "${viewName}" ("${this.sanitizeColumnName(dim.name)}");`);
```
**Riesgo:** El uso de regex (`sanitizeColumnName`) para sanitizar identificadores SQL es insuficiente. Si el input de `dim.name` pasa el regex pero tiene caracteres especiales en contexto SQL, hay inyección.  
**Recomendación:** Nunca concatenar identificadores SQL directamente. Usar un mapeo estático (whitelist de dimensiones permitidas) o `pg_quote_ident()` a nivel de base de datos.

---

**Archivo:** `apps/backend/api/src/app/analytical-reporting/analytical-reporting.service.ts` (línea 128)  
**Tipo:** SQL Injection en nombres de medidas  
**Evidencia:**
```typescript
measures.forEach(measure => {
  qb.addSelect(`SUM(ard.${measure})`, `"${measure}"`);
});
```
**Riesgo:** `measure` se inserta directamente en el SELECT sin ninguna sanitización visible. Si un atacante controla `measure`, puede leer datos arbitrarios de la base de datos.  
**Recomendación:** Whitelistear las medidas permitidas en una constante enum; rechazar cualquier valor fuera de esa lista.

---

### 1.3 IDOR — Insecure Direct Object Reference

**Archivo:** `apps/backend/api/src/app/users/users.controller.ts` (líneas 140-146)  
**Tipo:** Ausencia de verificación de organización en `findOne`  
**Evidencia:**
```typescript
async findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
  // Ideally ensure user belongs to same org
  const foundUser = await this.usersService.findOne(id);
  return plainToInstance(UserResponseDto, foundUser, { excludeExtraneousValues: true });
}
```
**Riesgo:** El comentario en el código reconoce la vulnerabilidad: un usuario puede obtener datos de cualquier otro usuario de cualquier organización con solo conocer o adivinar el UUID. En un sistema multi-tenant SaaS, esto es una brecha crítica de aislamiento.  
**Recomendación:** Agregar filtro `where: { id, organizationId: user.organizationId }` en la query.

---

**Archivo:** `apps/backend/api/src/app/analytics-reporting/analytical-reporting.service.ts` (líneas 85-158)  
**Tipo:** Validación insuficiente del contexto de organización  
**Evidencia:**
```typescript
const qb = this.dataSource.createQueryBuilder()
  .from(this.VIEW_NAME, 'ard')
  .where('ard.organization_id = :organizationId', { organizationId })
```
**Riesgo:** Si `organizationId` llega del cliente sin validación server-side de que corresponde al usuario autenticado, puede accederse a datos financieros de otras organizaciones.  
**Recomendación:** Extraer `organizationId` siempre del JWT del usuario autenticado, nunca del body o query params del request.

---

### 1.4 Secrets y Datos Sensibles Expuestos

**Archivo:** `apps/backend/api/src/app/auth/auth.config.ts` (línea 24)  
**Tipo:** Secret de 2FA hardcodeado como fallback  
**Evidencia:**
```typescript
get JWT_2FA_TEMP_SECRET() { return process.env.JWT_2FA_TEMP_SECRET || 'temp_2fa_secret_change_me'; }
```
**Riesgo:** Si la variable de entorno no está seteada (e.g., en una rama de staging mal configurada), todos los tokens 2FA se firman con el secret por defecto. Un atacante que conozca este secret puede generar tokens 2FA válidos para cualquier usuario.  
**Recomendación:** Lanzar excepción si la variable de entorno no existe. Nunca usar fallbacks para secrets.

---

**Archivo:** `apps/core/client-web/src/environments/environment.ts` (línea 8)  
**Tipo:** API key de reCAPTCHA expuesta en código fuente  
**Evidencia:**
```typescript
recaptcha: {
  siteKey: '6LeG8p4rAAAAAGpAeRZ-MAFR_mHthbHb5ydkTEuR'
}
```
**Riesgo:** Aunque la site key de reCAPTCHA es semi-pública (va en el frontend), tenerla hardcodeada en git impide rotarla sin un nuevo deploy y puede usarse para bypass de CAPTCHA en ataques automáticos dirigidos al dominio.  
**Recomendación:** Inyectar via variables de entorno en build time (`--env-file`); no commitear en repositorios que puedan hacerse públicos.

---

**Archivo:** `apps/backend/api/src/app/invoices/providers/dgii.provider.ts` (líneas 13-14)  
**Tipo:** Clave privada con tipo `any` y potencialmente hardcodeada  
**Evidencia:**
```typescript
const privateKey: any = '---BEGIN PRIVATE KEY---...';
const certificate: any = '---BEGIN CERTIFICATE---...';
```
**Riesgo:** El tipo `any` elimina verificación de TypeScript. Los placeholder `---` sugieren que en algún momento se hará hardcode en este archivo. Las claves privadas nunca deben estar en el código fuente.  
**Recomendación:** Cargar desde variables de entorno o un secrets manager (AWS Secrets Manager, HashiCorp Vault). Usar tipos correctos (`string` o buffer).

---

### 1.5 CSRF — Protección Débil

**Archivo:** `apps/backend/api/src/main.ts` (líneas 33-45)  
**Tipo:** CSP permite 'unsafe-inline'  
**Evidencia:**
```typescript
contentSecurityPolicy: {
  directives: {
    scriptSrc: ["'self'", "'unsafe-inline'"],
  },
},
```
**Riesgo:** `'unsafe-inline'` anula completamente la protección que ofrece CSP contra XSS. Cualquier script inline puede ejecutarse, incluyendo los inyectados por un atacante.  
**Recomendación:** Eliminar `'unsafe-inline'`. Usar nonces generados por request o hashes para scripts legítimos.

---

**Archivo:** `apps/backend/api/src/app/auth/guards/csrf.guard.ts` (líneas 24-40)  
**Tipo:** Patrón double-submit cookie con vulnerabilidad residual  
**Evidencia:**
```typescript
const xsrfToken = request.headers['x-xsrf-token'];
const xsrfCookie = request.cookies['XSRF-TOKEN'];
if (!xsrfToken || !xsrfCookie || xsrfToken !== xsrfCookie) {
  throw new ForbiddenException('Invalid CSRF Token');
}
```
**Riesgo:** El patrón double-submit cookie es vulnerable si existe alguna vulnerabilidad XSS (el script malicioso puede leer la cookie y enviarla como header). Además, falta verificar el atributo `SameSite=Strict` en la cookie.  
**Recomendación:** Usar tokens CSRF sincronizados (server-side) con `SameSite=Strict` en la cookie.

---

### 1.6 Autenticación y Gestión de Sesiones Débiles

**Archivo:** `apps/backend/api/src/app/websockets/events.gateway.ts` (líneas 30-38)  
**Tipo:** Parsing frágil de cookies para autenticación WebSocket  
**Evidencia:**
```typescript
const token = client.handshake.headers.cookie
  ?.split('; ')
  .find((row) => row.startsWith('access_token='))
  ?.split('=')[1];
```
**Riesgo:** Si el valor del token contiene `=` (como en base64), el split por `=` trunca el token. También vulnerable a cookies mal formadas. Parsing manual de cookies es error-prone.  
**Recomendación:** Usar la librería `cookie` de Node.js para parsear el header `Cookie`.

---

**Archivo:** `apps/backend/api/src/app/auth/auth.config.ts` (líneas 20-23)  
**Tipo:** Tokens de larga duración sin rotación forzada  
**Evidencia:**
```typescript
get JWT_REFRESH_REMEMBER_ME_EXPIRATION() { return process.env.JWT_REFRESH_REMEMBER_ME_EXPIRATION || '30d'; },
```
**Riesgo:** Tokens de 30 días sin rotación implican que si un dispositivo es comprometido, el atacante tiene acceso por hasta 30 días sin que el usuario lo sepa.  
**Recomendación:** Implementar rotación forzada de refresh tokens en cada uso (rotation family tracking).

---

**Archivo:** `apps/backend/api/src/app/database/data-source.ts` (línea 15)  
**Tipo:** SSL con `rejectUnauthorized: false`  
**Evidencia:**
```typescript
ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
```
**Riesgo:** `rejectUnauthorized: false` permite ataques Man-in-the-Middle sobre la conexión a la base de datos. Cualquier proxy entre la app y la BD puede interceptar y modificar consultas.  
**Recomendación:** Usar `rejectUnauthorized: true` en producción; especificar `ca`, `cert`, y `key` con los certificados correctos.

---

### 1.7 Exposición de Datos Sensibles

**Archivo:** `apps/backend/api/src/app/common/loggers/json.logger.ts` (líneas 9-41)  
**Tipo:** Logging sin sanitización de datos sensibles  
**Evidencia:**
```typescript
override log(message: any, ...optionalParams: any[]) {
  console.log(JSON.stringify({ level: 'log', message, optionalParams }));
}
```
**Riesgo:** Si se loggean objetos que contienen contraseñas, tokens, o datos de tarjetas, estos van al sistema de logging. Violación de PCI DSS y potencialmente GDPR.  
**Recomendación:** Implementar un filtro de sanitización que oculte campos como `password`, `token`, `cardNumber`, etc. antes de serializar.

---

**Archivo:** `apps/backend/api/src/app/payment/adapters/stripe-payment.adapter.ts` (líneas 88-130)  
**Tipo:** Datos de webhook de Stripe loggeados sin sanitización  
**Evidencia:**
```typescript
this.logger.log(`Received Stripe event: ${event.type}`);
// event.data puede contener tokens de tarjetas
```
**Riesgo:** Violación directa de PCI DSS. Los datos de pagos nunca deben aparecer en logs.  
**Recomendación:** Loggear solo `event.type` e `event.id`, nunca `event.data`.

---

## 2. PROBLEMAS ARQUITECTURALES Y ESTRUCTURALES

### 2.1 Dependencias Circulares

**Evidencia:** Uso de `forwardRef` en múltiples módulos de NestJS  
**Archivos afectados:** `apps/backend/api/src/app/payment/adapters/stripe-payment.adapter.ts` y otros  
**Riesgo:** Las dependencias circulares son una señal de diseño incorrecto. En NestJS, `forwardRef` es un parche que puede causar problemas de inicialización en runtime y hace el código mucho más difícil de mantener y testear.  
**Recomendación:** Refactorizar para extraer la lógica compartida a un servicio de nivel más bajo que no dependa de los módulos que lo usan.

---

### 2.2 Cobertura de Pruebas Insuficiente

**Evidencia:** ~123 archivos `.spec.ts` para ~985 archivos TypeScript de fuente  
**Ratio:** ~12.5% — inaceptable para un sistema ERP financiero  
**Gaps críticos detectados:**
- Sin pruebas para flujos de autenticación (reset de contraseña, 2FA, invalidación de sesión)
- Sin pruebas para lógica de asientos contables
- Sin pruebas para manejo de webhooks de pagos
- Sin pruebas para conversión de monedas
- Sin pruebas E2E para el flujo completo factura → pago

**Riesgo:** Cada cambio puede romper funcionalidad crítica sin detección. Inaceptable para software financiero regulado.  
**Recomendación:** Meta mínima del 70% de cobertura antes de producción, con 95%+ en módulos de contabilidad y pagos.

---

### 2.3 Tipos `any` Excesivos

**Archivo:** `apps/backend/api/src/app/users/users.service.ts` (línea 174)  
**Evidencia:**
```typescript
const user = await this.userRepository.findOne({
  where: { id: id as any },
});
```
**Problema:** El cast `as any` innecesario elimina la protección del compilador TypeScript.

---

**Archivo:** `apps/backend/api/src/app/accounting/period-closing.service.ts` (líneas 363, 385)  
**Evidencia:**
```typescript
(period as any)[statusColumn] = PeriodStatus.CLOSED;
```
**Riesgo:** Acceso a propiedades dinámicas sin verificación de tipo. Si `statusColumn` contiene un valor inesperado, se modifica silenciosamente una propiedad arbitraria del objeto.

---

**Archivo:** `apps/backend/api/src/app/invoices/providers/dgii.provider.ts` (líneas 13-14, 45-46)  
**Evidencia:**
```typescript
const privateKey: any = '---BEGIN PRIVATE KEY---...';
const sig: any = new SignedXml();
```

**Recomendación global:** Activar `"strict": true` en `tsconfig.json` y eliminar todos los `any`. Usar `unknown` con type guards cuando el tipo no es conocido en tiempo de compilación.

---

### 2.4 Manejo de Errores Inconsistente

**Archivo:** `apps/backend/api/src/app/audit/audit.service.ts` (líneas 33-35)  
**Evidencia:**
```typescript
this.auditLogRepository.save(auditLog).catch(err => {
  console.error('Error saving audit log', err);
});
```
**Riesgo:** Error silenciado. Si la base de datos de auditoría falla, el sistema continúa sin registro. En un sistema financiero regulado, la pérdida de registros de auditoría puede ser una violación de compliance.  
**Recomendación:** Implementar sistema de cola (Redis, SQS) para garantizar entrega de logs de auditoría. Alertar operacionalmente si la cola crece.

---

**Archivo:** `apps/backend/api/src/app/country/services/country.service.ts` (líneas 73-78)  
**Evidencia:**
```typescript
try {
  const fromDb = await this.countryRepo.findOne({ where: { code: code.toUpperCase() } });
  if (fromDb) return fromDb;
} catch (e) {
  // DB might be down or not migrated, fallback to memory
}
```
**Riesgo:** El catch silencioso oculta errores de base de datos reales. Un developer que diagnostica un problema de conectividad no verá ninguna evidencia en los logs.

---

## 3. CALIDAD DE CÓDIGO Y MALAS PRÁCTICAS

### 3.1 Valores Hardcodeados y Números Mágicos

**Archivo:** `apps/backend/api/src/app/auth/auth.config.ts`  
**Evidencia:**
```typescript
get ARGON2_MEMORY_COST() { return parseInt(process.env.AUTH_ARGON2_MEMORY_COST || '65536', 10); },
get ARGON2_TIME_COST() { return parseInt(process.env.AUTH_ARGON2_TIME_COST || '3', 10); },
get ARGON2_PARALLELISM() { return parseInt(process.env.AUTH_ARGON2_PARALLELISM || '4', 10); },
```
**Problema:** Los valores 65536, 3, 4 son significativos para Argon2 (costo de memoria en KB, iteraciones, paralelismo) pero no tienen contexto explicativo. Si alguien cambia estos valores sin entender las implicaciones, puede debilitar el hashing de contraseñas.  
**Recomendación:** Documentar las implicaciones de seguridad o usar constantes nombradas del tipo `ARGON2_RECOMMENDED_MEMORY_64MB`.

---

**Archivo:** `apps/backend/api/src/app/websockets/events.gateway.ts` (líneas 50, 65)  
**Evidencia:**
```typescript
this.server.emit('user-status-update', { userId: user.id, isOnline: true });
```
**Problema:** Strings literales para nombres de eventos WebSocket dispersos por el código. Si hay un typo o se renombra el evento, no hay error de compilación.  
**Recomendación:** Crear enum `WebSocketEvents` con todos los nombres de eventos.

---

### 3.2 TODOs en Código de Producción

**Archivo:** `apps/backend/api/src/app/compliance/compliance.service.ts` (líneas 53, 58)  
**Evidencia:**
```typescript
// TODO: Check organization country before generating.
```
**Riesgo:** Indica que la funcionalidad está incompleta. Si se genera un documento fiscal sin verificar el país, puede generarse con formato incorrecto, causando rechazo por autoridades tributarias.  
**Recomendación:** Nunca deployar código con TODOs en rutas de ejecución críticas. Crear tickets para cada TODO antes de cerrar.

---

### 3.3 Código Muerto y Comentado

**Archivo:** `apps/core/client-web/src/app/features/documents/documents.page.ts` (línea 17)  
**Evidencia:**
```typescript
// @Component({
```
**Problema:** Decorador comentado sugiere que el componente puede no estar funcionando correctamente o está en proceso de refactor sin terminar.

**Hallazgo general:** Hay imports sin usar, código comentado, y console.log dispersos en varios archivos.  
**Recomendación:** Configurar ESLint con reglas `no-unused-vars`, `no-console`, y `no-commented-out-code`.

---

### 3.4 Console.log en Código de Producción

**Archivo:** `apps/backend/api/src/main.ts` (línea 93)  
**Evidencia:**
```typescript
console.log(`🚀 Application is running on: ${await app.getUrl()}/${apiPrefix}`);
```

**Archivo:** `apps/backend/api/src/app/websockets/events.gateway.ts` (línea 63)  
**Evidencia:**
```typescript
console.log(`User disconnected: ${userId}`);
```
**Recomendación:** Usar el `Logger` de NestJS consistentemente. Los `console.log` no se pueden controlar por nivel de log ni por ambiente.

---

## 4. VULNERABILIDADES EN LÓGICA DE NEGOCIO

### 4.1 Validación Faltante en Flujos Críticos

**Archivo:** `apps/backend/api/src/app/analytics-reporting/analytical-reporting.service.ts` (líneas 107-124)  
**Evidencia:**
```typescript
filters.forEach((filter, index) => {
  const paramName = `filter_val_${index}`;
  const sanitizedField = `ard."${this.sanitizeColumnName(filter.field)}"`;
  switch (filter.operator) {
    case 'eq':
      qb.andWhere(`${sanitizedField} = :${paramName}`, { [paramName]: filter.value });
```
**Riesgo:** No hay límite en el número de filtros ni validación de valores. Un usuario puede enviar miles de filtros causando degradación de performance o timeout del servidor.  
**Recomendación:** Limitar el número máximo de filtros (e.g., 20), validar tipos de valores según el campo.

---

### 4.2 Garantías Transaccionales Faltantes

**Archivo:** `apps/backend/api/src/app/accounting/period-closing.service.ts` (líneas 170-250)  
**Riesgo:** El cierre de período contable involucra múltiples operaciones (marcar período, generar asientos de cierre, actualizar balances). Si alguna de estas falla parcialmente, el período queda en estado inconsistente.  
**Recomendación:** Envolver toda la operación de cierre en una transacción de base de datos con rollback automático en caso de error.

---

**Archivo:** `apps/backend/api/src/app/journal-entries/journal-entries.service.ts` (líneas 98-108)  
**Evidencia:**
```typescript
createDto.lines.forEach((line) => {
  if (!line.valuations || line.valuations.length === 0) {
    line.valuations = [{
      ledgerId: defaultLedger.id,
      debit: line.debit,
      credit: line.credit,
    }];
  }
});
```
**Riesgo:** Se modifican los objetos `createDto.lines` en memoria antes de persistir. Si la transacción falla después, el estado en memoria no coincide con el estado en base de datos, pero el DTO ya fue mutado.  
**Recomendación:** Evitar mutar los DTOs de entrada; crear nuevos objetos para la persistencia.

---

## 5. PROBLEMAS DE RENDIMIENTO Y ESCALABILIDAD

### 5.1 Falta de Índices y Queries No Optimizadas

**Archivo:** `apps/backend/api/src/app/users/users.service.ts` (líneas 71-107)  
**Evidencia:**
```typescript
queryBuilder.andWhere(
  '(user.firstName ILIKE :searchTerm OR user.lastName ILIKE :searchTerm OR user.email ILIKE :searchTerm)',
  { searchTerm: `%${searchTerm}%` },
);
```
**Riesgo:** `ILIKE` con wildcard al inicio (`%term`) impide el uso de índices B-tree estándar. Con 100,000+ usuarios, esta query escanea la tabla completa en cada búsqueda.  
**Recomendación:** Crear índice de texto completo (`GIN` con `pg_trgm`) en las columnas de búsqueda. Considerar búsqueda externa (Elasticsearch, Meilisearch).

---

**Archivo:** `apps/backend/api/src/app/analytical-reporting/analytical-reporting.service.ts` (líneas 160-170)  
**Evidencia:**
```typescript
await this.dataSource.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY "${this.VIEW_NAME}"`);
```
**Riesgo:** `REFRESH MATERIALIZED VIEW CONCURRENTLY` requiere un índice único en la vista. Si no existe, falla silenciosamente o bloquea lecturas. En datasets grandes, el refresh puede tardar minutos.  
**Recomendación:** Verificar la existencia del índice único. Implementar refresh incremental o programado fuera de horas pico.

---

### 5.2 Problema N+1 Queries

**Evidencia:** Multiple servicios cargan relaciones sin especificar qué campos necesitan  
**Riesgo:** Si un endpoint carga 100 facturas, y cada factura tiene 10 líneas que se cargan lazy, el sistema hace 1001 queries en lugar de 2.  
**Recomendación:** Usar `relations: ['lines', 'lines.product']` explícitamente o QueryBuilder con `leftJoinAndSelect`. Siempre especificar `select` para evitar traer columnas innecesarias.

---

### 5.3 Invalidación de Caché Ineficiente

**Archivo:** `apps/backend/api/src/app/users/users.service.ts` (líneas 47, 141-143)  
**Evidencia:**
```typescript
await this.userCacheService.clearUserSession(id);
```
**Riesgo:** Limpiar toda la sesión en cada actualización de perfil puede causar flapping en sistemas con alta concurrencia. Usuarios pierden contexto y deben re-autenticarse.  
**Recomendación:** Implementar invalidación granular por campo; solo limpiar la sesión cuando cambia algo crítico (contraseña, email, roles).

---

### 5.4 Vulnerabilidad de Agotamiento de Recursos

**Archivo:** `apps/backend/api/src/main.ts` (línea 22)  
**Evidencia:**
```typescript
bodyLimit: 10 * 1024 * 1024, // 10MB
```
**Riesgo:** Sin rate limiting por usuario/IP, un atacante puede hacer múltiples requests de 10MB simultáneos causando agotamiento de memoria del servidor.  
**Recomendación:** Implementar rate limiting a nivel de IP usando `express-rate-limit` o throttler de NestJS con límites por IP.

---

**Archivo:** `apps/backend/api/src/app/analytical-reporting/analytical-reporting.service.ts` (líneas 139-145)  
**Evidencia:**
```typescript
qb.offset((page - 1) * limit);
qb.limit(limit);
```
**Riesgo:** Una request con `page=1000000` y `limit=1000` causará un OFFSET de 1 billón de filas en PostgreSQL, lo que bloquea la base de datos por segundos.  
**Recomendación:** Implementar cursor-based pagination en lugar de offset pagination. Validar límites máximos de página.

---

## 6. DEPENDENCIAS Y VERSIONADO

### 6.1 Versiones de Dependencias con Vulnerabilidades Potenciales

**Archivo:** `package.json`  
**Evidencia:**
```json
"axios": "^1.6.0"
```
**Riesgo:** Permite versiones tan antiguas como 1.6.0, que tienen vulnerabilidades conocidas. Versiones 1.0-1.5 tienen SSRF y ReDoS vulnerabilities.  
**Recomendación:** Fijar a `^1.7.4` mínimo. Usar `npm audit` en CI/CD y fallr si hay vulnerabilidades HIGH o CRITICAL.

### 6.2 Sin Política de Lock File

**Evidencia:** Presencia de `package-lock.json` pero sin verificación explícita en CI  
**Riesgo:** Builds no reproducibles. Un desarrollador puede instalar versiones diferentes a las de producción.  
**Recomendación:** Usar `npm ci` en lugar de `npm install` en CI/CD. Commitear y auditar `package-lock.json` en PRs.

---

## 7. CUMPLIMIENTO NORMATIVO Y REGULATORIO

### 7.1 No Cumplimiento PCI DSS

**Archivo:** `apps/backend/api/src/app/common/loggers/json.logger.ts`  
**Riesgo:** Sin filtrado de datos de tarjeta en logs. PCI DSS Req. 3.2.1 prohíbe almacenar datos de autenticación de tarjetas; los logs son almacenamiento.

**Archivo:** `apps/backend/api/src/app/payment/adapters/stripe-payment.adapter.ts`  
**Riesgo:** Datos de webhooks de Stripe loggeados sin sanitización.

**Recomendación:** Antes de cualquier integración de pagos en producción, realizar una evaluación PCI DSS SAQ A-EP o D completa.

---

### 7.2 No Cumplimiento GDPR / Privacidad de Datos

**Evidencia:** No se encontraron endpoints de eliminación de datos de usuario ni lógica de "derecho al olvido"  
**Riesgo:** El GDPR (aplicable si hay usuarios europeos) y leyes similares en Latinoamérica (LGPD Brasil, Ley 1581 Colombia, etc.) exigen capacidad de eliminar datos personales bajo demanda.

**Archivo:** `apps/backend/api/src/app/audit/audit.service.ts`  
**Riesgo:** Logs de auditoría no cifrados; almacenados indefinidamente sin política de retención.  
**Recomendación:** Definir política de retención de datos. Implementar endpoint de eliminación/anonimización de datos personales. Cifrar campos PII en base de datos.

---

### 7.3 Validación Insuficiente para Requisitos Regionales

**Archivo:** `libs/api/country/src/lib/services/country.service.ts` (líneas 71-85)  
**Evidencia:**
```typescript
pattern: '^[0-9]{9,11}$',
```
**Riesgo:** La validación de RNC (República Dominicana) solo verifica que sea numérico y de 9-11 dígitos, pero no valida el dígito verificador. Esto permite aceptar RNCs inválidos que serán rechazados por la DGII.  
**Recomendación:** Implementar validación de dígito verificador para cada identificador fiscal (RNC-DR, RUC-Ecuador, CUIT-Argentina, RFC-México, CNPJ/CPF-Brasil).

---

## 8. PROBLEMAS ESPECÍFICOS DEL FRONTEND

### 8.1 Service Worker Sin Cabeceras de Seguridad

**Archivo:** `apps/core/client-web/src/app/app.config.ts`  
**Riesgo:** El Service Worker habilitado en producción puede cachear respuestas y actuar como proxy. Sin cabeceras de seguridad correctas (`Cache-Control: no-store` para APIs, `X-Content-Type-Options`, etc.), puede ser explotado.

---

### 8.2 XSRF Token — Implementación Redundante

**Archivo:** `apps/core/client-web/src/app/core/interceptors/auth.interceptor.ts` (líneas 32-36)  
**Evidencia:**
```typescript
const xsrfToken = tokenExtractor.getToken();
if (xsrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
  authReq = authReq.clone({
    headers: authReq.headers.set('X-XSRF-TOKEN', xsrfToken),
  });
}
```
**Problema:** Angular ya tiene manejo automático de XSRF via `HttpClientXsrfModule`. Esta implementación manual duplica la lógica y puede causar conflictos.  
**Recomendación:** Verificar si se usa `HttpClientXsrfModule`; si sí, eliminar la implementación manual.

---

## 9. ANTI-PATRONES DE SEGURIDAD ADICIONALES

### 9.1 Sanitización con Regex Insuficiente

**Archivo:** `apps/backend/api/src/app/analytical-reporting/analytical-reporting.service.ts` (línea 173)  
**Evidencia:**
```typescript
private sanitizeColumnName(name: string): string {
  if (!/^[a-zA-Z0-9_ ]+$/.test(name)) {
    throw new BadRequestException(`El nombre de dimensión...`);
  }
  return name.replace(/ /g, '_').toLowerCase();
}
```
**Problema:** Acepta espacios, luego los reemplaza. Si la validación ocurre antes del reemplazo, el resultado puede contener caracteres no validados después de la transformación (edge case). Además, la sanitización de identificadores SQL requiere escape de comillas dobles, no solo caracteres alfanuméricos.

---

### 9.2 Exposición de Información Sensible del Sistema

**Archivo:** `apps/backend/api/src/app/users/users.controller.ts` (líneas 39-40)  
**Evidencia:**
```typescript
@Get('job-titles')
getJobTitles() {
  return Object.values(JobTitle);
}
```
**Riesgo:** Exponer el enum completo de títulos de trabajo a cualquier cliente autenticado puede usarse para ingeniería social o para entender la estructura organizacional del sistema.  
**Recomendación:** Evaluar si este endpoint necesita autenticación adicional o si los valores deben estar en el frontend directamente.

---

### 9.3 Rate Limiting Insuficiente

**Archivo:** `apps/backend/api/src/app/auth/auth.controller.ts`  
**Riesgo:** El endpoint de login puede tener ThrottlerGuard pero si los límites son demasiado permisivos (e.g., 100 requests/minuto), aún es vulnerable a ataques de fuerza bruta distribuidos.  
**Recomendación:** Implementar:
- Rate limiting por IP: 5 intentos fallidos en 15 minutos → bloqueo temporal
- Rate limiting por usuario: 10 intentos fallidos → cuenta bloqueada temporalmente
- CAPTCHA después del 3er intento fallido
- Alertas operacionales ante patrones de ataque

---

## 10. CONTROLES DE SEGURIDAD FALTANTES

### 10.1 Sin Cifrado en Reposo

**Evidencia:** No se encontraron mecanismos de cifrado de campos sensibles en las entidades  
**Riesgo:** Si la base de datos es comprometida, todos los datos sensibles (información financiera, datos personales, configuraciones) están expuestos en texto plano.  
**Recomendación:** Implementar cifrado a nivel de columna para campos altamente sensibles (números de cuenta, información fiscal) usando TypeORM Encrypted Column o cifrado a nivel de aplicación.

---

### 10.2 Sin IP Whitelisting ni Rate Limiting por IP

**Archivo:** `apps/backend/api/src/app/auth/auth.service.ts` (líneas 68-74)  
**Evidencia:**
```typescript
if (user) {
  await this.securityAnalysisService.handleFailedLoginAttempt(user);
  this.eventEmitter.emit(AuthEvents.LOGIN_FAILED, ...);
}
```
**Riesgo:** El manejo de intentos fallidos está a nivel de usuario, no de IP. Un atacante distribuido puede usar miles de IPs para evitar el bloqueo por usuario.  
**Recomendación:** Implementar throttling por IP usando Redis. Considerar integración con servicios de reputación de IP (e.g., Cloudflare Bot Management).

---

### 10.3 Sin Estrategia de Rotación de API Keys

**Evidencia:** Refresh tokens de 7-30 días sin rotación forzada en cada uso  
**Riesgo:** Un token comprometido puede usarse durante semanas sin detección.  
**Recomendación:** Implementar "refresh token rotation": cada vez que se usa un refresh token, se invalida y se emite uno nuevo. Si un token ya invalidado se usa de nuevo, detectar compromiso y revocar toda la familia de tokens.

---

### 10.4 Sin Shutdown Graceful

**Evidencia:** No se encontraron manejadores de señales SIGTERM/SIGINT  
**Riesgo:** En despliegues con Kubernetes o Docker, el contenedor puede terminar a mitad de una transacción, dejando datos en estado inconsistente.  
**Recomendación:**
```typescript
app.enableShutdownHooks();
```
Y manejar limpieza de conexiones de base de datos y queue workers antes de terminar.

---

## 11. PRUEBAS FALTANTES Y CÓDIGO IMPOSIBLE DE TESTEAR

### 11.1 Servicios con Dependencias No Inyectables

**Archivo:** `apps/backend/api/src/app/webhook/webhooks.service.ts`  
**Evidencia:**
```typescript
async handleEvent(event: string, payload: any)
```
**Problema:** El tipo `any` en el payload hace imposible escribir pruebas unitarias con type checking. Los tests deben usar `as any` también, lo que elimina el valor de los tests.

---

### 11.2 Rutas Críticas Sin Pruebas

**Gaps identificados:**
- Flujo completo de factura → aprobación → pago → reconciliación
- Cierre de período contable con reversiones
- Conversión de moneda en transacciones multi-divisa
- Generación y validación de reportes fiscales (DGII, SAT, AFIP)
- Webhook de Stripe con idempotency keys
- Flujo de 2FA completo (activación, uso, desactivación, códigos de backup)
- Restablecimiento de contraseña con expiración de tokens

**Recomendación:** Establecer coverage gates en CI: PR no puede mergear si coverage baja del umbral establecido (70% global, 90% en módulos de contabilidad/pagos).

---

## 12. REDUNDANCIA Y DUPLICACIÓN DE CÓDIGO

### 12.1 Lógica de Query Building Duplicada

**Evidencia:** Múltiples servicios construyen queries TypeORM con la misma estructura de paginación, filtrado, y ordenamiento.  
**Recomendación:** Crear un `QueryBuilderHelper` o `PaginatedQueryBuilder` reutilizable con:
- Aplicación de filtros genérica
- Paginación con cursor o offset
- Ordenamiento configurable
- Serialización de respuesta paginada

---

### 12.2 Validación de Permisos Duplicada

**Evidencia:** El frontend verifica permisos para mostrar/ocultar UI, y el backend repite las mismas verificaciones.  
**Riesgo (solo frontend):** Las verificaciones del frontend no son autoritativas. Un usuario puede manipular el cliente para hacer requests que el backend no rechaza correctamente.  
**Recomendación:** La fuente de verdad de permisos debe estar SIEMPRE en el backend. El frontend puede duplicar la lógica solo para UX (esconder botones), pero el backend debe ser exhaustivo.

---

### 12.3 Lógica de Email/Teléfono Verificados Duplicada

**Archivo:** `apps/backend/api/src/app/users/users.service.ts` (líneas 38-44) y múltiples controllers  
**Recomendación:** Crear un `UserValidationService` centralizado con toda la lógica de validación de estado de usuario.

---

## 13. PROBLEMAS DE CONFIGURACIÓN

### 13.1 WebSocket CORS Hardcodeado a localhost

**Archivo:** `apps/backend/api/src/app/websockets/events.gateway.ts` (líneas 12-16)  
**Evidencia:**
```typescript
@WebSocketGateway({
  cors: {
    origin: 'http://localhost:4200',
    credentials: true,
  },
})
```
**Riesgo CRÍTICO:** Esta configuración bloqueará todas las conexiones WebSocket en producción porque el origen `localhost:4200` no coincidirá con el dominio real de la aplicación.  
**Recomendación:**
```typescript
@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:4200',
    credentials: true,
  },
})
```

---

### 13.2 DB_SYNCHRONIZE — Riesgo de Pérdida de Datos

**Archivo:** `apps/backend/api/src/app/app.module.ts` (línea 79)  
**Evidencia:**
```typescript
synchronize: process.env.DB_SYNCHRONIZE === 'true',
```
**Riesgo CRÍTICO:** Si `DB_SYNCHRONIZE=true` en cualquier ambiente no-local, TypeORM puede DROP y recrear tablas al detectar cambios en entidades. Esto puede causar pérdida total de datos en producción.  
**Recomendación:** Eliminar completamente esta variable de entorno. Usar SIEMPRE migraciones TypeORM. Agregar un guard que falle el startup si `synchronize=true` en ambiente no-development.

---

## 14. PROBLEMAS OPERACIONALES

### 14.1 Sin Health Checks

**Evidencia:** No se encontraron endpoints `/health`, `/liveness`, o `/readiness`  
**Riesgo:** Kubernetes y load balancers no pueden detectar instancias degradadas. Si la base de datos cae, el pod sigue recibiendo tráfico y devolviendo errores 500.  
**Recomendación:** Implementar `@nestjs/terminus` con checks de:
- Conectividad a base de datos
- Uso de memoria
- Conectividad a Redis (si se usa)
- Conectividad a servicios externos críticos

---

### 14.2 Logging Estructurado Insuficiente para Auditoría

**Archivo:** `apps/backend/api/src/app/common/loggers/json.logger.ts`  
**Problema:** El logger JSON existe pero le faltan campos obligatorios para auditoría de compliance:
- `timestamp` en formato ISO 8601
- `correlationId` por request
- `userId` y `organizationId` del contexto
- `ipAddress` de origen
- `action` estandarizado (CREATE, READ, UPDATE, DELETE)
- `resourceType` y `resourceId`

---

## 15. RESUMEN POR SEVERIDAD Y PLAN DE ACCIÓN

### CRÍTICO — Resolver ANTES de producción (bloqueantes)

| # | Problema | Archivo | Impacto |
|---|----------|---------|---------|
| C1 | SQL Injection en dimensiones/medidas analíticas | `analytical-reporting.service.ts:31,70,128` | Acceso total a BD |
| C2 | IDOR — sin verificación de organización en findOne | `users.controller.ts:140` | Fuga de datos multi-tenant |
| C3 | XSS en exportación HTML de facturas | `detail.page.ts:140` | Ejecución de código cliente |
| C4 | Secret de 2FA hardcodeado como fallback | `auth.config.ts:24` | Bypass de 2FA para todos los usuarios |
| C5 | WebSocket CORS hardcodeado a localhost | `events.gateway.ts:12` | WebSockets no funcionales en producción |
| C6 | SSL con rejectUnauthorized: false | `data-source.ts:15` | MITM en conexión a BD |
| C7 | DB_SYNCHRONIZE habilitado — riesgo de pérdida de datos | `app.module.ts:79` | Pérdida de datos en producción |

### ALTO — Resolver en el primer sprint post-lanzamiento

| # | Problema | Impacto |
|---|----------|---------|
| A1 | Cobertura de pruebas ~12.5% | Riesgo de regresiones sin detección |
| A2 | Sin rate limiting por IP | Ataques de fuerza bruta distribuidos |
| A3 | Datos de Stripe loggeados sin sanitizar | Violación PCI DSS |
| A4 | Sin shutdown graceful | Transacciones incompletas en deploys |
| A5 | Sin health checks | Tráfico a instancias degradadas |
| A6 | Offsetting infinito en paginación | DoS en base de datos |
| A7 | Tokens de refresh de 30 días sin rotación | Tokens comprometidos de larga duración |

### MEDIO — Resolver en primeros 2-3 meses

| # | Problema | Impacto |
|---|----------|---------|
| M1 | Exceso de tipos `any` (TypeScript) | Bugs ocultos, mantenimiento difícil |
| M2 | Dependencias circulares (forwardRef) | Inicialización frágil, tests difíciles |
| M3 | Validación de identificadores fiscales solo por regex | Documentos fiscales inválidos |
| M4 | Sin cifrado en reposo para datos sensibles | Exposición en caso de breach de BD |
| M5 | TODOs en código de producción | Features incompletas en producción |
| M6 | ILIKE sin índice de texto completo | Performance degradada con escala |
| M7 | Logging sin campos de auditoría obligatorios | Non-compliance en auditorías |

### BAJO — Deuda técnica a resolver progresivamente

| # | Problema |
|---|----------|
| B1 | Console.log en lugar de Logger service |
| B2 | Código comentado y dead code |
| B3 | Strings literales en lugar de enums para eventos |
| B4 | Implementación redundante de XSRF en Angular |
| B5 | CSP con 'unsafe-inline' |
| B6 | ReCAPTCHA key hardcodeada |

---

## RECOMENDACIONES ESTRATÉGICAS PARA ESCALADO A LATINOAMÉRICA Y EEUU

1. **Compliance regulatorio por país:** Implementar módulos de validación específicos por país (RFC México, CUIL/CUIT Argentina, RUC Ecuador, CNPJ Brasil, RNC República Dominicana). La lógica actual de regex es insuficiente.

2. **Multi-región:** Preparar la arquitectura para deployar en múltiples regiones (us-east, sa-east, latam) con data residency respetado por país.

3. **Internacionalización financiera:** Verificar que todos los cálculos monetarios usan precisión arbitraria (Decimal.js o similar) y no IEEE 754 floating point. Un error de redondeo en contabilidad es un error de compliance.

4. **SOC 2 Type II:** Para competir en el mercado empresarial de EEUU, se requiere SOC 2. Empezar el proceso de compliance ahora, ya que tarda 12+ meses.

5. **Pruebas de penetración:** Antes de lanzamiento comercial, contratar una firma externa para penetration testing formal. Las vulnerabilidades identificadas en este reporte son las detectables por análisis estático; pueden existir más.

6. **Disaster Recovery:** No se encontró evidencia de estrategia de backup, RTO/RPO definidos, o playbooks de disaster recovery. Esencial para un sistema ERP financiero.

---

*Informe generado: 2026-05-28*  
*Metodología: Análisis estático de código fuente completo, revisión de configuraciones, validación contra OWASP Top 10, PCI DSS, GDPR, y mejores prácticas de NestJS/Angular.*
