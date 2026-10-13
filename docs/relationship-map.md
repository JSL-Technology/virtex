# Mapa de relaciones

El equivalente del *Relationship Map* de SAP Business One: dado un documento, dibuja toda la
cadena a la que pertenece. Muestra de dónde viene, en qué se convirtió, quién lo pagó y qué
contabilizó. Cada flecha dice qué vínculo es. Desde el mapa se abre cualquier documento de la
cadena.

## Cómo se usa

- **Desde un documento.** Factura, cotización, orden de compra, requisición, recepción, factura de
  proveedor, nota de débito, pago a proveedor, asiento, ajuste de inventario, nómina y activo fijo
  llevan en la barra el botón **«Mapa de relaciones»**. Los armazones `vx-document-shell` y
  `vx-draft-shell` lo pintan solos cuando reciben `relationshipMapType` y `relationshipMapId`.
- **Desde el menú** (Análisis → Mapa de relaciones). Se abre un buscador por número de documento
  que recorre todos los tipos que el usuario puede leer.
- **En el mapa:**
  - Un clic selecciona un documento: se resaltan sus vínculos y el panel lateral muestra sus
    datos y relaciones. Doble clic o «Abrir documento» lo abre en su pestaña.
  - «Ver su mapa» vuelve a centrar el mapa en ese documento.
  - «Asientos» oculta o muestra los asientos contables. «Profundidad» controla cuántos saltos se
    recorren.
  - «Lista» muestra la misma cadena como tabla. Exportar genera un CSV.
- La pestaña del mapa **no es una vista previa**: los documentos que se abren desde él tienen su
  propia pestaña y el mapa sigue abierto (`previewable: false` en el manifiesto).

## Documentos y vínculos

| Área | Documentos |
| --- | --- |
| Ventas | Oportunidad, cotización, factura (con notas de crédito y débito), recibo de cobro, venta POS, e-CF |
| Compras | Requisición, orden de compra, recepción, factura de proveedor, nota de débito, pago a proveedor |
| Finanzas | Asiento contable, transferencia bancaria, operación intercompañía |
| Inventario / RR.HH. / Activos | Ajuste de inventario, nómina, activo fijo |

Las categorías de vínculo se dibujan de forma distinta:

- **Flujo:** línea continua.
- **Pago:** línea verde.
- **Contabilización:** línea discontinua.
- **Reversión:** punteado rojo.
- **Corrección:** ámbar.

Los estados se normalizan a borrador, por aprobar, abierto, cerrado o anulado mediante un mapa
**explícito** por tipo, sin heurísticas. La prueba de integridad exige que cada valor de cada enum
esté mapeado.

## Arquitectura

```
relationship-map/ (backend, capa «reportes»)
  contracts/document-flow.contracts.ts   contrato de red (el cliente lo replica)
  document-flow.specs.ts                 registro declarativo: tipos, estados, permisos, vínculos
  document-flow.catalog.ts               compila el registro contra los metadatos de TypeORM al arrancar
  document-flow.service.ts               motor: recorrido, seguridad, búsqueda
  relationship-map.controller.ts         GET types · GET search · GET :type/:id
```

- **No importa ningún otro módulo.** El registro nombra entidades y propiedades como texto. El
  catálogo las resuelve a tablas y columnas reales con los metadatos de TypeORM. Si un nombre deja
  de existir, el error sale al arrancar (en el log) y en `document-flow.specs.spec.ts`; la petición
  del usuario no falla.
- **Escala con la profundidad, no con el número de documentos.** El recorrido es en anchura y por
  niveles: en cada nivel hay una sentencia por tipo de vínculo sobre todo el frente
  (`= ANY($1::uuid[])`) y una por tipo para describir los documentos nuevos. Un mapa típico son
  unas 17 sentencias y 10–20 ms.
- **Una sola instantánea.** Todo corre en una transacción `READ ONLY, REPEATABLE READ` con
  `statement_timeout` (8 s; si salta, se devuelve un 422 legible).
- **Límites:**
  - Profundidad 8 por defecto, 20 como máximo.
  - 150 nodos por defecto, 400 como máximo.
  - 60 vínculos del mismo tipo por documento.
  - La respuesta dice cuál se alcanzó (`truncation`) y el cliente ofrece «Ampliar».
- **Asientos como «hub».** Un asiento por el que el recorrido solo pasa no se expande hacia otros
  documentos (por ejemplo, otros activos depreciados en el mismo asiento). Solo sigue hacia otros
  asientos, como su reversión. Abierto directamente, sí muestra todo lo que se contabilizó en él.

## Seguridad

- **Inquilino.** Cada sentencia filtra por organización, además de las políticas RLS. Las tablas
  puente sin columna de inquilino se filtran a través de la tabla del documento padre.
- **Permisos por documento.** `relationship_map:view` da acceso al mapa. Lo que se ve de cada nodo
  depende del permiso de su módulo (`invoices:view`, `accounts_payable:view`, `payroll:view`…) y
  del alcance por sucursal del usuario. Un nodo sin acceso se dibuja «Sin acceso»: sin número,
  importe, tercero, fecha, estado ni descripción, y no se puede abrir. Si el documento raíz no es
  accesible, la respuesta es un 403.
- **Entrada.**
  - `:type` se valida contra los valores del enum (`FlowDocumentTypePipe`), así que `__proto__`
    ya no pasa.
  - `:id` debe ser un UUID.
  - `depth` y `limit` se validan y además se acotan en el servicio.
  - Toda columna o tabla que llega al SQL viene de los metadatos y pasa una lista blanca de
    identificadores.
- **Throttling:** 60 mapas/min y 120 búsquedas/min por usuario.
- **CSV:** las celdas de texto que empiezan por `= + - @` se neutralizan (inyección de fórmulas).

## Añadir un tipo de documento

1. Añade el valor a `FlowDocumentType` (backend) y a `FlowDocumentType` en
   `features/relationship-map/data/relationship-map.models.ts` (cliente).
2. Declara su `NodeSpec` en `document-flow.specs.ts`:
   - entidad y módulo;
   - permiso de lectura;
   - propiedades de número, fecha, estado, total y tercero;
   - `statusMap` exhaustivo, cuyos valores se añaden también a `ENUM_VALUES` en la prueba.
3. Declara sus vínculos en `EDGE_SPECS`: `fk` si una tabla guarda el id del otro documento,
   `junction` si es una tabla puente.
4. Cliente: icono y ruta en `relationship-map.registry.ts`; si tiene pantalla, pasa
   `relationshipMapType` y `relationshipMapId` a su armazón.
5. Textos: `relationship_map.doc.<tipo>` y, si hace falta, `relationship_map.rel.<vínculo>` en
   `libs/shared/locales/src/base/relationship_map.json`, más las familias en `composed-keys.json`.
   Después, `npm run i18n:build`.
6. `npx jest apps/backend/api/src/app/relationship-map`: la prueba de integridad falla si algún
   nombre no existe.
