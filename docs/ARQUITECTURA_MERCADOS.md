# Arquitectura de mercados: un núcleo que no nombra países

**Estado:** aceptada (2026-11-09). Se implementa por fases. El avance de cada fase está en la §8.
**Alcance:** backend (`apps/backend/api`), cliente web (`apps/core/client-web`), catálogos de
textos (`libs/shared/locales`) y puertas de CI.

## 1. Contexto

Virteex se vende en 19 mercados: República Dominicana, México, Colombia, Perú, Chile, Ecuador,
Argentina, Brasil, Estados Unidos, Uruguay, Paraguay, Bolivia, Venezuela, Panamá, Costa Rica,
Guatemala, El Salvador, Honduras y Nicaragua. Cada uno debe verse y comportarse como un producto
nativo de ese país, incluido su idioma.

La medición del 2026-11-09 (`tools/verify/country-neutrality.mjs` y un inventario por archivo)
encontró lo contrario. El producto está escrito para un país y los demás se agregaron por excepción:

- **152 archivos** contienen código de un país concreto, y **45 de ellos** están en `einvoicing/`.
- **La República Dominicana tiene su propia vía de facturación electrónica**, con sus propias
  tablas, servicios y estados: `ecf_submissions`, `ecf_lifecycle_messages`, `ecf-*.service`,
  `dgii-*.service` y variables de entorno `DGII_*`.
  - Los otros siete regímenes comparten `fiscal_submissions` y `FiscalRegimeRegistry`, y el
    registro excluye a DO a propósito.
- **Hay dos sistemas de rangos de numeración**: `ncf_sequences` para DO y
  `fiscal_document_ranges` para el resto.
- **`FiscalAdapterFactory` decide el mercado con un `switch`** sobre el código de país.
- **Tablas genéricas con columnas de un solo país:**
  - `vendor_bills`: `ncf`, `ncf_modified`, `purchase_category` (categorías del 606 de la DGII),
    `isr_retention_type` y `payment_form`.
  - `invoices`: `modification_code`, el «CodigoModificacion» de la DGII.
- **Ramas `=== 'DO'`, `!== 'DO'` y `=== 'MX'`** en servicios de compras, POS, rangos, transmisión,
  y en pantallas del cliente (ajustes fiscales, régimen de facturación, declaraciones).
- **Valores por omisión silenciosos:** `'DOP'` en cinco entidades de nómina y 27 `?? 'USD'`.
- **El conocimiento de un país está repartido en unas quince tablas paralelas** dentro de
  `localization/fiscal/`. Cada una está indexada por código de país:
  - perfiles, packs, esquemas de impuestos, tipos de documento, cobertura, anulación;
  - documentos de identidad, validadores, retenciones, captura de compras;
  - catálogo de cuentas y otras.
  Saber «cómo está configurado México» exige leerlas todas. Agregar un mercado exige no olvidar
  ninguna.
- **Textos regionales en 8 de los 19 mercados.** `es-DO` tiene 54 claves; once mercados no tienen
  ninguna, así que se ven con el español genérico.

El patrón se repite: cada decisión se tomó para un mercado, de forma razonable en su momento, y
los demás heredaron la respuesta.

## 2. Decisión

> **El núcleo no nombra países.** Todo lo que distingue a un mercado vive en su paquete,
> `apps/backend/api/src/app/markets/<cc>/`. Todos los paquetes tienen la misma estructura. El
> núcleo consulta al mercado por un registro y nunca por su nombre.

### 2.1 Estructura canónica de un mercado

Cada mercado tiene exactamente estos archivos, aunque alguno solo declare «no aplica»:

| Archivo | Qué declara | Ejemplo (DO / MX / US) |
|---|---|---|
| `index.ts` | La `MarketDefinition`: une los archivos siguientes. Es lo único que importa el catálogo. | — |
| `profile.ts` | Nombre, moneda, locale, zona horaria, prefijo telefónico, autoridad, idioma de los libros, formatos, modelo de dirección y divisiones, ejemplos | DOP · `es-DO` · DGII |
| `identity.ts` | Documentos de identidad (fiscales y personales), sus validadores, datos fiscales del contribuyente que exige la autoridad, consulta al padrón | RNC/cédula · RFC/CURP + régimen fiscal · EIN/SSN |
| `taxes.ts` | Modelo de impuestos (tasas nacionales o por jurisdicción), impuestos iniciales, retenciones, cargo por servicio | ITBIS 18 % · IVA 16 % · sales tax por estado |
| `documents.ts` | Tipos de documento de venta, política de numeración, notas de crédito y débito, motivos de ajuste canónicos → código de la autoridad, política de anulación, catálogos de motivos | B01/E31… · I/E · numeración interna |
| `purchases.ts` | Documento recibido del proveedor (qué es, cómo se valida) y atributos fiscales de la compra (esquema) | NCF + 606 · UUID CFDI + DIOT · número de factura |
| `payments.ts` | Formas de pago: quién es dueño del catálogo y con cuáles empieza la empresa | 606 «Forma de pago» · `c_FormaPago` · ACH/Wire |
| `accounting.ts` | Plantilla del catálogo de cuentas, segmentos, si la ley exige un plan oficial | — |
| `payroll.ts` | Parámetros y conceptos iniciales, motor de nómina si existe | TSS/AFP/SFS · — · FICA/FUTA |
| `returns.ts` | Declaraciones periódicas: generadores implementados y con qué reportes se preparan las demás | 606/607/608 · contabilidad electrónica · 1099 (pendiente) |
| `einvoicing.ts` | Si la ley exige facturación electrónica, el régimen y su implementación: formato, protocolo y esquema de configuración | e-CF · CFDI 4.0 · no aplica |

