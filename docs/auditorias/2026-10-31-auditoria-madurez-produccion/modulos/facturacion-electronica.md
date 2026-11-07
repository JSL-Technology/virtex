# M09 — Facturación electrónica (`einvoicing`) — Familia F5

> **CRÍTICOS ABIERTOS**
> - **EINV-01** — Los regímenes MX (CFDI 4.0), CO (DIAN), PE (SUNAT), EC (SRI), CL (SII), BR (NF-e) y AR (AFIP) están **desconectados**. `FiscalRegimeRegistry` no tiene ningún consumidor, así que fuera de DO no se construye, firma ni transmite ningún documento. Probado en CO.
> - **Seguridad (ALTA, no crítica)**: se aceptan certificados emitidos por una CA arbitraria (EINV-03).

## 1. Identificación
- **Código**: `apps/backend/api/src/app/einvoicing/` — 64 archivos (12 specs), ~9.041 LOC.
  - `regimes/{mx,co,pe,ec,cl,br,ar}`: builder, adaptador y spec por país.
  - `services/`: e-CF DGII (builder, validador, firmante, transporte, ciclo de vida ACECF/ANECF, reconciliador, bóveda de certificados).
- **Endpoints**:
  - `einvoicing.controller.ts`: certificados (subir, listar, borrar); estado, envío y XML por factura; aprobación de recibidos; anulación de rangos; mensajes.
  - `fiscal-regime-settings.controller.ts`: configuración del régimen y rangos.
- **Tablas**: `ecf_submissions`, `ecf_certificates`, `ecf_lifecycle_messages`, `fiscal_document_ranges`, `fiscal_regime_settings`.
- Sin frontend propio auditado.
- **¿Núcleo para vender?** Sí, en todo LatAm.

## 2. Estándar de referencia
- **Por régimen se espera**: construcción conforme al anexo técnico; validación XSD; firma (XAdES-BES en DIAN, SRI y SUNAT; XMLDSig en DGII, SII y SEFAZ; sello CSD + PAC en SAT; WSAA + CMS en AFIP); envío por el protocolo real (SOAP con WS-Security, ZIP, mTLS); consulta de estado; contingencia; anulación o cancelación; representación impresa con QR; ambiente de homologación por tenant.
- **Líderes**:
  - Facturama, CONTPAQi y Alegra MX timbran vía PAC con cancelación y motivo (confianza alta).
  - Siigo y Alegra CO: habilitación DIAN, set de pruebas, CUFE, eventos RADIAN (confianza alta).
  - Bsale (CL/PE): emisión SII/SUNAT nativa (confianza media).
- **Invariantes**: no se emite un número fiscal sin un documento transmitible; el estado de la autoridad es la fuente de verdad; el certificado debe pertenecer al emisor y estar emitido por una CA reconocida.

## 3. Resultado
- **Madurez: 25** (rango 20–32, confianza alta) · **Preparación: 20 → NO LISTO**.
- Eje más débil: **1 Autenticidad (25)**.
- Hallazgos: **1 crítico**, 4 altos.

## 4. Doce ejes
| # | Eje | Nota | Evidencia | Qué falta para 100 |
|---|---|---|---|---|
| 1 | Autenticidad | 25 (20–32, alta) | DO real (ver §6). Los otros 7 regímenes son código muerto (EINV-01) | Conectarlos a la emisión |
| 2 | Corrección | 35 (28–45, media) | DGII: validación estructural sin XSD. CO emite número sin CUFE | XSD por tipo y ambiente; CUFE/CUDE |
| 3 | Multi-país | 20 (15–30, alta) | 1 de 8 regímenes operativo | Transporte real por autoridad |
| 4 | Arquitectura | 55 (48–62, media) | Interfaz `FiscalRegimeAdapter` y registro limpios, pero sin enchufar. Transporte genérico | Pipeline común (outbox) para todos los regímenes |
| 5 | Higiene | 50 (40–58, media) | `invoices` importa builders de einvoicing; dos pipelines paralelos (DGII y regímenes) | Un único puerto |
| 6 | Calidad | 60 (52–68, media) | Builders legibles y con specs | — |
| 7 | Robustez | 50 (40–58, baja) | DGII: contingencia (144 reintentos), reconciliador cada 5 min (`ecf-reconciler.service.ts:32`), consulta de TrackIds antes de reenviar | Bloqueo distribuido del cron |
| 8 | Seguridad | 45 (38–55, media) | AES-256-GCM, pero sin validar la cadena del certificado (EINV-03), sal fija y sin rotación (EINV-05); node-forge con CVE (EINV-06) | Cadena de confianza, KMS, rotación |
| 9 | Pruebas | 40 (30–50, media) | Specs de builders y firma (unitarios). Ninguna prueba E2E contra sandbox | Homologación automatizada |
| 10 | Operabilidad | 50 (40–58, baja) | `/einvoicing/messages` y estados | Panel de documentos rechazados |
| 11 | UX | N/A (sin pantalla propia auditada) | — | — |
| 12 | Competitividad | 25 (18–35, media) | Muy por detrás de Facturama, Siigo y Alegra fuera de DO | — |

