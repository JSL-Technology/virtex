# Archivos y documentos (T13) — familia F2

> Auditoría 2026-10-31. Diagnóstico sin cambios en el repo. Tenants qa-a / qa-b. Archivos QA creados: `qa-f2-b.txt`, `QA-F2-evil.html` (qa-b), avatar PNG 1×1 de qa-a, doc en qa-a (borrado).

**Sin hallazgo crítico de seguridad**: un archivo de qa-b no es accesible desde qa-a (404 en ver/descargar/renombrar/borrar) ni sin sesión (los archivos subidos NO se sirven públicamente: 404 en `/uploads/...`, `/documents/...`, `/api/v1/uploads/...`).

## 1. Identificación
- Backend: `storage/` (4 archivos, 321 LOC, 0 specs: contrato abstracto + `LocalStorageStrategy` + `S3StorageStrategy`, selección por `STORAGE_DRIVER`), `documents/` (5 archivos, 772 LOC, 1 spec: árbol carpetas/archivos, 11 endpoints `/documents*`), `common/interceptors/fastify-file(s).interceptor.ts` (multipart, nombre aleatorio, extensión saneada, `allowedMimeTypes` opcional). Consumidores de storage: usuarios (avatar), branding (logo), producto (imágenes), asientos (adjuntos), CxP (captura de facturas), inbound-mail, ajustes de auditoría, documentos.
- Disco local: `apps/backend/api/public/uploads/<subPath>/<ts>-<rand>.<ext>`; clave por tenant `documents/<orgId>/…`.
- Frontend: `features/documents` (~446 LOC sin specs).
- Países: transversal. Núcleo para vender: medio (adjuntos y repositorio documental esperados en un ERP).

## 2. Estándar de referencia
- (a) Básico: almacenamiento privado por tenant, acceso sólo autorizado (URLs firmadas de vida corta o proxy), validación de tipo por contenido (magic bytes) y tamaño, nombres saneados, sin path traversal, antivirus, cuotas por plan, versionado de documentos, vinculación a registros, borrado consistente. Avanzado: OCR/indexación, retención legal, WORM para documentos fiscales, previsualización.
- (b) Invariantes: un objeto sólo se sirve a su tenant; nunca contenido activo (HTML/SVG) inline desde el dominio de la app; claves no derivadas del nombre del usuario.
- (c) Líderes: NetSuite File Cabinet (carpetas, permisos por rol, URLs internas/externas — confianza alta), Odoo Documents (workspaces, tags, OCR — confianza alta), AWS S3 + presigned URLs privadas como práctica de AWS SaaS Lens (confianza alta).
- (d) Construcción: contrato de storage con clave opaca; metadatos en BD con tenant; servicio de escaneo asíncrono; URLs generadas en lectura, nunca persistidas.

## 3. Resultado
- **Madurez: 52 (45–60, confianza media)** · **Preparación: 50 — Piloto controlado** (críticas cumplen; avatar/logo rotos y sin antivirus).
- Eje más débil: Autenticidad/completitud (avatar y logo no se ven) y robustez de storage.
- Críticos: 0. Altos: 2.