Un mercado con una implementación propia la pone en una subcarpeta del mismo nombre. Por ejemplo,
`markets/mx/einvoicing/` contiene el constructor del CFDI y el protocolo del PAC, y
`markets/do/returns/` contiene los generadores 606, 607 y 608. El archivo de primer nivel
(`einvoicing.ts`, `returns.ts`) es el que la declara.

`markets/market-structure.spec.ts` comprueba que cada carpeta de mercado tiene exactamente ese
conjunto de archivos, y que `index.ts` los compone.

### 2.2 El contrato

`markets/contracts/` declara qué puede saber el producto de un mercado:

- `MarketDefinition` y un archivo por capacidad, con sus tipos.
- Las **vistas neutrales** que reciben las implementaciones: un documento fiscal visto sin la
  entidad del ORM, o una fila del registro de compras.
- Los **puertos** que los motores ofrecen a los mercados: HTTP hacia la autoridad, certificado del
  contribuyente y credenciales.

Toda capacidad tiene un estado explícito. No existe la ausencia silenciosa:

- `implemented` — construida, probada y alcanzable.
- `needs-credentials` — construida; falta lo que solo el contribuyente puede aportar: certificado,
  PAC u homologación.
- `needs-configuration` — construida; falta un dato que decide la empresa.
- `not-implemented` — la ley la exige y el producto todavía no la tiene. Se informa antes de cobrar.
- `not-applicable` — el mercado no tiene esa obligación. Ejemplo: la factura electrónica en EE. UU.

**La cobertura se deriva del registro**, no de una tabla escrita a mano. Una capacidad está
implementada si el mercado declara una implementación. Los textos de la cobertura son claves de
catálogo, nunca literales en español.

### 2.3 El registro

`markets/index.ts` es la única puerta de entrada:

```ts
marketFor(countryCode): MarketDefinition   // mercado desconocido → mercado neutral
allMarkets(): readonly MarketDefinition[]
marketCodes(): readonly string[]
```

El **mercado neutral** no reclama nada propio de un país: numeración interna, sin retenciones,
formas de pago genéricas y editables, y los libros como forma de preparar las declaraciones. Neutral
quiere decir que no es dominicano: el fallo que esta arquitectura corrige es justamente que un
mercado desconocido herede las respuestas del primero.

### 2.4 Capas y dirección de las dependencias

```
  módulos de negocio (ventas, compras, contabilidad, rrhh, reportes, configuración…)
        │  motores genéricos: emisión, numeración por rangos, outbox de transmisión,
        │  registros fiscales, declaraciones, nómina
        ▼
  markets/index.ts  +  markets/contracts/        (registro, contrato, vistas, puertos)
        ▲
  markets/<cc>/                                  (datos declarativos + funciones puras +
                                                  implementaciones de puertos)
```

- **`markets/` es plataforma**, igual que `currencies`: son datos de referencia que lee todo el
  mundo, incluidas las migraciones y el seed de aprovisionamiento. No importa ningún módulo de
  negocio, y `verify:boundaries` lo garantiza porque plataforma no puede depender de nadie.
- **Nadie fuera de `markets/` importa `markets/<cc>/`.** Solo `markets/index` y
  `markets/contracts/**` son superficie pública. `verify:country-neutrality` lo comprueba con
  tolerancia cero.
- **Los motores no ramifican por país.** Leen la capacidad del mercado y la ejecutan:
  - el motor de numeración pide la política de numeración del mercado;
  - el outbox de transmisión pide al mercado el formato y el protocolo;
  - el motor de declaraciones pide los generadores.
- **Las implementaciones de un mercado reciben vistas neutrales, no entidades.** Un constructor de
  CFDI es una función de `FiscalDocumentView`. El motor traduce `Invoice` a esa vista una sola vez.
  Así el formato se prueba sin base de datos, y el paquete se podría extraer a `libs/markets/<cc>`
  sin arrastrar el ORM.

### 2.5 Persistencia

- Las tablas genéricas tienen **columnas neutrales**:
  - `vendor_bills`: `supplier_fiscal_number`, `supplier_fiscal_key`,
    `modified_supplier_fiscal_number`, `fiscal_attributes` y `payment_method_code` (hecho en la
    fase 4; véase §2.10).
  - `invoices`: `adjustment_reason`, canónico. La traducción al código de la autoridad la hace el
    mercado.
- **Lo propio de un mercado va en `fiscal_attributes jsonb`**, validado contra el esquema que
  declara el mercado (`purchases.ts`, `documents.ts`). La validación ocurre en el servicio y en el
  formulario, que se dibuja a partir de ese mismo esquema.
  - Ejemplo DO: categoría de compra del 606 y tipo de retención de ISR.
  - Ejemplo MX: tipo de tercero y operación para la DIOT.
