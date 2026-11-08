# Ficha — libs-shared (libs/shared/types, ui-a11y, ui-i18n, util-auth)

Familia FE · 2026-11-07/08.

## 1. Identificación
- `libs/shared/types` 11 archivos/1.021 l. (contratos: auth-user, country-pack, document-lifecycle, legal-documents, account-classification, i18n key/locale/regional-format, enums de registro); `ui-i18n` 15/1.793 l. (`format.service.ts` 589, `locale.store.ts` 296, `format.pipes.ts` 253, `number-input.directive.ts`, `missing-translation.handler.ts`, `error-key.ts`); `ui-a11y` 3/124 l. (`invalid-field.directive.ts`); `util-auth` 4/163 l. (`permissions.util.ts`, `extension-scope.ts`); `libs/shared/locales` (catálogos, sin .ts).
- Pruebas: shared-types 29/29, ui-a11y 5/5, ui-i18n 14/14 (log coordinador). Grafo Nx: sin ciclos; api → types, util-auth; client-web/pos → todas.
- Países: N/A (formato regional sí). Núcleo: infraestructura.

## 2. Estándar de referencia
Regla del proyecto (indicada por el coordinador): la lógica de dominio vive en cada aplicación/módulo; las librerías compartidas solo llevan contratos de transporte, utilidades técnicas y UI sin dominio. Referencia: Nx "library types" (feature/ui/data-access/util) y DDD "shared kernel" mínimo y explícito (nx.dev, confianza alta).

## 3. Resultado
- **Madurez: 66 (60–72, confianza media)**. Preparación: 68. **Veredicto: Listo con reservas** como infraestructura (no es un módulo vendible por sí mismo; sus reservas son de higiene).
- Eje más débil: 5 (dos reglas de dominio dentro de `shared/types`). Críticos: 0.

## 4. Ejes
| Eje | Nota | Evidencia | Qué falta para 100 |
|---|---|---|---|
| 1 Completitud | 70 (62–76, media) | Contratos compartidos reales usados por api y cliente (p.ej. `LEGAL_DOCUMENTS` en `auth/services/registration.service.ts`, `legal/legal.service.ts`, `features/auth/register/register.page.ts`) | — |
| 2 Corrección | 68 (60–74, media) | `isCategoryAllowedForType` (account-classification.contract.ts:21-25) la aplican servidor (`chart-of-accounts.service.ts`) y cliente: misma regla en ambos lados | — |
| 3 Multi-país | 65 (55–70, baja) | `country-pack.contract.ts` declara capacidades por mercado y deja las semillas en el servidor (comentario l.19-20 coherente con el código) | — |
| 4 Arquitectura | 66 (60–72, media) | Libs pequeñas, sin ciclos | — |
| 5 Higiene/separación | 52 (45–60, media) | Reglas de dominio en shared: `ACCOUNT_CATEGORIES_BY_TYPE` (invariante contable: qué categorías admite cada tipo de cuenta) en `types/src/lib/accounting/account-classification.contract.ts:10-25`; `canTransition`/`mainPath` de ciclo de vida (motor genérico, usado por procurement) en `document-lifecycle.contract.ts:57-80`; ediciones vigentes de documentos legales (`legal-documents.contract.ts:29`) como constante compilada | Mover la tabla contable al módulo de contabilidad y exponerla por API/contrato generado; las ediciones legales como datos del módulo legal |
| 6 Calidad | 72 (65–78, media) | Archivos acotados, documentados | — |
| 7 Robustez | N/A | — | — |
| 8 Seguridad | 65 (58–72, media) | `util-auth/permissions.util.ts` y `extension-scope.ts` (solo GET/HEAD para extensiones, l.33) compartidos por servidor y cliente: la verificación real está en el servidor | — |
| 9 Pruebas | 70 (62–75, media) | 48 tests verdes | Pruebas de propiedades de FormatService por locale |
| 10 Operabilidad | N/A | — | — |
| 11 UX/i18n | 70 (62–76, media) | `missing-translation.handler.ts` + `error-key.ts`; 0 claves crudas en humo es/en/pt | — |
| 12 Competitividad | N/A | — | — |

## 5. Compuertas
Aplicables: 1 Cumple; 4 N/A; 7 No cumple a nivel repo (main rojo, aunque estas libs pasan); 11 Cumple. Resto N/A.

## 6. Hallazgos
- **FE-LIB-01** · eje 5 · mezcla de contexto · **Media** · `libs/shared/types/src/lib/accounting/account-classification.contract.ts:10-25`. Invariante del plan de cuentas en una librería compartida por todas las apps: cualquier cambio contable obliga a reconstruir/desplegar cliente, POS y api juntos, y el módulo de contabilidad no es dueño de su regla. Forma: regla en `apps/backend/api/src/app/chart-of-accounts` y el cliente la recibe como datos (o contrato generado). S.
- **FE-LIB-02** · eje 5 · higiene · **Baja** · `legal-documents.contract.ts:29`. La edición vigente de términos/privacidad es una constante de compilación: publicar una edición nueva exige desplegar las tres apps (lo dice el propio comentario l.11-13). Para un SaaS multi-país, las ediciones por país/idioma deberían ser datos versionados del módulo legal. S.
- **FE-LIB-03** · eje 5 · higiene · **Baja** · `document-lifecycle.contract.ts:57-80`: motor de transiciones genérico en shared (aceptable como util), pero los ciclos concretos deben quedar en cada módulo — verificar con el equipo que ninguno se defina aquí (grep: solo tipos y funciones genéricas). S.

## 7. Camino mínimo a producción
FE-LIB-01 (S). Lo demás no bloquea.

## 8. Camino a 100
Regla contable al módulo (+8), ediciones legales como datos (+5), pruebas de FormatService por locale/país (+5), lint de fronteras que impida dominio en `libs/shared` (+5).

## 9. Competitividad
N/A.

## 10. Fortalezas
Contratos compartidos que convierten una divergencia cliente/servidor en error de compilación; libs pequeñas y sin ciclos; i18n con manejador de claves faltantes.

## 11. No verificado
Cobertura de casos regionales de `format.service.ts` (no se ejecutaron pruebas propias).