## 4. Ejes
| Eje | Nota | Evidencia | Falta para 100 |
|---|---|---|---|
| 1 Autenticidad | 52 (45–60, media) | Repositorio documental real (subida/descarga/renombrar/mover/borrar OK por API); avatar/logo rotos (ARC-01) | Versionado, vínculo a registros, previsualización |
| 2 Corrección | 55 (48–62, media) | `resolve()` rechaza traversal (`storage/strategies/local-storage.strategy.ts:107-113`); nombre `../../../../etc/QA-F2-evil.html` → guardado como `QA-F2-evil.html` con clave aleatoria | Borrado transaccional objeto↔fila; URLs no persistidas |
| 3 Multi-país | N/A | — | Retención de documentos fiscales por país (verificar con contador/abogado local) |
| 4 Arquitectura | 62 (55–68, media) | Contrato `StorageService` claro (`storage/storage.service.ts`), estrategias intercambiables | Política de contenido y escaneo en el contrato |
| 5 Higiene | 60 (52–66, media) | `ServeStaticModule` sirve `join(__dirname,'..','public')` (`app.module.ts:193-196`), que no coincide con el directorio de subida (`process.cwd()/apps/backend/api/public/uploads`) | Eliminar el servido estático o alinearlo con intención |
| 6 Calidad | 60 (52–66, media) | Validación de avatar por regex de mimetype declarado (`users.controller.ts:197-201`) | Magic bytes |
| 7 Robustez | 45 (38–55, media) | Local: disco del contenedor (`process.cwd()`), `STORAGE_DRIVER` por defecto `local` también en producción (`config/env.validation.ts:463`) | Obligar `s3` fuera de dev |
| 8 Seguridad | 60 (52–68, media) | IDOR 0/5; sin acceso anónimo; S3 privado con URL firmada (`s3-storage.strategy.ts:67,111-116`); `Content-Disposition: attachment` y nombre escapado en descarga (`documents.controller.ts:73-84`); **sin antivirus** (grep `clamav|antivirus|malware|virus` → 0 en código de producción); documentos aceptan cualquier tipo incl. `text/html` | Antivirus, lista blanca de tipos, `storageKey` no expuesto |
| 9 Pruebas | 35 (28–45, media) | `storage/` 0 specs; `documents.spec.ts` 1 | Pruebas de traversal, IDOR, borrado |
| 10 Operabilidad | 45 (38–52, baja) | Logs de error en borrado fallido | Métricas de uso por tenant, cuotas |
| 11 UX | 50 (40–58, baja) | Pantalla de documentos real (no recorrida a fondo) | Previsualización, arrastrar-soltar verificado |
| 12 Competitividad | 45 (38–52, baja) | Por debajo de Odoo Documents | OCR, etiquetas, vínculos |

## 5. Compuertas
| # | Estado | Evidencia |
|---|---|---|
| 1 | Cumple con reservas | repositorio documental real; avatar/logo se guardan pero no se pueden ver (ARC-01, flujo secundario) |
| 2 | Cumple con reservas | borrado de nodo borra objetos, no transaccional (no verificado) |
| 3 | Cumple | IDOR y acceso anónimo probados |
| 4 | Cumple con reservas | tamaño sí (50 MB documentos, 5 MB avatar), tipo no en documentos |
| 5 | No verificado por UI | — |
| 6 | N/A | — |
| 7 | No cumple | storage sin specs |
| 8 | No cumple | subida/borrado de documentos sin rastro (ver auditoria-rastro) |
| 9 | Cumple | — |
| 10 | Parcial | — |
| 11 | No verificado | — |
| 12 | Parcial | — |

## 6. Hallazgos

**Pruebas ejecutadas**
1. qa-b POST `/documents/upload` (`qa-f2-b.txt`) → 201, respuesta incluye `storageKey: documents/8af5fff0…/1793450469089-….txt`.
2. qa-b sube HTML con `filename=../../../../etc/QA-F2-evil.html` → 201, nombre saneado, clave aleatoria bajo `documents/<org>/`.
3. Sin sesión: `GET /uploads/<key>`, `/<key>`, `/api/v1/uploads/<key>` → 404 los tres.
4. qa-a: GET/download/rename/DELETE sobre el doc de qa-b → 404.
5. qa-a sube y borra su propio documento → 201/204.
6. qa-a POST `/users/profile/avatar` (PNG) → `{"avatarUrl":"/uploads/avatars/1793471385013-….png"}`; el archivo existe en disco, pero `GET localhost:3000/uploads/avatars/…` → **404** y por el portal `:4200` → 404 (HTML).