- **Una sola tabla por concepto, para todos los mercados:**
  - `fiscal_document_ranges` absorbe `ncf_sequences` (hecho en la fase 2; véase §2.8);
  - `fiscal_submissions` absorbe `ecf_submissions`;
  - `fiscal_document_events` absorbe `ecf_lifecycle_messages`, porque aprobación comercial, acuse
    y anulación existen en DO, CO, CL, BR y MX.
- **Los catálogos de códigos de la autoridad son datos del paquete**, versionados y con su base
  legal. Los que se necesitan en SQL (`fiscal_document_type_definitions`, `fiscal_reason_codes`)
  son proyecciones del paquete. Se escriben al arrancar, de forma idempotente, igual que hoy
  `fiscal_regions`.

### 2.6 Cliente

- El cliente **no compara códigos de país**. Lee la definición pública del mercado del tenant
  (`GET /localization/market`) y dibuja a partir de ella:
  - los formularios (atributos fiscales de compra, ajustes del régimen);
  - las listas (tipos de documento, motivos, formas de pago);
  - las pantallas de declaraciones.
- El vocabulario sale del catálogo de textos:
  - un texto base neutral por idioma (`es`, `en`, `pt`);
  - un **parche regional por mercado** (`es-DO`, `es-MX`, … `en-US`, `pt-BR`), los 19;
  - una prueba de completitud exige que cada mercado defina las claves de vocabulario fiscal
    (nombre del impuesto, del documento fiscal y de la autoridad).

### 2.7 Puertas de CI

| Puerta | Qué garantiza |
|---|---|
| `verify:country-neutrality` | Ningún término, comparación ni texto de un país fuera de `markets/`, de los parches regionales y de las migraciones. Ningún import de `markets/<cc>/` desde fuera. El baseline solo baja, y la meta es cero. |
| `markets/market-structure.spec.ts` | Los 19 mercados tienen la estructura canónica, y cada capacidad declara un estado. |
| `markets/market-catalogue.spec.ts` | Integridad de los datos: códigos únicos, monedas ISO 4217, zonas IANA, validadores que aceptan los ejemplos, motivos canónicos con su traducción en cada mercado que emite notas, etc. |
| Completitud de parches regionales | Cada mercado nombra en su idioma su impuesto, su documento fiscal y su autoridad. |
| `verify:boundaries` | `markets/` no depende de ningún módulo de negocio. |

### 2.8 Numeración fiscal

Un solo motor numera los documentos de todos los mercados: `MarketFiscalAdapter`, que
`FiscalAdapterFactory` entrega por código de mercado, sin `switch`. Lo que cambia entre mercados es
la **política de numeración** que cada uno declara en `markets/<cc>/documents.ts` (`numbering`):

| Dato de la política | Qué decide | Ejemplos |
|---|---|---|
| `source` | De dónde sale el número | `AUTHORITY_RANGE`: rango que concedió la autoridad (DO, CO, PE, EC, CL, BR) · `AUTHORITY_ON_TRANSMISSION`: lo asigna la autoridad al transmitir (AR) · `STAMP`: la identidad es el timbre (MX) · `NONE`: no hay número fiscal (US y los mercados solo contables) |
| `emissionKinds` | Si el mercado tiene documentos electrónicos, tradicionales o ambos | DO: ambos |
| `typeOf(documento)` | Qué tipo es un documento, a partir de hechos (comprador, impuesto, documento que modifica), no de la entidad del ORM | CL: 33 si la venta lleva IVA, 34 si no |
| `requestedType` | `CHOOSE`: el emisor puede elegir otro tipo del mismo propósito · `CONFIRM`: el tipo lo determina el documento, y una solicitud que lo contradiga se rechaza | DO y PE eligen; el resto confirma |
| `seriesOf` y `acceptsSeries` | De qué rango se toma el número cuando la serie no es libre, y qué series admite cada tipo al registrar un rango | EC: `EEE-PPP` del punto de emisión · PE: serie F para factura y B para boleta |
| `format` | Cómo se escribe el número que se tomó | `B01` + 8 dígitos · `F001-00000123` |
| `tillReceiptType` | El comprobante que el punto de venta entrega al consumidor, si el mercado tiene uno | DO: B02 |

Reglas que valen para todos los mercados por igual:

- **Una sola tabla de rangos**, `fiscal_document_ranges`, y un solo servicio, `FiscalRangeService`.
  El número se toma con la fila bloqueada dentro de la transacción que emite el documento.
- **Un rango solo se registra si** el mercado numera por rangos, el tipo está en su catálogo, la
  serie es una que la autoridad admite para ese tipo, lleva vencimiento cuando el tipo lo exige, no
  se solapa con ningún rango anterior del mismo tipo y serie (vigente o retirado) y ninguno de sus
  números está ya en un documento. Dos registros simultáneos del mismo rango se serializan.
- **El documento guarda lo que se tomó**: el consecutivo y la serie (`fiscal_sequence`,
  `fiscal_series`, en facturas y en tiquetes de caja), además del tipo. Nada vuelve a leerlos del
  número ya formateado, y los constructores de factura electrónica escriben el tipo registrado en
  lugar de decidirlo otra vez.
