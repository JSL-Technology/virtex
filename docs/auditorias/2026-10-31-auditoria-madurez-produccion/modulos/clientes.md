# M11 — Clientes (`customers`) — Familia F5

> Sin hallazgos críticos de seguridad. IDOR probado: lectura y edición de un cliente de qa-b desde qa-a → 404.

## 1. Identificación
- **Backend**: `apps/backend/api/src/app/customers/` — 26 archivos (3 specs), 2.887 LOC. Incluye recibos (ver M13), grupos de clientes y estado de cuenta.
- **Endpoints de cliente**: CRUD, dependientes, importación.
- **Tabla**: `customers`, con índices únicos `UQ_customers_org_tax_id`, `UQ_customers_org_email` (parcial) y `UQ_customers_org_final_consumer`.
- **Frontend**: `features/contacts` (formulario de cliente de 320 LOC, creación rápida, listado).

## 2. Estándar de referencia
- Identificación fiscal por país validada (dígito verificador) con tipo de documento; deduplicación; límite de crédito **aplicado** al facturar o pedir; condiciones de pago; múltiples contactos y direcciones (facturación/envío); portal del cliente; importación.
- **Líderes**: NetSuite y Dynamics bloquean o avisan por límite de crédito (confianza alta).

## 3. Resultado
- **Madurez: 48** (42–55, media) · **Preparación: 45 → NO LISTO** (falta una capacidad básica: el crédito).
- Eje más débil: **1 Autenticidad (48)**.
- 0 críticos, 2 altos.

## 4. Doce ejes
| # | Eje | Nota | Evidencia | Qué falta para 100 |
|---|---|---|---|---|
| 1 | Autenticidad | 48 (40–55, media) | Sin límite de crédito utilizable (CLI-01); un solo contacto y una sola dirección como campos planos de la entidad; sin portal (grep `portal` en customers: 0) | Crédito, contactos y direcciones múltiples |
| 2 | Corrección | 60 | Validación con dígito verificador (RNC con tipo y NIT probados); RNC con DV erróneo → 422; deduplicación por índice canónico | CLI-02/03 |
| 3 | Multi-país | 58 (50–65, media) | Catálogo de documentos por país, país del cliente frente al del tenant. RFC genérico rechazado (CLI-03) | — |
| 4 | Arquitectura | 60 | Resolución de identidad en un servicio compartido | — |
| 5 | Higiene | 55 | Los recibos de CxC conviven en el módulo | — |
| 6 | Calidad | 60 | — | — |
| 7 | Robustez | 50 | `findAll` sin límite por defecto (`customers.service.ts` findAll: "BOTH DEFAULTS ARE THE OLD BEHAVIOUR") | — |
| 8 | Seguridad | 75 (68–80, media) | IDOR → 404; permisos por ruta | — |
| 9 | Pruebas | 45 | 3 specs | — |
| 10 | Operabilidad | 50 | Evento `CUSTOMER_CREATED` | — |
| 11 | UX | 55 (no verificado) | — | — |
| 12 | Competitividad | 45 | — | — |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Capacidades básicas | **No cumple** | Crédito |
| 2 | Integridad | Cumple (parcial) | CLI-04 |
| 3 | Aislamiento | Cumple | IDOR → 404 |
| 4 | Validación en servidor | Cumple | — |
| 5 | E2E sin 500 | Cumple | — |
| 6 | Cumplimiento por país | Parcial | CLI-02, CLI-03 |
| 7 | Pruebas en CI | Parcial | — |
| 8 | Auditoría | Parcial | — |
| 9 | Migraciones | Cumple | — |
| 10 | Observabilidad | Parcial | — |
| 11 | UI | No verificado | — |
| 12 | Documentación | Parcial | — |

## 6. Hallazgos

**CLI-01** · Eje 1 · Falta capacidad básica · **ALTA**
- `creditLimit` existe en la entidad (`entities/customer.entity.ts:290`), pero no está en el DTO: `POST /customers` con `creditLimit` → 400 `whitelist_validation`.
- No se aplica en ninguna parte: `grep creditLimit` → solo la entidad y `customers.copilot-tools.ts:38`.
- Ni la factura ni la cotización comprueban crédito ni saldo vencido.
- **Esfuerzo**: M.

**CLI-02** · Ejes 3, 11 · Bug · **MEDIA**
- Un RNC válido de 9 dígitos (131000012) sin `identityDocumentTypeCode` se rechaza con `document_invalid {"document":"Cédula"}`. Lo mismo con "131-00001-2".
- Solo pasa si se envía `identityDocumentTypeCode:"RNC"`. La importación o la API sin tipo fallan con un mensaje engañoso.
- **Esfuerzo**: S.

**CLI-03** · Eje 3 · **MEDIA**
- El RFC genérico del SAT "XAXX010101000" (público en general) → 422 RFC inválido. En CFDI 4.0 es un RFC obligatorio en ventas a público general (verificar con contador).
- Existe el registro "Público en general" sin RFC como mitigación.
- **Esfuerzo**: S.

**CLI-04** · Eje 2 · **MEDIA**
- `totalBilled` se acepta del cliente en `POST /customers`: probado con 999999 guardado (`dto/create-customer.dto.ts:129`).
- Nada lo actualiza al facturar (grep `totalBilled`). Es un dato falso y editable.
- **Esfuerzo**: S.

**CLI-05** · Eje 7 · **MEDIA**
- Listado sin paginación por defecto (`GET /customers` devuelve un array completo).

**CLI-06** · Eje 1 · **ALTA** (brecha)
- Sin contactos ni direcciones múltiples, ni direcciones de envío.
- Sin portal del cliente (búsqueda `portal` en `apps/backend/api/src/app/customers`: sin resultados; no verificado en otros módulos).

## 7. Camino mínimo a producción
1. CLI-01: límite de crédito con bloqueo o aviso en factura y cotización (M).
2. CLI-02, CLI-03, CLI-04 (S).
3. Paginación (S).

## 8. Camino a 100
| Ítem | Puntos | Esfuerzo |
|---|---|---|
| Crédito | +12 | M |
| Contactos y direcciones múltiples | +10 | M |
| Portal | +8 | L |
| Correcciones de validación | +5 | S |
| Pruebas | +5 | M |

## 9. Competitividad
- Validación fiscal por país sólida (mejor que muchas soluciones locales).
- Faltan crédito, contactos múltiples y portal (Alegra, Siigo y Odoo los tienen).
- **Nota: 45.**

## 10. Fortalezas a preservar
- Catálogo de documentos de identidad por país.
- Unicidad canónica de la identificación fiscal.
- Bloqueo del borrado con dependientes.
- "Consumidor final" protegido.

## 11. No verificado
- Importación masiva.
- UI.
- Grupos de clientes.

**Cobertura**: ~40 % del backend leído; 6 endpoints ejecutados.

<!-- RESUMEN: modulo=clientes; madurez=48; prep=45; veredicto=No listo; eje_debil=autenticidad; criticos=0; altos=2; camino_min=M -->