## 5. Compuertas
| # | Compuerta | Estado | Evidencia |
|---|---|---|---|
| 1 | Sin fachadas | **No cumple** | EINV-01 |
| 2 | Integridad | **No cumple** | Número sin documento (M08 INV-01, EINV-01) |
| 3 | Aislamiento | Cumple (parcial) | Consultas por `organizationId`; IDOR no probado en `/einvoicing/*` |
| 4 | Validación en servidor | Parcial | — |
| 5 | E2E sin 500 | No verificado | — |
| 6 | Cumplimiento por país | **No cumple** | — |
| 7 | Pruebas en CI | No cumple | — |
| 8 | Auditoría | Parcial | — |
| 9 | Migraciones | Cumple | — |
| 10 | Observabilidad | Parcial | — |
| 11 | UI | N/A | — |
| 12 | Documentación | Parcial | — |

## 6. Hallazgos

**EINV-01** · Ejes 1, 3 · Funcionalidad falsa · **CRÍTICA**
- **Qué está mal**: `FiscalRegimeRegistry` (`regimes/fiscal-regime.registry.ts`) se registra en `einvoicing.module.ts:94,105`, pero nadie lo llama.
- **Búsqueda**: `grep -rn "forCountry(\|forOrganization(\|implementedCountries(" apps/backend/api/src/app` → solo nómina, hcm y la fábrica de numeración.
- La emisión solo dispara `EcfSubmissionService.submitInvoice`, que es exclusivamente DGII (`ecf-submission.service.ts:177-211`; exige un e-NCF con formato `E\d{12}`).
- **Prueba en CO** (qa-co):
  1. Rango DIAN SETP 990000001–500 (`POST /einvoicing/regime/ranges` → 201, `hasSecret:false`, sin clave técnica).
  2. Certificado subido.
  3. Cliente NIT 800197268-4.
  4. `POST /invoices` → 201 con SETP990000001.
  5. `GET /einvoicing/invoices/:id/status` → `null`; `/xml` → 404; `ecf_submissions` = 0 filas; `POST /submit` → 400 "has no electronic ncf".
- MX: el adaptador devuelve `ncf:null` y la "factura" nunca se timbra.
- **Impacto**: bloquea la venta en 7 países. Se emiten documentos sin validez fiscal (verificar con contador las consecuencias). **Esfuerzo**: XL.

**EINV-02** · Ejes 1, 3 · Funcionalidad falsa · **ALTA**
- **Ubicación**: `regimes/regime-transport.service.ts`.
- **Qué está mal**: aunque se conectara, el transporte es un `axios.post` genérico a `EINVOICE_<CC>_ENDPOINT` con Bearer o Basic. Ninguna autoridad funciona así:
  - SUNAT: `sendBill`, ZIP en base64 dentro de SOAP con WS-Security.
  - DIAN: SOAP con WS-Security firmado (`SendBillSync`, `SendTestSetAsync`).
  - SII: semilla → token.
  - SEFAZ: mTLS por estado.
  - AFIP: WSAA → WSFE.
- Las consultas de estado mandan fragmentos XML sin sobre SOAP (`co/dian.adapter.ts:122-124`, `pe/sunat.adapter.ts:119`).
- Considera ACCEPTED cualquier respuesta 2xx con un "trackId" extraído por regex.
- No hay cancelación ni anulación en ningún régimen no-DO (grep `cancel|anul` en `regimes/*` sin resultados).
- No hay URLs de homologación salvo en DGII.
- **¿Se llama alguna vez a una autoridad real?** Solo a la DGII, y solo si se emite un E31/E32.
- **Esfuerzo**: XL.

**EINV-03** · Eje 8 · Seguridad / cumplimiento · **ALTA**
- **Qué está mal**: `POST /einvoicing/certificates` acepta certificados de cualquier CA.
- **Prueba**:
  1. Con openssl creé una CA "QA-F5 Fake CA" y emití hojas con el RFC QAM850101AB1 y el NIT 900123456.
  2. Subida en qa-mx (régimen CFDI) y qa-co (régimen DIAN) → 201, `isTest:false`, `isActive:true`.
- `certificate-inspector.ts:95-160` solo rechaza los autofirmados; no valida la cadena contra las AC del SAT, la DIAN o la DGII, ni la revocación.
- Con un certificado así se desbloquea la emisión (`assertReadyToSign`). Que no sirva ante la autoridad se descubre tarde.
- **Esfuerzo**: M.

**EINV-04** · Ejes 3, 10 · Operabilidad · **ALTA**
- **Ubicación**: `dgii-config.service.ts:9-13`.
- **Qué está mal**: el ambiente DGII es global por proceso, con `CerteCF` por defecto. No hay ambiente por tenant: un SaaS tiene a la vez tenants en certificación y en producción.
- Si no se configura, los e-CF de producción van a CerteCF y no tienen validez.
- **Esfuerzo**: M.