- **Quién ya usó un número lo responde su dueño.** Facturas y punto de venta se inscriben en
  `IssuedFiscalNumbersRegistry` (contrato de plataforma); el servicio de rangos no importa sus
  tablas.
- **Un rango nunca se borra.** Se retira o se reactiva, porque es la autorización bajo la que se
  emitieron documentos anteriores. Cerrar un tramo sin usar (la anulación de secuencias) solo se
  admite desde el siguiente número sin emitir, y con el rango bloqueado mientras se declara.

Una sola pantalla de ajustes (`vx-fiscal-ranges-card`) y una sola API (`einvoicing/regime/ranges`)
sirven a todos los mercados.

### 2.9 Motivos de una nota

Una nota explica por qué modifica el documento que nombra, y cada autoridad lo codifica a su manera:
el `CodigoModificacion` de la DGII, el código de referencia del SII, los catálogos 09 y 10 de SUNAT,
el concepto de corrección de la DIAN. Ninguno coincide con otro, ni en los códigos ni en el detalle
con que cortan.

El documento guarda el **hecho comercial**, que es el mismo en todas partes, en `adjustment_reason`:

| Nota de crédito | Nota de débito |
|---|---|
| `ANNULMENT` · `GOODS_RETURN` · `PRICE_REDUCTION` · `DETAIL_CORRECTION` · `OTHER` | `LATE_PAYMENT_INTEREST` · `ADDITIONAL_CHARGES` · `PRICE_INCREASE` · `PENALTY` · `OTHER` |

Cada mercado declara el código de su autoridad para cada motivo (`documents.ts`,
`adjustmentCodes`), o declara que no escribe ninguno y dice por qué en su propio archivo. La
traducción ocurre en un solo lugar (`adjustmentCodeFor`), al construir el documento que se transmite.

La factura guardaba el `CodigoModificacion` dominicano —un `enum` de los cinco códigos de la DGII—
en todos los mercados: la nota de un contribuyente chileno o peruano llevaba un número dominicano, el
borde HTTP lo aceptaba de cualquier inquilino y, cuando nadie decía por qué, el servidor lo deducía
del importe. La misma taxonomía sirve ahora a las dos notas y una sola familia de claves las nombra
(`invoices.adjustment_reason.*`), así que el motivo se lee igual en la pantalla, en el documento y en
la declaración.

### 2.10 Compras

El número del documento del proveedor es **de su mercado**: un NCF dominicano, el folio fiscal de un
CFDI, la clave de acceso de una NF-e, el CUFE de la DIAN, o el número de factura del propio
proveedor donde ninguna autoridad numera nada. La columna se llama por lo que es
(`supplier_fiscal_number`), el mercado declara su regla (`purchases.receivedDocument.check`) y el
servicio la aplica sin saber de qué país se trata:

| Estado de la comprobación | Qué significa | Qué hace el producto |
|---|---|---|
| `ok` | El número pasa la regla del mercado | Se guarda en la forma canónica del mercado |
| `invalid` | La regla lo rechaza, con un motivo del propio mercado (`format`, `check_digit`, `unknown_type`…) | Se rechaza nombrando a la autoridad, nunca se guarda |
| `unverified` | El mercado no publica una forma que el producto verifique | Se guarda tal como está impreso y la pantalla dice que no se verificó |
| `missing` | No hay número | La compra se registra sin él |

Lo que la autoridad pregunta **además** de las cifras y del documento vive en `fiscal_attributes`,
bajo las claves que el mercado declara (`purchases.fiscalAttributes`, el mismo `FiscalFieldSpec` que
los datos de registro de §2.2). El servidor valida contra esa declaración y **rechaza una clave que
el mercado no pregunta**, así que un cliente no puede colar datos en la columna, y el formulario se
dibuja a partir de la misma declaración: un mercado que pregunta otra cosa la pregunta en pantalla
sin tocar una línea del cliente.

Reglas que esto fija:

- **Nada se supone.** Registrar la compra valida las claves, no exige las respuestas; la declaración
  que necesita una clasificación **se niega a presentar la compra sin ella y la nombra**
  (`compliance.report_606_purchase_not_classified`), y la respuesta se da después, en la ficha de la
  compra (`PATCH /accounts-payable/:id/fiscal-attributes`), que es cuando la tiene quien concilia la
  declaración. Antes la columna traía `DEFAULT '06'`: cada compra de cada mercado quedaba clasificada
  como «compra de mercancías» dominicana y el 606 presentaba esa suposición.
- **Cómo se pagó es un método de pago de la empresa**, como en ventas: `payment_method_code`. El
  código que la autoridad le da al método vive en el método (`payment_methods.fiscal_code`), no en
  cada compra.
- **El documento del proveedor identifica una sola compra viva** por (identificador del emisor,
  número), en todos los mercados: la regla la aplica el servicio y la impone la base
  (`UQ_vendor_bills_issuer_fiscal_number`). La clave admite el número más largo que emite cualquier
  mercado —96 caracteres de un CUFE, 44 dígitos de una NF-e—, no los 19 de un NCF.