**ARC-01** — Alta — bug/funcionalidad — `users/users.controller.ts:214-218`, `organizations/branding.controller.ts:105-106`. Avatar y logo persisten `stored.url`. Con driver local esa URL (`/uploads/...`) no la sirve nadie (prueba 6) → imagen rota; con S3 es una URL **prefirmada con caducidad** (`s3-storage.strategy.ts:111-116`) guardada en BD → deja de funcionar tras el TTL. El logo de empresa se usa en facturas/PDF/correos (no verificado el render). Forma correcta: persistir `storageKey` y resolver la URL al leer (como ya hace `inventory/product-images.service.ts:149,163`). Impacto: riesgo operativo/imagen de marca en documentos. Esfuerzo: S.

**ARC-02** — Alta — seguridad — sin antivirus ni validación por contenido en el repositorio documental, adjuntos de asientos y evidencias (sólo tamaño). Se acepta `text/html` (prueba 2). La descarga va como `attachment` con `nosniff`, lo que mitiga XSS directo, pero los archivos se redistribuyen a otros usuarios del tenant y a auditores. Forma correcta: lista blanca de tipos por uso + verificación de magic bytes + escaneo asíncrono (cuarentena) antes de habilitar descarga. Esfuerzo: M.

**ARC-03** — Media — robustez — `STORAGE_DRIVER` por defecto `local` también en producción (`config/env.validation.ts:463`) y el directorio es relativo a `process.cwd()` (`local-storage.strategy.ts:28`): un despliegue que olvide la variable guarda los archivos de clientes en el disco efímero del contenedor y no se comparten entre réplicas. Forma correcta: exigir `s3` fuera de dev o volumen declarado. Esfuerzo: S.

**ARC-04** — Media — higiene/seguridad — `ServeStaticModule` monta `join(__dirname,'..','public')` en `/` (`app.module.ts:193-196`). Hoy no apunta al directorio de subidas (por eso no hay fuga), pero es un servidor estático global cuyo destino depende de la estructura del build; si un Dockerfile copia `public/` junto al bundle, todos los archivos de todos los tenants quedarían públicos con URL adivinable sólo por timestamp+8 bytes aleatorios. Forma correcta: eliminarlo o limitarlo a activos estáticos explícitos. Esfuerzo: S.

**ARC-05** — Baja — la respuesta de subida expone `storageKey` y `organizationId` internos.

**ARC-06** — Media — pruebas — `storage/` sin specs; traversal e IDOR sin prueba automatizada.

## 7. Camino mínimo a producción
1. ARC-01 persistir clave, resolver URL en lectura (S). 2. ARC-03 exigir S3 fuera de dev (S). 3. ARC-04 retirar ServeStatic de `/` (S). 4. ARC-02 lista blanca + magic bytes (S) y antivirus (M).

## 8. Camino a 100
Antivirus/cuarentena (+10, M); versionado y vínculo a registros (+8, M); cuotas por plan (+5, S); previsualización (+5, M); OCR/búsqueda de contenido (+6, L); retención/WORM para fiscales (+5, M); pruebas (+5, S).

## 9. Competitividad
Brecha básica: adjuntar documentos a cualquier registro con versionado (NetSuite/Odoo lo tienen — confianza alta). Diferenciador: captura de factura de proveedor por IA (`accounts-payable/bill-capture`, fuera de alcance).

## 10. Fortalezas
Claves opacas y aleatorias; traversal bloqueado en resolución; S3 privado con URL firmada; aislamiento por tenant verificado; descarga en streaming con cabeceras seguras.

## 11. No verificado
Driver S3 en ejecución; render de logo en PDF/correo; UI de documentos; borrado recursivo y consistencia objeto/fila.
Cobertura: ~70 % de `storage/`+`documents/` backend; 6 pruebas por API; 0 pantallas.

<!-- RESUMEN: modulo=archivos-y-documentos; madurez=52; prep=50; veredicto=Piloto controlado; eje_debil=Autenticidad y completitud; criticos=0; altos=2; camino_min=M -->