**EINV-05** · Eje 8 · Seguridad · **MEDIA**
- **Ubicación**: `certificate-vault.service.ts:24-35`.
- **Qué está mal**: scrypt sobre `ECF_CERT_ENCRYPTION_KEY` con sal fija; sin identificador de clave ni rotación (grep `rotat|kid` vacío). Rotar la clave invalida todos los certificados.
- **Esfuerzo**: M.

**EINV-06** · Eje 8 · Seguridad / dependencias · **MEDIA**
- node-forge ≤1.4.0 tiene la vulnerabilidad GHSA-86w9-cpqp-85rv (alta: la verificación RSA PKCS#1 v1.5 acepta DigestAlgorithm anidado).
- **¿Se usa la ruta vulnerable?** Sí: `certificate-inspector.ts:97` llama a `cert.verify(cert)`. Pero solo sirve para detectar autofirmados: una firma falsificada haría que el certificado se tratara como autofirmado y se rechazara. No hay una decisión de confianza explotable.
- Otras superficies de forge:
  - Parseo PKCS#12 de un archivo subido por el administrador del tenant (`certificate-vault.service.ts:74-75`).
  - CMS de AFIP (`regimes/ar/afip.builder.ts:287`, código muerto).
- No se usa `forge.http` ni `forge.tls`.
- **Acción**: actualizar node-forge (S).

**EINV-07** · Eje 2 · **MEDIA**
- DGII sin validación XSD: es decisión declarada en `ecf-validator.service.ts:43-49`. Un e-CF mal formado se descubre como rechazo de la DGII después de haber consumido el número.

**Lo que SÍ está hecho en DO** (estático; no ejecutado para no contactar a la DGII):
- Builder e-CF, validador de negocio, firma XMLDSig RSA-SHA256 enveloped (`ecf-signer.service.ts:21-24`).
- Autenticación por semilla, recepción y recepción de consumo, consulta de TrackIds antes de reenviar (`ecf-submission.service.ts:319-342`).
- Contingencia (`:60-61`, `:277`), reconciliador, anulación de rangos ANECF (`dgii-transport.service.ts:181-186`), aprobación comercial ACECF, QR y código de seguridad.

## 7. Camino mínimo a producción
- **DO**:
  1. EINV-03 (cadena de confianza) — M.
  2. EINV-04 (ambiente por tenant) — M.
  3. M08 INV-01 — S.
  4. Prueba de homologación en CerteCF en CI o en staging — M.
  5. Actualizar node-forge — S.
- **MX y CO** (prioridad comercial): reescribir el transporte por autoridad (PAC real con cancelación; DIAN con WS-Security, set de pruebas y CUFE) y conectar el registro a la emisión mediante el outbox de `ecf_submissions` — XL cada uno.
- **Resto de regímenes**: declararlos "no soportados" y bloquear la emisión hasta tenerlos (S).

## 8. Camino a 100
| Ítem | Puntos | Esfuerzo |
|---|---|---|
| Conectar el registro + outbox común | +10 | L |
| Transporte real MX (PAC) | +12 | XL |
| Transporte real CO (DIAN) | +12 | XL |
| XSD por tipo | +5 | M |
| Cadena de confianza y KMS | +6 | M |
| Ambiente por tenant | +4 | M |
| Homologación E2E en CI | +6 | L |

## 9. Competitividad
- Fuera de DO no existe frente a Facturama, CONTPAQi (MX), Siigo y Alegra (CO) ni Bsale (CL/PE). En DO es competitivo en diseño, aunque no está demostrado contra la DGII.
- **Nota: 25.**

## 10. Fortalezas a preservar
- Pipeline DGII completo con idempotencia ante la autoridad.
- Builders por país con specs: son una buena base para el trabajo pendiente.
- Bóveda AES-GCM.
- El PKCS#12 no toca disco.

## 11. No verificado
- Transmisión real a la DGII (riesgo de efecto externo).
- IDOR en `/einvoicing/*`.
- XML generado por cada builder contra el XSD oficial.
- Ejecución de los specs de regímenes (pasaron en el Paso 2 global).

**Veredicto y nota por país (e-factura)**
| País | Nota | Veredicto |
|---|---|---|
| DO (e-CF) | 50 | Piloto controlado cuando se cierren EINV-03/04 e INV-01; hoy No listo |
| MX | 10 | Esqueleto desconectado |
| CO | 10 | Esqueleto desconectado (probado) |
| PE | 10 | Esqueleto desconectado |
| EC | 10 | Esqueleto desconectado |
| CL | 10 | Esqueleto desconectado |
| BR | 10 | Esqueleto desconectado |
| AR | 10 | Esqueleto desconectado |
| Otros 11 | 5 | Sin régimen |

**Cobertura honesta**: ~45 % de los archivos leídos (registro, transporte, adaptadores por grep, submission DGII, bóveda, inspector); 4 endpoints ejecutados.

<!-- RESUMEN: modulo=facturacion-electronica; madurez=25; prep=20; veredicto=No listo; eje_debil=autenticidad; criticos=1; altos=3; camino_min=XL -->