- **Un mercado publica un ejemplo de su número** (`receivedDocument.example`) y el catálogo exige que
  su propia regla lo acepte. De ahí salen el marcador del formulario y la fila de ejemplo de la
  plantilla de importación, que mostraba un RNC y un comprobante dominicanos a cualquier empresa.

### 2.11 Facturación electrónica

Un documento electrónico recorre cuatro pasos en todos los mercados que tienen régimen: **construir**
el documento en el esquema de la autoridad, **sellarlo** con el certificado del contribuyente,
**transmitirlo** y **conciliar** el veredicto que llega horas después. Cada régimen es un adaptador
(`FiscalRegimeAdapter`, en `einvoicing/regimes/<cc>/`) que responde esos cuatro pasos y nada más; el
resto —cuándo se intenta, cuántas veces, con qué espera, qué se guarda— es de un solo buzón
(`fiscal_submissions`, `FiscalSubmissionService`).

El régimen dominicano era la excepción: tenía su propia tabla (`ecf_submissions`), su propio
orquestador, su propio reconciliador y sus propios estados, mientras seis regímenes compartían el
otro camino. Dos tuberías para lo mismo y dos respuestas a «¿dónde está este documento ante su
autoridad?», según el país. Ahora la DGII es un adaptador como los demás (`regimes/do/`), y lo que
era dominicano —el XML del esquema de la DGII, el perfil XMLDSig, los servicios de recepción y
consulta, el código de seguridad, el QR de la representación impresa— sigue estando, dentro de ese
adaptador.

Lo que el contrato aprendió de la DGII, porque no son hechos dominicanos:

| Estado | Qué significa | Quién más lo tiene |
|---|---|---|
| `ACCEPTED_WITH_OBSERVATIONS` | La autoridad lo aceptó con observaciones; el documento vale y las observaciones son del contribuyente | «Aceptado Condicional» en la DGII, un CDR aceptado con observaciones en SUNAT |
| `CONTINGENCY` | Se emitió sin poder alcanzar a la autoridad: la venta ocurrió, el número se gastó, el documento se debe | Contingência en Brasil, contingencia en Ecuador |

Y tres reglas que el adaptador declara en lugar de que el núcleo las suponga:

- **Preguntar antes de reenviar.** Tras una conexión cortada la autoridad puede tener ya el
  documento. Desde el segundo intento (`FiscalRegimeContext.attempt`) el régimen que puede
  preguntarlo lo pregunta y adopta lo que encuentra, porque transmitir dos veces es como una venta
  termina con dos documentos fiscales.
- **El canal es del régimen.** Casi todos necesitan un endpoint y una credencial que el inquilino
  configura; la DGII publica sus endpoints y autentica con el certificado del contribuyente, así que
  su canal ES ese certificado (`isTransmissionConfigured`). Exigirle un endpoint configurado
  bloquearía cada e-CF dominicano.
- **Dónde se verifica el documento.** El QR de la representación impresa, la consulta por clave de
  acceso del SRI, el QR de la NFC-e: `verification_url`, derivado del documento ya **sellado**, para
  que lo que el portal resuelva sea lo que se transmitió.

**Lo que no es un documento.** Una autoridad también recibe declaraciones *sobre* documentos: el
veredicto de quien recibió uno (la aprobación comercial dominicana, la manifestação do destinatário
brasileña, el acuse de recibo y aceptación colombiano) y los números autorizados que nunca se usarán
(la anulación de e-NCF, la comunicación de baja peruana, la inutilização brasileña). Eso vive en
`fiscal_document_events`, con las mismas columnas neutrales y el mismo vocabulario de estados que un
envío, y con el país y el régimen en cada fila. El veredicto se guarda como el hecho —`ACCEPTED`,
`REJECTED`— y cada mercado escribe el código de su autoridad
(`MarketDocuments.counterpartyVerdictCodes`); la columna guardaba el `1` y el `2` de la DGII para
todos los mercados.

El servicio que construye y transmite esos eventos sigue siendo **uno**, el de la DGII
(`regimes/do/dgii-document-events.service.ts`), porque es el único régimen que los escribe hoy. No
se le inventó un contrato: un contrato con una sola implementación no se puede validar, y el de los
adaptadores de régimen se ganó su lugar cuando hubo siete. Cuando un segundo mercado escriba eventos,
el contrato saldrá de las dos implementaciones, como salió el de los envíos.

**Una nota nombra el documento que corrige.** Una nota de crédito o de débito sólo se entiende al
lado del documento que corrige, y cada autoridad lo pide con sus propias palabras. Siete regímenes la
construían sin ninguna: la nota viajaba como un documento que se sostiene solo, que la autoridad
rechaza o archiva contra nada —y un crédito que la autoridad no puede ligar a su factura es un
crédito que el contribuyente no puede probar (FAC-INV-05 / MP-10). Ahora la referencia se resuelve
una vez (`modifiedDocumentOf` → `ModifiedDocumentReference`: qué documento, de qué fecha, con qué
número, con qué identificador de su régimen y por qué motivo) y cada régimen escribe sus propios
elementos:

