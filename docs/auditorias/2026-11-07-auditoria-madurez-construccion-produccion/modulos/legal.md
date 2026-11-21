# Ficha — `legal` (documentos legales, lista de espera por mercado, aceptaciones) · Familia NOM

> Auditoría diagnóstica 2026-11-07. Sin hallazgos CRÍTICOS.

## 1. Identificación

| Campo | Valor |
|---|---|
| Backend | `apps/backend/api/src/app/legal` (5 archivos, 183 líneas): `GET /legal/info` (público), `POST /legal/market-waitlist` (público, 5/min por IP) |
| Tablas | `market_waitlist` (único email+país; guarda IP); `legal_acceptances` es de `auth` (`auth/entities/legal-acceptance.entity.ts`, escrita en `registration.service.ts:676-703`) |
| Frontend | `features/legal` (425 líneas): `/es|en|pt/terms`, `/privacy`, `/security`, `/contact` (`app.routes.ts:107-126`) |
| Pruebas | No hay spec en `legal/` (glob) |
| ¿Núcleo? | Requisito legal de cualquier SaaS |

## 2. Estándar de referencia

(a) Términos/privacidad versionados y publicados en cada idioma declarado; registro probatorio de aceptación (quién, qué versión, cuándo, IP/agente) para **cada** usuario, incluidos los invitados; re-aceptación al cambiar versión; aviso de privacidad conforme a cada jurisdicción (DO Ley 172-13, MX LFPDPPP, CO Ley 1581, BR LGPD, AR Ley 25.326, US estatales); retención/borrado de datos de prospectos. (b) Invariantes: ninguna cuenta activa sin aceptación de la versión vigente. (c) Referencia: prácticas de Stripe/Shopify/Atlassian (aceptación con versión y re-aceptación) — confianza media; requisitos normativos — **verificar con abogado local**. (d) Construcción: catálogo de versiones, tabla de aceptaciones, guard que exige re-aceptación.

## 3. Resultado

| | |
|---|---|
| **Madurez** | **50 (42–58, confianza media)** |
| **Preparación comercial** | **50** |
| **Veredicto** | **No listo** (con reservas menores: Piloto controlado si se corrige NOM-50) |
| Eje más débil | 1/2 (aceptación de invitados y re-aceptación) |
| Críticos abiertos | 0 |

## 4. Tabla de 12 ejes

| Eje | Nota | Evidencia | Qué falta |
|---|---|---|---|
| 1 Autenticidad (crítico) | 50 (42–58, media) | `GET /legal/info` → versiones 2026-10-12 y correo de soporte; páginas reales en es/en/pt (Playwright `/es/terms`, `/en/terms`, `/pt/terms`, sin errores de consola). Aceptación solo en alta de empresa | Aceptación de invitados, re-aceptación |
| 2 Corrección (crítico) | 50 (42–58, media) | Alta exige versión vigente (`registration.service.ts:658-667`). Invitado `qa-nom-approver` activado por `set-password-from-invitation` sin ninguna fila en `legal_acceptances` (grep `LegalAcceptance`: solo `registration.service.ts`). Nota: 0 filas en BD QA porque los tenants QA se crearon sin consentimiento (script del coordinador) — no es hallazgo | Registrar aceptación en invitación/SSO |
| 3 Multi-país | 35 (25–45, baja) | Un único texto para 19 mercados; no verifiqué cláusulas por jurisdicción | Avisos por país — verificar con abogado |
| 4 Arquitectura | 62 (55–68, media) | Catálogo de versiones en `@virteex/shared/types` (`LEGAL_DOCUMENTS`); waitlist como upsert | Guard de re-aceptación |
| 5 Higiene | 65 (58–72, media) | `legal_acceptances` vive en `auth`, no en `legal` (dueño distinto del nombre del módulo) | Decidir dueño único |
| 6 Calidad | 72 (65–78, media) | 0 warnings de lint | — |
| 7 Robustez | 65 (58–72, media) | Throttle: 5×202 y luego 429 (probado) | — |
| 8 Seguridad (crítico) | 62 (55–70, media) | Público por diseño; validación (`countryCode` 2 letras, email) ok; guarda IP del visitante sin política de retención visible (`market_waitlist.ip_address`) | Retención/consentimiento de prospectos |
| 9 Pruebas | 25 (18–32, media) | Sin specs en `legal/` | Pruebas de upsert/throttle/aceptaciones |
| 10 Operabilidad | 55 (48–62, media) | Log estructurado `market_waitlist_joined` sin email | — |
| 11 UX/idiomas | 70 (62–76, media) | es/en/pt completos en las páginas probadas | Accesibilidad no verificada |
| 12 Competitividad | 45 (35–55, baja) | Paridad básica | — |

## 5. Compuertas

1 Parcial · 2 No cumple (invitados sin aceptación) · 3 N/A (público) · 4 Cumple · 5 Cumple (sin 500, sin errores de consola) · 6 No verificado (textos por jurisdicción) · 7 No cumple (sin pruebas) · 8 Parcial · 9 Cumple · 10 Cumple · 11 Cumple · 12 Parcial.

## 6. Hallazgos

**NOM-50 — Usuarios invitados (y cualquier alta que no sea el registro de empresa) nunca aceptan términos/privacidad; no existe re-aceptación al cambiar versión** · ejes 1/2 · cumplimiento · **Alta** · `auth/auth-registration.controller.ts:314-337` (`set-password-from-invitation` sin consentimiento); `legal-acceptance.entity.ts:55` («a re-acceptance flow would add its own»). Impacto: riesgo legal para la plataforma. Esfuerzo: M.

**NOM-51 — Un solo texto legal para 19 jurisdicciones** · eje 3 · Media · verificar con abogado local (Ley 172-13 DO, LFPDPPP MX, LGPD BR…). Esfuerzo: M.

**NOM-52 — IP de visitantes en `market_waitlist` sin retención ni aviso** · eje 8 · Baja · `legal.service.ts` `joinWaitlist`. Esfuerzo: S.

**NOM-53 — Sin pruebas** · eje 9 · Media · Esfuerzo: S.

## 7. Camino mínimo a producción

NOM-50 (M) → NOM-53 (S) → revisión jurídica por país (M, externa).

## 8. Camino a 100

Re-aceptación y aceptación de invitados (+20), avisos por jurisdicción (+15), retención de prospectos (+5), pruebas (+10).

## 9. Competitividad

Paridad básica con SaaS comparables en publicación versionada multilingüe; brecha en re-aceptación.

## 10. Fortalezas

Versiones únicas compartidas front/back, páginas multilingües públicas, throttle en waitlist, upsert idempotente.

## 11. No verificado

Contenido jurídico de los textos; accesibilidad; flujo de registro real con consentimiento (los tenants QA se crearon por script).
