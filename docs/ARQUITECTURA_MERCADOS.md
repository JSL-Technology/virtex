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
  - `vendor_bills`: `supplier_fiscal_number`, `supplier_document_type`,
    `modified_supplier_fiscal_number` y `supplier_document_key`.
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
| 3 | Facturación electrónica: DO entra al outbox genérico (`fiscal_submissions`, `fiscal_document_events`); los constructores se mudan a `markets/<cc>/einvoicing/` y reciben vistas neutrales; las variables `DGII_*` pasan a la configuración de transmisión del tenant | ⏳ |
| 4 | Compras: columnas neutrales y `fiscal_attributes` en `vendor_bills` con migración de datos; validación del documento recibido por el mercado; formulario dinámico | ⏳ |
| 5 | Declaraciones: registro de generadores; 606/607/608 y la contabilidad electrónica de MX como generadores de mercado sobre conjuntos de datos neutrales; API y pantalla genéricas | ⏳ |
| 6 | Nómina: motor dominicano a `markets/do/payroll/`, registro de motores y sin `'DOP'` por omisión | ⏳ |
| 7 | Cliente: sin ramas por país; pantallas guiadas por la definición pública del mercado | ⏳ |
| 8 | Textos: base neutral y parches regionales para los 19 mercados, con prueba de completitud | ⏳ |
| 9 | Puerta de neutralidad en cero, con la lista permitida reducida a `markets/`, parches regionales y migraciones | ⏳ |