| Mercado | Lo que escribe la nota |
|---|---|
| DO | `eNCFModificado`, `fechaEmisionModificado`, `codigoModificacion` |
| CO | `cac:DiscrepancyResponse` (`ReferenceID`, `ResponseCode`, `Description`) y `cac:BillingReference` con el CUFE |
| PE | `cac:DiscrepancyResponse` con el catálogo 09 o 10 según la nota, y `cac:BillingReference` con su tipo |
| CL | `Referencia` (`TpoDocRef`, `FolioRef`, `FchRef`, `CodRef`, `RazonRef`), antes del timbre |
| EC | `notaCredito`/`notaDebito` con `codDocModificado`, `numDocModificado`, `fechaEmisionDocSustento` y el `motivo` en palabras |
| MX | `cfdi:CfdiRelacionados` con el `TipoRelacion` del catálogo y el UUID que timbró el PAC |
| BR | `NFref/refNFe` con la chave de acesso, `finNFe` 4 (devolução) o 2 (complementar) |
| AR | `CbtesAsoc` con el tipo, el punto de venta, el número y la fecha del comprobante asociado |

Nada se adivina: la nota se rechaza —antes de sellar nada— cuando no nombra documento alguno, cuando
el régimen la referencia por número y ese documento no lo tiene, cuando la referencia es por
identificador y el original nunca se transmitió, y cuando el mercado no publica un código para el
motivo que se le indicó.

**Los códigos del motivo son por clase de nota.** SUNAT publica el catálogo 09 para las notas de
crédito y el 10 para las de débito, y «otros conceptos» es `10` en el primero y `03` en el segundo;
los conceptos de nota débito de la DIAN llegan hasta `4` y el `5` es de una nota crédito; el
`TipoRelacion` del SAT es `01` para un crédito y `02` para un débito del mismo documento. Un solo
registro por mercado escribía el código de crédito en una nota de débito —en dos de esos catálogos,
un código que no existe—, así que `MarketDocuments.adjustmentCodes` tiene un catálogo por clase
(`creditNote`, `debitNote`) y `adjustmentCodeFor` lee el de la clase que se emite. Donde la autoridad
publica uno solo para las dos (la DGII, el SII) los dos registros lo dicen, en lugar de suponerlo. Y
donde no publica ninguno —el SRI pide el motivo en palabras, AFIP sólo el comprobante asociado— el
mercado declara `null` y la nota lleva lo que escribió quien la emitió.

**El número que asigna la autoridad al transmitir.** AFIP no autoriza un número que el contribuyente
sacó de un rango: el contribuyente pide el siguiente de su punto de venta y AFIP lo autoriza junto
con el CAE, así que el documento no TIENE número hasta que el intercambio sale bien. El régimen lo
informa (`SealedFiscalDocument.assignedNumber`) y el buzón lo escribe en el documento sólo cuando la
autoridad lo aceptó, y sólo si no tenía número: sin eso el producto nunca se enteraba de qué número
autorizó la autoridad para su propio documento, que es además el que una nota posterior debe nombrar.

Con la referencia escrita, cuatro mercados más emiten nota de débito por su régimen: México (un
ingreso relacionado con `TipoRelacion` `02`), Brasil (una NF-e complementar), Argentina (2, 7, 12) y
Ecuador (`notaDebito`).

**El canal de un inquilino es suyo, también en la República Dominicana.** Un régimen necesita un
endpoint y una credencial que el inquilino configura en su propia fila (`fiscal_regime_settings`,
cifrada en reposo); el proceso solo puede configurar un canal si el despliegue lo autoriza
explícitamente (`EINVOICE_PROCESS_CREDENTIALS=allow`), porque en un SaaS una credencial compartida es
el defecto y no un respaldo. La DGII era la excepción: el ambiente ya es de cada empresa, pero las
variables `DGII_ECF_*_URL` se leían en cualquier proceso, así que una variable apuntaba a un host a
todas las empresas. Ahora siguen la misma regla única: valen en un proceso de desarrollo, o cuando el
despliegue lo autoriza con ese mismo interruptor; en cualquier otro caso se ignoran y se avisa
nombrándolas, porque un override que no hace nada en silencio es como un despliegue cree estar
declarando donde no declara. El canal dominicano es entonces lo que siempre fue: el ambiente de la
empresa y su certificado. El timeout HTTP no es un canal y sigue siendo del proceso.

La puerta de neutralidad cuenta el vocabulario de una autoridad dondequiera que esté, incluidos estos
adaptadores, para que la deuda sea visible mientras no vivan donde el plan los quiere. Esos campos
subieron el baseline de 723 a 738 el 2026-11-12: la razón está escrita en
`tools/verify/country-neutrality.baseline.json` y es la de arriba —los campos son el arreglo, no la
deuda.

Los adaptadores viven en `einvoicing/regimes/<cc>/` y no en `markets/<cc>/`: necesitan las entidades
del documento (factura, líneas, cliente, organización) y `markets/` no depende de ningún módulo de
negocio (§2.4). El paquete del mercado declara la **política** —si la ley lo exige, cómo se llama el
régimen, qué cobertura tiene (`markets/<cc>/einvoicing.ts`)— y el adaptador la implementa.

### 2.12 Declaraciones

