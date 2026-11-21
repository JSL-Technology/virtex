# Ficha — storage + documents (adjuntos y repositorio documental)
Familia PLTA · 2026-11-07 · Diagnóstico.

## 1. Identificación
- `storage/` (4 archivos, 321 l.; **0 specs**): `StorageService` abstracto, `LocalStorageStrategy` (disco en `process.cwd()/apps/backend/api/public/uploads`), `S3StorageStrategy` (URLs firmadas 900 s). Selección por `STORAGE_DRIVER` (default `local`, también en producción: env.validation.ts:474).
- `documents/` (5 archivos, 772 l.; 1 spec): `GET /documents`, `GET /documents/:id`, `/:id/breadcrumb`, `/:id/download`, `POST /documents/folders`, `POST /documents/upload` (≤50 MB), `PATCH /:id`, `/:id/rename`, `/:id/move`, `DELETE /:id`. Tabla `document_nodes` (auditada por el subscriber). Otros consumidores: adjuntos de facturas de proveedor, asientos, evidencias de auditoría, correo entrante.
- Núcleo: medio.

## 2. Estándar de referencia
(a) Carpetas, subida/descarga con permisos, límites de tamaño, lista de tipos permitidos, verificación de contenido (magic bytes) y antivirus, versionado, papelera, almacenamiento de objetos compartido entre réplicas, cifrado en reposo, retención legal. (b) Invariantes: un archivo solo se descarga desde su tenant; nombre de archivo nunca controla la ruta; contenido activo nunca se sirve inline. (c) SharePoint/Dynamics, NetSuite File Cabinet (carpetas, permisos, versionado), Odoo Documents (confianza media). (d) Clave de objeto opaca con prefijo de tenant, descarga por id vía API, escaneo asíncrono.

## 3. Resultado
**Madurez 55 (48–62, confianza alta)**; preparación 55; **Piloto controlado**. Eje más débil: 7/8 (sin validación de tipo/contenido, disco local por defecto). Críticos: 0.

## 4. Ejes
| Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|
| 1 | 62 | Subida/descarga/borrado reales (201/200/204); carpetas y breadcrumb; sin versionado ni papelera (DELETE borra fila y archivo: `document_nodes` 0 filas y directorio vacío tras borrar) | Versiones, papelera, retención |
| 2 | 60 | Si falla el INSERT se borra el objeto (documents.service.ts:181-184); unicidad de nombre por carpeta | Transacción objeto↔fila en borrado |
| 3 | N/A | | |
| 4 | 60 | Estrategia intercambiable; `storage` duplicado `sanitizeSubPath` en ambas estrategias | — |
| 5 | 65 | — | — |
| 6 | 65 | — | — |
| 7 | 45 (media) | Disco local por defecto incluso en producción → archivos no compartidos entre réplicas y perdidos al recrear contenedor; ruta bajo el árbol del código fuente | Exigir `s3` fuera de dev |
| 8 | 58 (50–65, alta) | Aislamiento OK: qa-do-b `GET/download/DELETE/PATCH rename` sobre documento de qa-do-plt → 404; member sin `documents:view` → 403; nombre `../../QA-PLTA-evil.exe` normalizado a `QA-PLTA-evil.exe`, clave de almacenamiento opaca; `resolve()` impide salir del directorio; 50 MB+ → 413. **Pero** se aceptan `.html`, `.svg`, `.exe` con el MIME que declare el cliente (201) y se devuelven con `Content-Type: text/html` (mitigado por `Content-Disposition: attachment` + `nosniff`); sin antivirus (grep `clamav|antivirus|malware` en src: 0); la extensión de la clave sale del nombre del usuario | Lista de tipos permitidos + magic bytes + escaneo; servir `application/octet-stream` |
| 9 | 35 | storage sin specs; documents 1 spec | Specs de traversal, tipos y aislamiento |
| 10 | 55 | Auditoría de `document_nodes` (subscriber) | — |
| 11 | 50 (baja) | UI no probada | — |
| 12 | 45 | Sin versionado/vista previa/búsqueda de contenido | — |

## 5. Compuertas
1 Parcial · 2 Cumple · 3 Cumple (probado) · 4 Parcial (sin validación de tipo) · 5 Cumple · 6 N/A · 7 No cumple (storage sin pruebas) · 8 Cumple · 9 N/A · 10 Parcial · 11 No verificado · 12 Parcial.

## 6. Hallazgos
- **PLT-STO-01** · storage · eje 7 · robustez · **Alta** · `config/env.validation.ts:474`, `storage/storage.module.ts`, `local-storage.strategy.ts` (uploadDir) · Producción arranca con `STORAGE_DRIVER=local` por defecto: en un despliegue con varias réplicas o contenedores efímeros los adjuntos (facturas de proveedor, evidencias, documentos) se pierden o no se encuentran. · Requerir `s3` cuando no es dev-like. · Riesgo de pérdida de datos. · S.
- **PLT-STO-02** · documents · eje 8 · seguridad · Media · `documents/documents.controller.ts:100-121`, `documents.service.ts:150-185` · Sin lista de tipos permitidos, sin verificación de contenido y sin antivirus; MIME del cliente persistido y reenviado. Probado: `.html` (text/html), `.svg`, `.exe` → 201. · Allowlist + magic bytes + escaneo asíncrono (cuarentena). · M.
- **PLT-STO-03** · storage · eje 9 · pruebas · Media · `storage/` 0 specs · El guard de traversal (`resolve`) no tiene prueba. · S.
- **PLT-STO-04** · storage · eje 4 · Baja · `app.module.ts:203-206` `ServeStaticModule` sirve `public/` en `/`; hoy no expone `uploads` porque `__dirname/../public` ≠ `cwd/apps/backend/api/public` (curl `/uploads/...` → 404), pero coincidencia de rutas en otro empaquetado publicaría todos los adjuntos sin autenticación. · Mover uploads fuera de `public/`. · "verificar con el equipo" el layout de despliegue. · S.

## 7. Camino mínimo
S3 obligatorio fuera de dev (S); allowlist de tipos + magic bytes (S); specs de storage (S); antivirus (M).
## 8. Camino a 100
Versionado y papelera (+10, M); escaneo (+6, M); vista previa y búsqueda (+6, L); retención legal (+4, M).
## 10. Fortalezas
Prefijo por tenant en la clave; descarga solo por id vía API con permiso; guard de traversal; límite de tamaño; borrado compensatorio.
## 11. No verificado
Driver S3 real; subida desde la UI.