Una declaración es lo menos portable que publica una autoridad: el 606 de la DGII son veintitrés
casillas separadas por barras en un orden fijo, la balanza del SAT es un XML validado contra su XSD
con sus propios códigos agrupadores, y ni siquiera coinciden en qué es un período. No puede haber un
generador genérico; lo que sí puede haber es un **motor** genérico —que sabe reunir los hechos de un
período y nada de ninguna autoridad— y un generador por mercado que convierte esos hechos en el
archivo de la suya.

Así queda repartido:

- el núcleo arma `ReturnDataset` (`compliance/returns/return-dataset.ts`): lo que la empresa emitió,
  lo que recibió, lo que pagó al exterior, su catálogo de cuentas con el movimiento del período y sus
  asientos, como datos planos y en el orden en que se leen. Cada parte se carga cuando un generador
  la pide, así que el 606 nunca lee un asiento y la balanza nunca lee una factura;
- cada mercado declara sus `filings` (`markets/<cc>/returns.ts` → `markets/<cc>/returns/`): el código
  con el que su autoridad la llama, su etiqueta, su periodicidad, su tipo de archivo, si el
  calendario la sigue mes a mes, qué le pide a la empresa además del período y cómo se construye;
- el motor (`ReturnsService`) resuelve la declaración por el mercado de la empresa, comprueba esos
  datos contra la propia declaración y entrega el archivo con el nombre que su autoridad le da.

Antes, las cuatro declaraciones dominicanas eran cuatro métodos del módulo de ventas que leían
`Repository<Invoice>`, cada uno con un `if (country !== 'DO')` escrito a mano arriba —porque sin él
cualquier inquilino podía pedir un 607—, y los tres documentos mexicanos eran otros tres con su
propia ruta. Agregar las declaraciones de Perú o de Chile era editar ese módulo; hoy es agregar un
archivo al paquete de ese mercado.

**Lo que no se adivina.** Un generador no lanza excepciones: devuelve el archivo o **devuelve el
motivo** por el que no puede construirlo (`ReturnRefusal`), y el motor lo convierte en el error que
el inquilino lee. Es la misma idea de siempre —un 606 con una compra que nadie clasificó, o con un
proveedor sin RNC, lo rechaza la DGII entero— y enterarse al subirlo el día del vencimiento es peor
que enterarse aquí. Cuántos registros declara el archivo lo dice el propio generador, que los
construyó: contar líneas después de una cabecera funcionaba para un formato de texto y necesitaba un
caso especial por documento XML, que es como el núcleo terminó conociendo los nombres de los
elementos del SAT.

**La pantalla.** Una sola, sin ramas por país: pide al servidor qué declara este mercado y dibuja el
calendario con las que tienen vencimiento mensual, un panel aparte para las que la autoridad pide
cuando audita o devuelve, y un campo por cada dato declarado —`CHOICE` con sus valores publicados,
`DATE`, texto—. Llevaba la lista dentro (los cuatro formatos dominicanos, los tres documentos
mexicanos y un `switch` entre ellos), así que un mercado nuevo no declaraba nada hasta editarla.

## 3. Cómo se agrega o se completa un mercado

1. Copiar el paquete de un mercado con la misma cobertura y responder cada archivo. Por ejemplo,
   `markets/uy/` para un mercado solo contable, o `markets/mx/` para uno con facturación
   electrónica. «No aplica» y «no implementado» son respuestas válidas; dejar un archivo sin
   responder no lo es, y `market-structure.spec.ts` lo rechaza.
2. Registrar `markets/<cc>/index.ts` en `markets/catalogue.ts`, el único archivo que importa
   paquetes.
3. Agregar el parche regional `libs/shared/locales/src/regional/<locale>.json`.
4. Para una capacidad nueva, por ejemplo la facturación electrónica de Guatemala (FEL):
   - implementar en `markets/gt/einvoicing/` los puertos de `markets/contracts/einvoicing.ts`;
   - declararla en `einvoicing.ts`.
   El motor, el outbox, la pantalla de ajustes y la cobertura funcionan sin tocar otra línea.

Ningún paso toca un módulo de negocio. Si hace falta tocar uno, falta un puerto en el contrato y
eso se resuelve en el contrato, no con una rama.

## 4. Alternativas descartadas

- **Una carpeta por capacidad dentro de cada módulo** (`einvoicing/regimes/<cc>`,
  `payroll/engines/<cc>`, …). Es más barata hoy, pero el conocimiento de un país sigue repartido y
  los constructores siguen acoplados a las entidades del ORM. Es el estado actual, y produjo la §1.
- **Mercados como datos en la base, editables por un operador.** Los catálogos de la autoridad
  tienen base legal y cambian por norma. Se revisan en código, con pruebas, y llegan a la base
  como proyección. Lo editable por la empresa (tasas, formas de pago, rangos) ya es dato del tenant.
- **Un módulo de negocio `mercados` por encima de los demás**, que registre implementaciones en
  tiempo de ejecución. Las migraciones y el seed de aprovisionamiento necesitan los datos del
  mercado fuera de la inyección de dependencias, así que el catálogo tiene que ser plataforma.

## 5. Consecuencias

- Saber cómo está configurado un país es abrir una carpeta.
- Agregar un mercado no toca el núcleo, y una omisión la detecta una prueba, no un cliente.
- La República Dominicana pierde su vía propia. Es el mercado con más uso, así que la unificación
  migra datos (`ecf_submissions`, `ncf_sequences` y columnas de `vendor_bills`) con migraciones
  probadas contra PostgreSQL en las dos direcciones, y se verifica en vivo con tenants `QA-`.
- Las implementaciones de formato pasan a recibir vistas neutrales. Es una reescritura mecánica
  de los ocho constructores, cubierta por sus pruebas actuales.

## 6. Reglas que esta arquitectura vuelve verificables

1. Ningún archivo fuera de `markets/`, de los parches regionales y de las migraciones contiene un
   término, una comparación de código o un texto propio de un país.
2. Ningún archivo fuera de `markets/` importa `markets/<cc>/`.
3. Ningún valor por omisión es de un país: ni moneda, ni zona horaria, ni idioma, ni formas de pago.
   Lo que no se sabe se pide o se toma del mercado del tenant.
4. Toda capacidad de todo mercado tiene un estado declarado.
5. Todo código de la autoridad tiene base legal y vigencia.

## 7. Glosario

- **Mercado:** un país donde se vende el producto, identificado por su código ISO 3166-1 alfa-2.
- **Capacidad:** algo que el producto hace de forma distinta según el mercado: identidad, impuestos,
  documentos, compras, pagos, contabilidad, nómina, declaraciones o facturación electrónica.
- **Motor:** el código genérico de un módulo de negocio que ejecuta una capacidad leyendo al mercado.
- **Vista neutral:** la forma en que un motor entrega a un mercado los datos de un documento, sin
  entidades del ORM.

## 8. Plan y avance

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Este documento; tareas del programa | ✅ |
| 1 | `markets/`: contrato, registro, mercado neutral, 19 paquetes con la estructura canónica, consultas genéricas (`markets/queries`), datos consolidados desde `localization/fiscal/*` y `contracts/country-pack` (retirados); los consumidores leen el registro; pruebas de estructura y de catálogo; puerta estricta con regla de import | ✅ |
| 2 | Documentos y numeración: un adaptador genérico guiado por la política de numeración del mercado; fuera el `switch` de `FiscalAdapterFactory`; `ncf_sequences` → `fiscal_document_ranges`; motivos de ajuste canónicos en lugar de `ModificationCode`; tipos de nota de crédito y débito de todos los regímenes | ✅ Motor único con la política de cada mercado, rangos unificados con reglas comunes, consecutivo y serie en el documento, pantalla y API únicas (§2.8); motivos de ajuste canónicos traducidos por el mercado (§2.9). Los constructores de los seis regímenes que todavía no referencian el documento modificado son parte de la fase 3 |
| 3 | Facturación electrónica: DO entra al buzón único (`fiscal_submissions`); los constructores quedan como adaptadores de régimen con un solo contrato; `ecf_lifecycle_messages` → `fiscal_document_events`; las variables `DGII_*` pasan a la configuración de transmisión del tenant | ✅ La DGII es un adaptador (`regimes/do/`), una sola tabla de envíos, un solo reconciliador, un solo estado y una sola pantalla; fuera la expresión regular del e-NCF de la entidad genérica; el canal lo declara cada régimen; `fiscal_document_events` con el veredicto como hecho y el código escrito por el mercado; los siete regímenes referencian el documento que la nota corrige, con el código del catálogo de su clase, y AFIP escribe el número que autoriza; ninguna variable del proceso decide el canal de un inquilino, en ningún régimen (§2.11) |
| 4 | Compras: columnas neutrales y `fiscal_attributes` en `vendor_bills` con migración de datos; validación del documento recibido por el mercado; formulario dinámico | ✅ Columnas neutrales con migración exacta en los dos sentidos, `fiscal_attributes` validado contra la declaración del mercado, documento del proveedor comprobado por la regla de cada mercado, método de pago de la empresa en lugar de la «forma de pago» de una autoridad, formulario y ficha dibujados desde el paquete público del mercado (§2.10) |
| 5 | Declaraciones: registro de generadores; 606/607/608 y la contabilidad electrónica de MX como generadores de mercado sobre conjuntos de datos neutrales; API y pantalla genéricas | ✅ `ReturnDataset` con los hechos del período y `MarketReturnFiling` por mercado; los cuatro formatos de la DGII en `markets/do/returns/` y los tres documentos del SAT en `markets/mx/returns/`; una ruta (`/compliance/returns`), un calendario y un formulario de datos declarados; el motivo del rechazo lo devuelve el generador y el conteo de registros también (§2.12) |
| 6 | Nómina: motor dominicano a `markets/do/payroll/`, registro de motores y sin `'DOP'` por omisión | ⏳ |
| 7 | Cliente: sin ramas por país; pantallas guiadas por la definición pública del mercado | ⏳ |
| 8 | Textos: base neutral y parches regionales para los 19 mercados, con prueba de completitud | ⏳ |
| 9 | Puerta de neutralidad en cero, con la lista permitida reducida a `markets/`, parches regionales y migraciones | ⏳ |
