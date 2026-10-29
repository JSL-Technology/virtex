# Auditoría de la «ventana de ajuste»: arquitectura de la información, UX y UI

**Fecha:** 2026-10-29 · **Rama:** `ccr-03234051-jlgxrp` · **Método:** aplicación servida en local y recorrida con un navegador real (Playwright/Chromium), más lectura del código de cada ventana.
**Evidencia:** capturas en [`2026-10-ventana-de-ajuste/capturas/`](2026-10-ventana-de-ajuste/capturas/), mediciones en [`mediciones.json`](2026-10-ventana-de-ajuste/mediciones.json) y [`config-secciones.json`](2026-10-ventana-de-ajuste/config-secciones.json), y scripts reproducibles en [`harness/`](2026-10-ventana-de-ajuste/harness/) (cada hallazgo cita el script que lo reproduce).

> Este documento es solo diagnóstico. No se modificó código de la aplicación.

---

## 12. Resumen ejecutivo

1. «Ventana de ajuste» corresponde a **cuatro** pantallas. Por orden de riesgo: **Ajuste de inventario**, **Ajuste de auditoría** (contable), **Configuración general** (añadida a petición del usuario durante la auditoría) y **Ajustes de la caja** del POS.
2. **El ajuste de inventario funciona de punta a punta con datos reales**: existencias, kárdex y asiento cuadran con mis cuentas. Aun así tiene cinco defectos que producen **ajustes incorrectos sin que la persona lo note**:
   - el conteo se aplica contra un saldo que cambió después de contar (vi −2 en pantalla y se registró +8);
   - acepta fechas de 2019 o de 2031, y al contabilizar **crea ejercicios contables enteros** sin preguntar;
   - el kárdex y el asiento quedan con fechas distintas;
   - nada muestra el impacto antes de confirmar;
   - **no hay forma de revertir** un ajuste contabilizado.
3. **El ajuste de auditoría no sirve para su único propósito.** Al proponer un ajuste sobre un ejercicio cerrado, la API responde **HTTP 500** y la pantalla dice «No se pudo proponer el ajuste.». Además, los totales muestran `0.30000000000000004`.
4. **La Configuración general** reúne 26 secciones sin buscador:
   - tiene tres modelos de guardado distintos;
   - descarta los cambios sin avisar al pulsar Escape, hacer clic fuera o cambiar de sección;
   - «Guardar cambios» se queda deshabilitado sin explicar por qué;
   - el foco se escapa del diálogo;
   - **en móvil es inutilizable**: el contenido queda en 105 px.
5. **Ajustes de la caja (POS)** es la mejor resuelta. Solo le falta un mensaje de error en el campo de la terminal.
6. **Nota global por ventana** (topada por los ejes de completabilidad y de veracidad):
   - Inventario **4/10**
   - Auditoría **1/10**
   - Configuración **4/10**
   - Caja POS **6/10**
7. **Recomendación:** rehacer el ajuste de inventario como documento de conteo con vista previa de impacto y reversa; arreglar y rediseñar el ajuste de auditoría; reordenar la Configuración con buscador, un solo modelo de guardado y protección de cambios.

---

## 1. Entorno y límites

| Aspecto | Valor |
|---|---|
| Infraestructura | Postgres 16 y Redis 7 **instalados en el contenedor** (`pg_ctlcluster`, `redis-server`). El README propone `docker run …`, pero el contenedor no tiene demonio Docker (`failed to connect to the docker API at unix:///var/run/docker.sock`). El propio README admite «o usa tus propias instancias». |
| Pasos | `npm ci --legacy-peer-deps` → `npm run migration:run` → `DEV_SEED=true DEV_SEED_PASSWORD=… npm run dev:api` → `npm run dev:web` → `npm run dev:pos`. Todo funcionó como dice la documentación. La única desviación: `npm run migration:run` falla con `typeorm-ts-node-commonjs: not found` si se ejecuta antes de que termine `npm ci`, que es lo esperable. |
| URLs | API `http://localhost:3000/api/v1`, portal `http://localhost:4200/e/virtex-dev/…`, POS `http://localhost:4300` |
| Organización | «Virtex Dev» (DO, RD$), sembrada en esta sesión sobre una base de datos vacía. Todos los datos de prueba llevan el prefijo **QA-7734**: dos almacenes, cinco productos, un rol y un usuario. |
| Roles | **Administrador** (`dev@virtex.local`). **QA-7734 Consulta inventario**, un rol creado con solo `products:view` e `inventory:view_stock` (`qa7734.consulta@example.test`, dominio reservado, sin entrega real). |
| Idiomas | es (principal), en y pt (pasada de contenido sobre las ventanas de ajuste) |
| País | Solo DO. **El país de la organización no se puede cambiar** («El país no se puede cambiar…»). No probé otra organización de otro país; ver §11. |
| Tema | Claro y oscuro |
| Tamaños | 1920×1080, 1440×900 (base), 1366×768, 768×1024, 375×812, y 720×450 como equivalente de zoom al 200 % |
| Herramientas | Playwright, axe-core 4.10.2 (inyectado), estilos computados por JavaScript, inspección de la red, SQL de solo lectura sobre la base local |

**Acciones sobre datos que no eran de prueba, y cómo se revirtieron:**

- **Cuenta de ajuste de inventario.** La cambié de 5150 a 5900 para verificar el efecto y la restauré a 5150 en el acto. Quedó auditada con antes y después.
- **Ejercicio 2019.** Lo creó el propio sistema a raíz de mis pruebas (hallazgo INV-02). Lo cerré para poder probar el ajuste de auditoría. Es reversible con «reabrir ejercicio».
- **Período «Agosto 2031».** También lo creó el sistema a raíz de mis pruebas. No pude cerrarlo por la API porque exige cerrar antes los períodos anteriores (empezando por enero de 2019), así que lo marqué `CLOSED` con SQL directo sobre la base local para probar el rechazo por período cerrado.

**Fuera de alcance (anotado sin investigar):**

- **Usuario con permisos solo de inventario.** Tras activar su cuenta aterriza en `/unauthorized` porque no puede ver el Inicio.
- **Advertencia de compilación.** `dockview.css` produce `@charset` inválido.
- **Rótulo ambiguo.** El título del asiento (`Asiento contable`) no muestra su número.

---

## 2. Inventario de ventanas de ajuste

| # | Nombre visible | Módulo | Ruta | Forma | Qué hace | Efectos | Roles |
|---|---|---|---|---|---|---|---|
| **A** | **Nuevo ajuste / AJ-AAAA-NNNNNN** (lista: «Ajustes de inventario») | Inventario › Documentos | `/inventory/adjustments`, `/new`, `/:id` | Página en pestaña (*draft shell*) | Conteo físico, merma o revaluación de costo; borrador → contabilizado o anulado | Movimiento en el kárdex, saldo por almacén, costo promedio, asiento (Inventario contra la cuenta de ajuste) | Ver: `inventory:view_stock`. Crear y contabilizar: `inventory:adjust` |
| **B** | **Nuevo ajuste de auditoría** (lista: «Ajustes de auditoría») | Contabilidad › Documentos | `/accounting/audit-adjustments`, `/new` | Página en pestaña | Asiento que corrige un ejercicio cerrado, con aprobación | Asiento en un ejercicio cerrado (si funcionara), solicitud de aprobación y evidencia | Ver: `audit:view_trail`. Proponer: `audit:propose_adjustment` |
| **C** | **Configuración** (menú de usuario › Configuración) | Transversal | `#settings/<sección>` sobre cualquier ruta | Modal grande, 1067×768 a 1440×900 | 26 secciones de la cuenta, la organización, las finanzas, las operaciones y el sistema | Cambios en `organization_settings` y otras tablas, auditados | Cualquier usuario autenticado ve el modal; las secciones se filtran a medias (ver CFG-06) |
| **D** | **Ajustes de la caja** | POS (aplicación aparte) | botón ⚙ en la barra del terminal | Diálogo | Nombre de la terminal de este equipo e impresión automática del ticket | `localStorage` del equipo; cambiar de terminal cambia de turno | `pos:view` |

**Descartadas (y por qué):**

- **Reclasificación y ajustes de fin de período** (`journal-entries/adjustments/reclassify`, `period-end`) y **ajuste por inflación** (`inflation-adjustment.controller`): existen en la API pero no tienen ninguna pantalla.
- **Nómina tipo «Ajuste»**: solo es una opción del filtro de tipo de corrida (`payroll/runs`), no una ventana.
- **Conciliación bancaria**: los «saldos ajustados» son un cálculo de la conciliación, no una ventana para corregir valores.
- **«Ajustes del lienzo»** del diseñador de flujos: preferencia visual de un editor.

---

## 3. Estándar de referencia

### 3.1 Ajuste de inventario

| Convención | Odoo 17 | NetSuite | Dynamics 365 BC | QuickBooks Online | Zoho Inventory | Confianza |
|---|---|---|---|---|---|---|
| Documento propio con borrador y aplicación diferida | Conteo guardado sin aplicar, luego **Apply** / **Apply All** | Transacción *Inventory Adjustment* | *Phys. Inventory Journal* que se registra al final | Guarda y aplica | **Save as Draft** / **Convert to Adjusted** | Alta |
| Dos modos: cantidad nueva o cambio, y el otro **se calcula y se ve** | Columna *Difference* coloreada | *Adjust Qty By* → **New Quantity** visible | *Qty. (Calculated)* frente a *Qty. (Phys. Inventory)* | «Nueva cantidad» y «Cambio» se recalculan entre sí | «New quantity» y «Adjusted quantity» se autocalculan | Alta |
| Ubicación o almacén por línea y valor actual visible | Ubicación por línea | Location y valor por ubicación | Location y Bin | Ubicación (Plus/Advanced) | Warehouse | Alta |
| Motivo de un **catálogo** | Reason, opcional en Apply All | Account + Memo | Reason Code | **Adjustment Reason** con «Add new» | Reasons: alta, inactivación, no se borran | Alta |
| Cuenta contable de contrapartida visible o elegible | Ubicación de pérdida y cuenta de valoración | **Adjustment Account** obligatoria | Por grupo contable | Inventory adjustment account | Account obligatoria | Alta |
| Costo de las entradas | Costo del producto | **Est. Unit Cost** | Unit Cost | — | **Cost Price** por línea | Media |
| Detección de cambios ocurridos tras el conteo | Asistente de conflictos (*Inventory conflicts*) si la cantidad cambió desde que se contó | — | El conteo parte del *Calculated* del momento; se recomienda congelar | — | — | Media |
| Ajuste de valor separado del de cantidad | Revaluación aparte | *Inventory Revaluation* aparte | *Revaluation Journal* aparte | — | **Value Adjustment** aparte | Alta |
| Corrección posterior | Movimiento inverso | Borrar o anular la transacción con su impacto GL | Asiento inverso | Editar o borrar el ajuste | Borrar o volver a borrador | Media |

Fuentes: [Odoo 17 Count products](https://www.odoo.com/documentation/17.0/th/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/count_products.html), [NetSuite Entering an Inventory Adjustment](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_161981111273.html), [Microsoft Learn: Count, adjust and reclassify inventory](https://learn.microsoft.com/dynamics365/business-central/inventory-how-count-adjust-reclassify), [Intuit help](https://quickbooks.intuit.com/learn-support/en-us/help-article/inventory-account/track-manage-inventory-commerce-quickbooks-online/L3MOaHIjJ_US_en_US), [Zoho Inventory adjustments](https://www.zoho.com/inventory/help/items/inventory-adjustments.html), [Odoo forum: value variance before validating](https://www.odoo.com/hi_IN/forum/help-1/how-can-i-see-the-value-variance-of-an-inventory-adjustment-physical-inventory-before-validating-applying-it-170904).

**Vara de medir resultante:**

- Primero va **qué** (almacén y ubicación) y **cuándo** (fecha dentro de un período abierto).
- Luego líneas con producto, unidad, existencia actual, cantidad contada **o** cambio, y la diferencia y el valor **calculados y visibles**.
- El motivo sale de un catálogo y la cuenta de contrapartida es visible.
- Antes de aplicar se ve el **total del impacto en unidades y moneda**.
- El borrador no mueve nada. Al aplicar queda trazado (quién, cuándo, documento, asiento).
- La corrección se hace con un documento inverso.

### 3.2 Ajuste de auditoría (asiento sobre ejercicio cerrado)

| Convención | Referencia | Confianza |
|---|---|---|
| Los ajustes posteriores al cierre van a **períodos especiales** (13–16) separados de los 12 normales y fechados el último día del ejercicio | SAP S/4HANA, *Posting Period Variant* ([SAP Learning](https://learning.sap.com/learning-journeys/outlining-the-record-to-report-process-in-sap-s-4hana/using-posting-period-variants-to-control-the-opening-and-closing-of-posting-periods_e7818699-66ac-451f-8687-981376d9b6aa)) | Alta |
| Se restringen por autorización: separación entre quien propone y quien aprueba | SAP KBA 3146015 | Media |
| Como en cualquier asiento manual: cuadre visible en vivo, totales con formato monetario, cuenta, concepto, dimensiones, adjuntos y aprobación | Odoo, NetSuite y SAP | Alta |
| NetSuite reabre el período (*Allow Non-G/L Changes* / desbloqueo) en vez de usar períodos especiales | NetSuite, *Manage Accounting Periods* | Media (sin verificar en documentación en esta sesión) |

### 3.3 Configuración (del sistema o de la organización)

| Convención | Referencia | Confianza |
|---|---|---|
| **Buscador** en la configuración | Odoo (barra de búsqueda en *Ajustes* desde la v14), QuickBooks (*Account and settings* con búsqueda en la ayuda), SAP Fiori (*Manage Your Solution* con búsqueda) | Alta para Odoo, media para el resto |
| **Un solo modelo de guardado** por pantalla: barra fija «Guardar / Descartar» (Odoo) o edición por sección con lápiz y «Guardar / Cancelar» (QuickBooks) | Odoo y QuickBooks | Alta |
| Aviso de cambios sin guardar al salir | Odoo (aviso de descarte en formularios) y patrón general de formularios | Media |
| Ajustes sensibles con confirmación que explica el impacto y queda auditada | NetSuite (*Enable Features*), SAP (registro de cambios de customizing) | Media |
| Página completa o panel ancho, no un modal estrecho, cuando hay decenas de secciones | Odoo, NetSuite, Dynamics y QuickBooks usan páginas completas | Alta |

### 3.4 Preferencias de un terminal POS

Las preferencias son locales del dispositivo, con el identificador de la caja validado y un mensaje de error en línea. Confianza **media**: es convención general de formularios y no la verifiqué contra un POS concreto.

---

## 4. Mapa de información

### 4.A Ajuste de inventario (`/inventory/adjustments/new` y `/:id`)

| Elemento | Tipo | Clasificación | Ubicación actual | Veredicto |
|---|---|---|---|---|
| Título «Nuevo ajuste» / número `AJ-2026-000001` + subtítulo «Ajustes de inventario» | Mostrado | Esencial | Cabecera | Correcto |
| Indicador «Sin cambios / Sin guardar» | Mostrado | Calculado | Cabecera | Correcto |
| «Mapa de relaciones» | Acción | Avanzado | Cabecera, al nivel de las acciones primarias | Mover a menú secundario |
| «Cancelar» / «Guardar» | Acción | Esencial | Cabecera | Corregir: en documentos contabilizados y anulados siguen visibles (INV-07) |
| Insignia de estado + «Valor ajustado: 87.62» + «Ver asiento» | Mostrado | Solo lectura | Primera fila del cuerpo | Correcto en sitio; falta la moneda y falta quién y cuándo |
| Fecha * | Pide | Esencial | Fila 1 | Correcto en sitio; le falta validación de período (INV-02) |
| Almacén * | Pide | Esencial | Fila 1 | Correcto; es el primer dato de la tarea |
| Motivo * (texto libre) | Pide | Esencial | Fila 2, a todo lo ancho | Cambiar por catálogo + nota |
| Notas (textarea, 2 filas) | Pide | Avanzado | Fila 3, a todo lo ancho, antes de las líneas | Mover al final o plegar |
| Ayuda «Indica la cantidad contada…» | Mostrado | Ayuda | Sobre la tabla | Correcto |
| Producto (combobox con búsqueda en servidor) | Pide | Esencial | Columna 1 | Correcto; ampliar la columna o mostrar la unidad (INV-10) |
| En existencia / Existencia antes | Mostrado | Calculado | Columna 2 | Correcto; añadir unidad y costo actual |
| Contado | Pide | Esencial | Columna 3 | Correcto |
| Cambio (el calculado se muestra como **placeholder**) | Pide o calculado | Esencial | Columna 4 | Separar en «Diferencia» calculada (solo lectura) y «Cambio» (INV-05) |
| Costo de entrada (placeholder «Promedio actual», recortado a «Promedio actua») | Pide | Avanzado | Columna 5 | Mostrar el costo promedio real como valor de referencia |
| Costo unitario nuevo | Pide | Avanzado (revaluación) | Columna 6 | Sacar a un documento de revaluación aparte (INV-09) |
| Valor (solo contabilizado) | Mostrado | Calculado | Columna 7 | Debe verse **antes** de contabilizar |
| Eliminar línea / Agregar línea | Acción | Esencial | Fila / pie | Correcto |
| «Contabilizar» / «Anular» (solo en borrador guardado) | Acción | Esencial | Al **final** del cuerpo, lejos de «Guardar» | Mover a la cabecera junto a «Guardar» |
| **Ruido** | — | — | «Product id» como nombre de campo en los errores | Quitar (INV-11) |

**Lo que falta frente al estándar:**

- Unidad de medida por línea, y lote, serie y vencimiento cuando el producto lo exige.
- Ubicación o *bin*.
- Total de unidades y **valor total del ajuste antes de contabilizar**.
- Cuenta de contrapartida visible y elegible por motivo.
- Motivo de catálogo.
- Quién creó, contabilizó o anuló, y cuándo.
- Adjuntos (acta de conteo).
- Acción **Revertir**.
- Importar o pegar desde una hoja de cálculo.
- «Cargar productos del almacén» para un conteo completo (equivalente a *Calculate Inventory* de BC).
- Aviso de saldo cambiado desde el conteo.

### 4.B Ajuste de auditoría (`/accounting/audit-adjustments/new`)

| Elemento | Clasificación | Ubicación | Veredicto |
|---|---|---|---|
| Título + subtítulo «Se propone sobre un ejercicio cerrado y se contabiliza cuando se aprueba» | Esencial | Cabecera | Corregir: sin política de aprobación se contabiliza al instante (AUD-03) |
| «Proponer ajuste» (botón primario) | Esencial | Cabecera | Correcto, pero sin confirmación ni vista previa |
| Ejercicio (`<option>` con `2019-01-01 – 2019-12-31` en ISO crudo) | Esencial | Fila 1 | Formatear («Ejercicio 2019») y dar salida cuando no hay ninguno |
| Ayuda «Solo se ofrecen ejercicios cerrados…» | Ayuda | Bajo el ejercicio | Correcto |
| Diario (12 diarios, sin valor por defecto, incluidos Bancos y Ventas) | Esencial | Fila 1 | Proponer «Diario general» o «Cierre» |
| Descripción | Esencial | Fila 2 | Correcto; sin asterisco (en la ventana A sí lo hay) |
| Cuenta / Concepto / Débito / Crédito | Esencial | Tabla | Correcto, pero sin etiquetas accesibles (AUD-05) |
| Totales `0.30000000000000004` / `1234567.891` | Calculado | Pie | Formatear y mostrar la diferencia (AUD-02) |
| Fecha (no se pide: se fija al último día del ejercicio) | Calculado | Invisible | Mostrarla como solo lectura |

**Lo que falta:** fecha y período especial visibles, adjuntos (el endpoint `POST :id/evidence` existe pero no tiene interfaz), detalle o vista del ajuste (las filas de la lista **no se pueden abrir**), aprobador, dimensiones o centro de costo, moneda, y la diferencia por cuadrar.

### 4.C Configuración general

El inventario de las 26 secciones está en [`config-secciones.json`](2026-10-ventana-de-ajuste/config-secciones.json). Vista resumida:

| Grupo | Secciones | Modelo de guardado observado |
|---|---|---|
| Mi cuenta | Mi perfil · Mis empresas · Facturación y plan | «Guardar cambios» + «Actualizar contraseña» (dos botones) · sin guardado · sin guardado |
| Organización | Perfil de la empresa · Estructura empresarial · Sucursales · Personalización | «Guardar cambios» **arriba a la derecha** · por elemento · por elemento · «Guardar cambios» |
| Finanzas | Contabilidad · Multimoneda · Impuestos · Cierre fiscal · Intercompañía · Comprobantes fiscales · Retenciones · Jurisdicciones fiscales | «Guardar cambios» **abajo**, junto a «Descartar», en 5; ninguno visible en Comprobantes fiscales (12 campos) |
| Operaciones | Secuencias · Aprobaciones · Inventario | **«Guardar» por fila** (5 botones) · por elemento · «Descartar / Guardar cambios» abajo |
| Sistema | Usuarios · Roles y permisos · Seguridad y auditoría · Integraciones · Correo saliente · SSO · Inteligencia artificial · Extensiones | variado; «Actualizar» en Extensiones; 20 campos sin botón en IA |

**Lo que falta:**

- Buscador.
- Enlaces profundos visibles; el `#settings/<id>` existe pero no se comunica.
- Indicador de la sección activa para lectores de pantalla.
- Aviso de cambios sin guardar.
- Restablecer valores por defecto.
- Valor por defecto visible.
- Marca de «afecta a…» en los ajustes sensibles.
- Modo solo lectura para quien no puede editar.

### 4.D Ajustes de la caja (POS)

| Elemento | Clasificación | Veredicto |
|---|---|---|
| Terminal de este equipo (valor por defecto `main`) + ayuda | Esencial | Correcto; el valor por defecto «main» está en inglés y no es neutral |
| Imprimir el ticket automáticamente al cobrar | Esencial | Correcto |
| Atajos de teclado (9) | Ayuda | Mover a «Ayuda» o a un enlace aparte: no es un ajuste |
| Cancelar / Guardar | Esencial | Correcto |

---

## 5. Hallazgos

Formato: **ID · ventana · categoría · severidad**. Contexto por defecto: rol Administrador, español, DO, 1440×900, tema claro.

### 5.A Ajuste de inventario

**INV-01 · A · prevención y recuperación de errores · Crítica**
**El conteo se aplica contra un saldo que cambió después de contar, sin aviso.**

- **Reproducción** (`harness/06-obsoleto.cjs`):
  1. La sesión A abre un borrador con QA-7734-TOR contado = 88. Pantalla: existencia **90**, cambio previsto **−2**.
  2. La sesión B contabiliza una merma de −10 del mismo producto y almacén.
  3. A contabiliza sin recargar.
- **Esperado:** aviso de que la existencia cambió (90 → 80), con la diferencia recalculada antes de confirmar, al estilo del asistente de conflictos de Odoo.
- **Real:** el diálogo dice lo mismo de siempre («la existencia y el costo cambiarán») y se registró `antes 80, contado 88, cambio **+8**, valor **+80**`. La persona vio −2 y el sistema registró un **sobrante** de +8 que revierte la merma de B. Captura `21-inv-obsoleto-antes.png`, `22-inv-obsoleto-despues.png`.
- **Criterio:** Nielsen #5 (prevención de errores). Práctica del sector: Odoo detecta conflictos y BC calcula sobre una instantánea (confianza media).
- **Cómo debería ser:** guardar en cada línea la existencia que vio quien contó (`quantityAtCount`). Al contabilizar, si el saldo actual difiere, bloquear y mostrar «La existencia cambió desde el conteo: 90 → 80. ¿Aplicar contado 88 (cambio +8) o cambio original −2?».

**INV-02 · A · efecto incorrecto · Crítica**
**Se aceptan fechas de cualquier año y, al contabilizar, se crean ejercicios y períodos completos sin preguntar.**

- **Reproducción** (`06-obsoleto.cjs`): borradores con fecha 2019-01-15 y 2031-06-01 → Contabilizar.
- **Esperado:** rechazo, o al menos advertencia, por fecha fuera del ejercicio actual o futura. Ningún ejercicio se crea como efecto lateral de un ajuste.
- **Real:** ambos se contabilizaron (`AJ-2019-000002` y `AJ-2031-000002`, asientos `GENERAL-2019-000001` y `GENERAL-2031-000001`), y la base quedó con los ejercicios **2019 y 2031 abiertos con 12 períodos cada uno**. El campo fecha no tiene `min` ni `max`, y la numeración sigue el año tecleado (`AJ-2019-…`). Evidencia SQL en §7.1.
- **Criterio:** los períodos y el cierre son configuración controlada (estándar 3.1 y 3.2, confianza alta). Integridad contable.
- **Cómo debería ser:**
  - La fecha se limita a períodos abiertos del módulo de inventario y se valida en vivo («Octubre 2026 · abierto»).
  - Una fecha futura exige confirmación.
  - Nunca se crea un ejercicio desde un documento operativo.

**INV-03 · A · efecto incorrecto · Alta**
**El kárdex y el asiento quedan con fechas distintas.**

- Un ajuste fechado el 01/06/2031 genera un asiento del 01/06/2031, pero su movimiento en el kárdex queda con la fecha de contabilización (`2026-10-29T01:37:21Z`), porque `stock-ledger.move()` no recibe `date`.
- El kárdex por rango de fechas y el mayor de inventario dejan de cuadrar por período.
- Evidencia: salida de `06-obsoleto.cjs`, «kardex ultimas».

**INV-04 · A · competitividad / prevención · Alta**
**No se puede revertir un ajuste contabilizado.**

- Un documento contabilizado solo ofrece «Ver asiento» y «Mapa de relaciones» (`07-periodo-anular.cjs`, «acciones en contabilizado»). «Anular» existe solo en borrador.
- Corregir un error obliga a calcular a mano un contra-ajuste. Además, el asiento generado dice «se corrige desde el documento», pero el documento no lo permite.
- **Cómo debería ser:** «Revertir» crea el ajuste inverso enlazado («Revierte AJ-…») con su asiento inverso, y ambos documentos se muestran enlazados.

**INV-05 · A · arquitectura de la información · Alta**
**La diferencia calculada se muestra como *placeholder* del campo «Cambio», idéntica a un valor tecleado, y el impacto en dinero no aparece antes de contabilizar.**

- Captura `12-inv-borrador-lleno.png`: «−5» (calculado, placeholder) y «−2.25» (tecleado) se ven iguales.
- La columna «Valor» y el «Valor ajustado» solo aparecen **después** de contabilizar.
- El diálogo de confirmación (`14-inv-confirmar-contabilizar.png`) no muestra unidades ni valor.
- **Criterio:** estándar 3.1 (NetSuite *New Quantity*, Odoo *Difference*, Zoho, confianza alta) y WCAG 3.3.2 (el placeholder no es una etiqueta).
- **Cómo debería ser:** columnas separadas «Diferencia» (calculada, solo lectura, con signo y color + icono) y «Valor (RD$)». Pie con totales. El diálogo de confirmación resume «3 productos · −7.25 unidades · −RD$62.38 faltante · +RD$150.00 revaluación».

**INV-06 · A · bloqueo · Alta**
**Un usuario sin `inventory:adjust` ve un borrador como si pudiera editarlo, y el almacén sale vacío.**

- Rol «QA-7734 Consulta inventario» (`11-restringido.cjs`, captura `63-restringido-contabilizar.png`).
- **Se ve bien:** la lista oculta «Nuevo ajuste», y abrir `/new` da 403 a pantalla completa (`61-…`).
- **Falla:** al abrir un borrador, todos los campos están editables y aparecen «Guardar», «Agregar línea», «Contabilizar» y «Anular». Pulsar «Contabilizar» responde «No tienes permisos para realizar esta acción.» después del diálogo de confirmación.
- **Almacén vacío:** el selector queda en blanco porque `GET /wms/warehouses` está fuera de sus permisos. **Quien consulta no puede saber en qué almacén es el ajuste.**
- **Cómo debería ser:** documento en solo lectura para quien no tiene `inventory:adjust`, y el nombre del almacén tomado del propio documento (`warehouseName`, que la API ya devuelve en la lista).

**INV-07 · A · prevención / usabilidad · Alta**
**«Guardar» sigue visible y activo en documentos contabilizados y anulados.**

- Pulsarlo envía `PATCH` y muestra «Error — El ajuste AJ-2026-000001 ya no es un borrador.» (`16-inv-guardar-sobre-contabilizado.png`).
- «Cancelar» también sigue visible y es ambiguo frente a «Anular».
- `draft-shell` acepta `[readOnly]`, pero esta página no lo usa.

**INV-08 · A · bloqueo (pérdida de trabajo) · Alta**
**El botón «Cancelar» y la recarga descartan el borrador sin aviso.**

- `09-perdida-trabajo.cjs`. Con el formulario sucio:
  - «Cancelar» navega a la lista **sin confirmar**;
  - una recarga (F5) restaura la pestaña con el motivo vacío.
- Cerrar la pestaña con «×» **sí** pregunta («Cambios sin guardar… Cancelar / Descartar»). Al menos son tres comportamientos distintos para el mismo riesgo.
- La pestaña persiste en el servidor con el **punto de «sin guardar» aunque su contenido ya se perdió** (`55-inv-oscuro.png`: pestaña «Nuevo ajuste d…» con punto y cabecera «Sin cambios»).
- **Cómo debería ser:** borrador local autoguardado (o guardado automático como DRAFT) y la misma confirmación en los tres caminos.

**INV-09 · A · efecto incorrecto (presentación contable) · Media**
**Un mismo documento mezcla faltantes físicos y revaluación de costo, y el asiento los compensa en una sola línea.**

- AJ-2026-000001: faltantes −50.00 y −12.38 con una revaluación de +150.00. El asiento muestra en la cuenta 5150 una sola línea «**Sobrante** en ajuste de inventario» por 87.62 (`18-inv-asiento.png`). La pérdida queda oculta tras la revaluación.
- Las líneas de inventario del asiento usan solo el nombre del producto, y dos productos homónimos («QA-7734 Tornillo hexagonal 1/4"» y «…(caja x100)») se ven idénticos al truncarse.
- **Criterio:** estándar 3.1, revaluación separada en NetSuite, BC y Zoho (confianza alta).
- **Cómo debería ser:** documento de revaluación aparte, o al menos líneas de contrapartida separadas por naturaleza y la descripción con el SKU.

**INV-10 · A · prevención · Media**
**Riesgo de elegir un homónimo o una unidad equivocada.**

- La columna Producto mide unos 270 px y trunca «QA-7734-TOR · QA-7734 T» y «QA-7734-TOR-C · QA-773» (`13-inv-guardado.png`).
- No hay unidad de medida ni existencia en la lista de opciones. Buscar «tornillo» devuelve la unidad y la caja de 100 como opciones casi iguales.

**INV-11 · A · contenido e idioma · Media**
**Texto técnico «Product id» en los errores, en los tres idiomas.**

- ««Product id» es obligatorio» / «“Product id” is required» / «“Product id” é obrigatório» (`11-inv-guardar-vacio.png`, `20-idiomas.cjs`).
- Además, el mismo problema se lista dos veces («Product id» es obligatorio + «Cada línea necesita un producto.»).

**INV-12 · A · prevención · Media**
**El resumen de problemas no se actualiza al corregir.**

- Tras rellenar las tres líneas, el banner sigue diciendo «Cada línea necesita un producto.» hasta el siguiente intento de guardar (`12-inv-borrador-lleno.png`).

**INV-13 · A · usabilidad · Media**
**El error de período cerrado llega al final.**

- Una fecha en un período cerrado se acepta al guardar y se rechaza solo al contabilizar, con el mensaje claro «La fecha de la transacción está dentro de un período contable (Agosto 2031) que ya ha sido cerrado.» (`27-inv-periodo-cerrado.png`).
- La API responde 403 a lo que es una regla de negocio (400 o 422 sería lo correcto).

**INV-14 · A · prevención · Media**
**Si falta la cuenta de ajuste en Configuración, se descubre al contabilizar** (`inventory.organization_has_no_inventory_inventory_adjustment`, por inspección de código, no verificado en pantalla).

**INV-15 · A · veracidad / redondeo · Media**
**El valor del reporte de Existencias no cuadra con el kárdex por 0.01.**

- QA-7734-CAB: 112.75 − 12.38 = **100.37** según el kárdex y el asiento, y 18.25 × 5.50 = **100.38** en Existencias, con un total de 3,900.38 (`20-existencias.png`).

**INV-16 · A · arquitectura / trazabilidad · Media**
**La revaluación no deja rastro en el kárdex.** La línea con costo nuevo 950 (valor +150) no genera movimiento, así que el kárdex no explica por qué el valor de QA-7734-TOR-C pasó de 2,700 a 2,850 (`19-kardex.png`).

**INV-17 · A · trazabilidad · Media**
**La ventana no muestra quién creó, contabilizó o anuló ni cuándo.** La base guarda `created_by` y `posted_by`, pero la anulación no guarda autor, y los ajustes no escriben en `audit_logs` (consulta en §7.1).

**INV-18 · A · arquitectura · Media**
**El orden de las líneas cambia al guardar.** Se tecleó TOR, CAB, TOR-C y se recargó CAB, TOR, TOR-C (`12-…` frente a `13-…`). La API ordena por `id` (UUID aleatorio).

**INV-19 · A · contexto de entrada · Media**
**Desde la ficha del producto se precarga el producto, pero no su almacén.**

- «Ajustar existencias» abre el ajuste con el producto, pero en «Almacén principal» (el almacén por defecto), donde el producto no tiene existencias. La columna muestra «—», no «0» (`33-inv-desde-producto.png`).

**INV-20 · A · diseño visual / accesibilidad · Media**
**Los errores en línea son solo un borde rojo**, sin texto bajo el campo, y aparecen en un formulario «Sin cambios» tras tabular por él (`50-inv-1366.png`). Criterios WCAG 1.4.1 y 3.3.1.

**INV-21 · A · contenido · Baja**
**Cifras sin moneda** («Valor ajustado: 87.62», «Valor», lista), mientras el Mapa de relaciones del mismo documento dice «RD$87.62».

**INV-22 · A · inconsistencia · Baja**
**El mismo documento tiene dos nombres de estado.** El Mapa de relaciones muestra el ajuste como «**Cerrado**»; la ventana, como «Contabilizado» (`30-inv-mapa-relaciones.png`).

**INV-23 · A · diseño visual · Baja**
**Detalles de la lista y el formulario:**

- encabezados de la lista centrados sobre columnas alineadas a la izquierda (`81-config-abierta.png`, de fondo);
- *placeholder* «Promedio actual» recortado;
- toast que tapa las pestañas;
- spinners nativos en los campos de cantidad;
- formato de fecha `10/29/2026` del control nativo en una organización DO (depende del locale del navegador; no lo controla la aplicación).

**INV-24 · A · prevención · Baja**
**Doble clic: correcto.** Doble clic en «Guardar» → 1 `POST`. Doble clic en «Contabilizar» del diálogo → 1 `POST /post` (`05-robustez.cjs`). Se registra como fortaleza; ver §8.

### 5.B Ajuste de auditoría

**AUD-01 · B · bloqueo / efecto incorrecto · Crítica**
**La tarea principal falla con HTTP 500.**

- **Reproducción** (`12-auditoria.cjs cerrado`): ejercicio 2019 cerrado, diario, descripción, 1160 al débito y 2120 al crédito por 1,250.50 → «Proponer ajuste».
- **Real:** `POST /audit/adjustments 500 audit.approved_adjustment_could_not_processed_p1 {p1: accounting.module_module_closed_period_name}`. La pantalla muestra «No se pudo proponer el ajuste.» y no explica la causa ni qué hacer (`75-aud-tras-proponer.png`). No se guarda nada (`proposed_audit_adjustments` = 0 filas), así que el trabajo solo sobrevive mientras la pestaña siga abierta.
- **Causa observada:** sin política de aprobación, el ajuste se auto-aprueba y se intenta contabilizar en un período cuyo módulo está cerrado. La excepción del contabilizado se envuelve como 500.
- **Severidad:** la ventana existe solo para corregir ejercicios cerrados, y en el único escenario que la justifica no puede hacerlo.

**AUD-02 · B · veracidad / diseño visual · Alta**
**Totales con error de coma flotante y sin formato.** `0.1 + 0.2` → «**0.30000000000000004**»; «1234567.891» sin separadores ni redondeo a 2 decimales (`72-aud-totales-vacio.png`). La plantilla imprime `{{ totalDebit() }}` sin pipe.

**AUD-03 · B · prevención · Alta**
**«Proponer» contabiliza directamente cuando no hay política de aprobación.**

- El subtítulo promete «se contabiliza cuando se aprueba», pero la misma persona propone y aprueba, sin confirmación ni vista previa.
- Contradice la separación de funciones del estándar 3.2 (confianza media). Comportamiento leído en `audit-adjustments.service.ts:72-87` y confirmado por el intento de contabilización de AUD-01.

**AUD-04 · B · arquitectura · Alta**
**Callejón sin salida.** Sin ejercicios cerrados, el selector solo tiene «Elige un ejercicio cerrado…» (`71-aud-form-vacio.png`); la ayuda explica la regla, pero no ofrece salida. Las filas de la lista no se abren (0 filas enlazables): no hay vista de detalle, ni aprobación desde aquí, ni forma de adjuntar la «evidencia» que la lista cuenta en una columna.

**AUD-05 · B · accesibilidad · Alta**
**axe-core: `label` (crítico) en 6 controles**: concepto, débito y crédito de cada línea (`#aa-line-description-0`, `input[formcontrolname=debit]`…). Criterios WCAG 1.3.1 y 4.1.2.

**AUD-06 · B · prevención · Media**
**Una línea puede tener débito y crédito a la vez** (0.1 y 1,234,567.891 en la línea 1 sin queja), y también ambos en cero.

**AUD-07 · B · inconsistencia · Media**
**Diferencias con la ventana A y con Asientos:**

- sin asterisco de obligatorio;
- encabezados de tabla centrados y de 14px/700 (A: 12px/700 alineados; Asiento: 13px/600 con fondo);
- números alineados a la izquierda dentro de los campos;
- ejercicio en ISO crudo («2019-01-01 – 2019-12-31»).

Ver la tabla de §6.

**AUD-08 · B · contenido · Baja**
**El banner dice «Revisa 8 punto(s) antes de guardar», pero la acción es «Proponer».** En portugués mezcla variantes («está a corrigir», «registado» de pt-PT con «Salvar» de pt-BR).

### 5.C Configuración general

**CFG-01 · C · responsive · Crítica**
**En móvil (375×812) la Configuración es inutilizable.**

- La barra lateral mantiene 220 px y deja **105 px** al contenido.
- El título «Políticas de inventario» se parte por sílabas («Polí / tica / s de / inve / ntar / io»).
- «Guardar cambios» queda en y = 1865 px (`C-cfg-movil.png`, `21-cfg-tamanos.cjs`).
- En tableta el contenido queda en 498 px.

**CFG-02 · C · bloqueo (pérdida de trabajo) · Alta**
**Escape, clic en el fondo o cambiar de sección descartan sin aviso.**

- `14-configuracion.cjs`: cambio de la cuenta de ajuste → Escape → el modal se cierra y el cambio se pierde, sin diálogo.
- `18-config-cambios.cjs`: cambio de «Sitio web» → clic en «Sucursales» → volver: campo vacío, sin aviso. Igual con un clic en el fondo.
- Causa: `@HostListener('document:keydown.escape') onEscape(){ this.close(); }` y `(click)="close()"` en el fondo.

**CFG-03 · C · bloqueo · Alta**
**«Guardar cambios» deshabilitado sin explicación.**

- En Perfil de la empresa, editar «Sitio web» no habilita el botón, porque el RNC (obligatorio) está vacío en la organización sembrada. No hay ningún mensaje, `title` ni `aria-describedby` que lo diga (`C-perfil-guardar-deshabilitado.png`).
- Al rellenar el RNC el botón se habilita (no guardé).
- Va en contra del propio criterio del producto en `draft-shell` («Un botón gris no dice qué falta»).

**CFG-04 · C · accesibilidad · Alta**
**El foco no entra ni se queda en el diálogo.**

- Al abrir, el foco sigue en `<body>`.
- En 60 pulsaciones de Tab, **56** fueron a elementos fuera del modal (`aria-modal="true"`).
- Los botones de navegación no tienen `aria-current` y sus iconos no tienen `aria-hidden`.
- Criterios WCAG 2.4.3 y 2.1.2. Patrón *dialog* de la ARIA APG.

**CFG-05 · C · inconsistencia · Alta**
**Tres modelos de guardado y cuatro rótulos.**

- **Modelos:** «Guardar cambios» arriba a la derecha (Perfil de la empresa), «Descartar / Guardar cambios» abajo (Contabilidad e Inventario), «Guardar» por fila (Secuencias, 5 botones), y secciones con campos sin ningún botón (Comprobantes fiscales con 12 campos, IA con 20).
- **Rótulos:** «Guardar cambios», «Guardar», «Actualizar», «Actualizar contraseña».
- **Títulos:** **5 estilos de título** distintos (20/600, 20/700, 22/700, 24/600, 24/700).

**CFG-06 · C · bloqueo / permisos · Alta**
**El usuario restringido ve 17 secciones editables** (Contabilidad, Impuestos, Secuencias, Perfil de la empresa…). Los campos están habilitados, sin indicación de solo lectura (`C-restringido.png`).

**CFG-07 · C · usabilidad · Media**
**Abrir Integraciones o SSO pide la contraseña (*step-up*) solo para ver la sección**: `GET /auth/sso/admin/providers 401` y luego el diálogo «Verificación de seguridad» (`C-dialogo-al-entrar-21.png`).

**CFG-08 · C · arquitectura · Media**
**Sin buscador en 26 secciones** (estándar 3.3, Odoo, confianza alta). Además, **11 de 26** secciones tienen en la barra lateral un nombre distinto de su título:

- Contabilidad → «Preferencias contables»
- Impuestos → «Reglas de impuestos»
- Inventario → «Políticas de inventario»
- Secuencias → «Secuencias fiscales»
- Usuarios → «Gestión de usuarios»
- Aprobaciones → «Flujos de aprobación»
- Personalización → «Personalización avanzada»
- Cierre fiscal → «Periodos y cierre fiscal»
- Intercompañía → «Reglas intercompañía»
- Retenciones → «Regímenes de retención»
- Mi perfil → «Dev User»

**CFG-09 · C · contenido · Media**
**Ruta de ayuda inexistente.** Comprobantes fiscales dice «(**Ajustes › Facturación electrónica**)», pero el producto llama a esto «Configuración» y la sección es «Comprobantes fiscales» (`C12-cfg-Comprobantes-fiscales.png`).

**CFG-10 · C · prevención · Media**
**Cuentas contables por defecto sin confirmación.** Cambiar la «cuenta de Ajustes de inventario» (efecto verificado: el asiento siguiente usó la 5900) se guarda sin confirmar el impacto. Lo positivo: queda en `audit_logs` con valor anterior y nuevo.

**CFG-11 · C · diseño visual · Baja**
**Nombres de sección truncados sin `title`**: «Estructura empresa…», «Comprobantes fisca…», «Jurisdicciones fisca…».

### 5.D Ajustes de la caja (POS)

**POS-01 · D · prevención · Media**
**Un valor inválido deshabilita «Guardar» sin decir por qué.** «CAJA 1 ñ» pone `aria-invalid` y apaga el botón, y la ayuda no cambia (`92-pos-ajustes-invalido.png`). Falta «Solo letras, números, punto, guion o guion bajo; sin espacios».

**POS-02 · D · arquitectura · Baja**
**La lista de atajos ocupa más de la mitad del diálogo de ajustes** y no es un ajuste.

**POS-03 · D · contenido · Baja**
**El valor por defecto «main» está en inglés** y se muestra en la barra como «Caja main».

**POS-04 · D · trazabilidad · Baja (subjetivo)**
**Los ajustes son solo locales** (`localStorage` `virtex.pos.autoPrint`) y no se avisa de que valen «solo en este equipo». Es una elección razonable para un terminal, pero conviene decirlo.

---

## 6. Mediciones de consistencia

Estilos computados (Inter en todos los casos). Fuente: [`mediciones.json`](2026-10-ventana-de-ajuste/mediciones.json) y [`config-secciones.json`](2026-10-ventana-de-ajuste/config-secciones.json).

| Medida | Ajuste inventario | Transferencia | Ajuste auditoría | Asiento | Producto | Lectura |
|---|---|---|---|---|---|---|
| Título h1 | 20px/600 | 20px/600 | 20px/600 | 20px/600 | 20px/600 | ✅ 1 estilo (gracias al *draft shell*) |
| Etiqueta de campo | **14px/400** | 14px/400 | 14px/400 | **13px/500** | **13px/500** | ⚠ 2 estilos |
| Encabezado de tabla | **12px/700**, sin fondo | 12px/700 | **14px/700**, centrado | **13px/600** con fondo `#EFF2F7` | — | ❌ 3 estilos |
| Celda de tabla | 14px, pad 6.4/8 | 14px | 14px, pad 1 | **13px, pad 12/16** | — | ❌ 2 densidades |
| Campo de texto | h36, r6, borde **rgb(98,105,128)** | — | h36, borde rgb(98,105,128) | h36, rgb(98,105,128) | h36, **rgb(127,135,148)** | ⚠ 2 colores de borde |
| Campo numérico | h36, borde **rgb(127,135,148)** | igual | igual | igual, **13px** | igual | ⚠ dentro del mismo formulario, texto y número tienen bordes distintos |
| Botón primario | 14/500, h36, r6, `#5B37D9` | igual | igual | igual | igual | ✅ |
| Botón secundario | 14/500, h36, borde `#D7DDE8` | igual | igual | igual | igual | ✅ |
| Título de sección (h2) | 17px/600 | 17px/600 | — | — | **14px/600** | ⚠ |
| Configuración: h1 de sección | — | — | — | — | — | ❌ **5 estilos** en 26 secciones |
| Configuración: rótulo de guardar | — | — | — | — | — | ❌ 4 rótulos y 3 posiciones |
| Foco visible (campos) | anillo 3px `rgba(91,55,217,.22)` + borde morado | — | — | — | — | ✅ también en el combobox (`56-foco-producto.png`) |
| Apertura de la Configuración | 34 ms hasta el panel | | | | | ✅ |

---

## 7. Resultado por tareas y roles

| Tarea | Rol | ¿Completada? | Pasos y clics (mínimo razonable en un ERP líder) | Bloqueos |
|---|---|---|---|---|
| Ajuste simple de una línea con verificación de efectos | Admin | ✅ | 9 interacciones: Nuevo ajuste, almacén, motivo, producto (3), contado, Guardar, Contabilizar, Confirmar; unas 7 en QBO o Zoho | Sin vista previa de impacto (INV-05) |
| Ajuste de varias líneas | Admin | ✅ | +4 por línea; sin pegar ni importar | Orden cambia al guardar (INV-18) |
| Rechazo: stock negativo | Admin | ✅ claro | Mensaje: «No hay suficiente … hay 18.25 y se necesitan 1000.» | Solo al contabilizar |
| Rechazo: período cerrado | Admin | ✅ claro, tardío | Al contabilizar | INV-13 |
| Rechazo: fecha absurda | Admin | ❌ **no rechaza** | — | INV-02 |
| Rechazo: sin permiso | Restringido | ⚠ | Rechaza al final, tras el diálogo | INV-06 |
| Rechazo: valores negativos o contado y cambio a la vez | Admin | ✅ | Resumen con enlaces a los campos | INV-11, INV-12 |
| Corregir un error propio | Admin | ⚠ borrador: Anular ✅ · contabilizado: ❌ | — | INV-04; anular no muestra confirmación de éxito |
| Encontrar el ajuste y su historial | Admin | ✅ parcial | Lista + kárdex (la referencia enlaza al ajuste) + Mapa de relaciones | Falta quién y cuándo (INV-17) |
| Proponer ajuste de auditoría | Admin | ❌ **HTTP 500** | — | AUD-01 |
| Cambiar un ajuste de configuración y ver su efecto | Admin | ✅ | Cuenta 5150 → 5900, asiento siguiente con 5900, restaurado | CFG-10 |
| Restaurar el valor | Admin | ✅ | Manual; no hay «restablecer» | — |
| Cambio de configuración sin permiso | Restringido | ⚠ | Formulario editable; botón gris sin razón | CFG-06, CFG-03 |
| Encontrar un ajuste sin saber la sección | Admin | ⚠ | Recorrer 26 secciones; 11 rótulos no coinciden | CFG-08 |
| Cambiar la terminal del POS | Admin | ✅ | 3 clics | POS-01 |

---

### 7.1 Veracidad de datos y efectos (sin mocks)

- **Todo dato visible viene de la API.** La red muestra `GET /wms/warehouses`, `GET /inventory/stock?productId&warehouseId`, `GET /inventory/adjustments/:id` y `GET /inventory/:id`. No hay mocks.
- **Aritmética de AJ-2026-000001, verificada a mano:**
  - QA-7734-TOR: 100 → contado 95 = −5 × 10.00 = **−50.00**
  - QA-7734-CAB: −2.25 × 5.50 = −12.375 → **−12.38**
  - QA-7734-TOR-C: revaluación 3 × (950 − 900) = **+150.00**
  - Total **87.62** ✅
  - Asiento: débito 1140 por 150; créditos 1140 por 50 y 12.38, y 5150 por 87.62; totales 150/150 ✅
  - Existencias tras el ajuste: 95 / 18.25 / 3 a 950 ✅
- **Persistencia:** sobrevive a la recarga; el número aparece en la lista, el kárdex (con enlace), Existencias, el asiento y el Mapa de relaciones ✅.
- **Hallazgos de veracidad:**
  - fecha del kárdex distinta de la del asiento (INV-03);
  - 0.01 de diferencia entre Existencias y kárdex (INV-15);
  - revaluación ausente del kárdex (INV-16);
  - ejercicios creados como efecto lateral (INV-02).

Evidencia SQL de INV-02 (solo lectura):

```
 AJ-2019-000002 | 2019-01-15 | POSTED | entry 2019-01-15 | GENERAL-2019-000001
 AJ-2031-000002 | 2031-06-01 | POSTED | entry 2031-06-01 | GENERAL-2031-000001
 fiscal_years: 2026 OPEN · 2019 OPEN · 2031 OPEN   accounting_periods 2019-01-01 … 2031-12-31 (36)
```

- **Auditoría:** el cambio de configuración queda en `audit_logs` con valor anterior y nuevo ✅. Los ajustes de inventario no aparecen en `audit_logs` (solo sus asientos y productos) ⚠.

---

## 8. Fortalezas a preservar

- **Contabilizar es atómico y seguro en concurrencia.** Bloqueo pesimista del borrador, del producto y del saldo por almacén; un `idempotencyKey` por ajuste en el asiento; el doble clic no duplica (1 POST en ambos casos).
- **El kárdex, las existencias por almacén y el asiento salen de un único escritor** (`StockLedgerService.move`) y cuadran.
- **Borrador → contabilizado → anulado**, con insignia de estado y enlace al asiento; el kárdex enlaza de vuelta al ajuste.
- **El resumen de problemas** («Revisa N punto(s)…») enlaza a cada campo, y el botón primario no se deshabilita a ciegas (criterio documentado en `draft-shell`).
- **Mensajes de rechazo del servidor claros y localizados** (stock insuficiente con cifras, período cerrado con nombre).
- **axe-core: 0 violaciones** en la ventana de ajuste de inventario y en el modal de Configuración. Foco visible en todos los controles probados. Tema oscuro completo.
- **Búsqueda de productos y cuentas en el servidor**, que excluye servicios y cuentas de control.
- **Configuración:** cambios auditados con antes y después; país bloqueado con una explicación ejemplar; ayudas por campo («Recibe faltantes, sobrantes y revaluaciones de costo. Cuenta de tipo Gasto.»).
- **POS:** diálogo con foco atrapado y devuelto, cierre con Escape, aviso de turno abierto al cambiar de terminal y buen comportamiento en 375 px.

---

## 9. La forma correcta

### 9.A Ajuste de inventario: **rehacer el flujo de conteo; conservar el motor**

```
┌ AJ-2026-000123 · Borrador ───────────────── [Mapa ▾] [Descartar] [Guardar] [Contabilizar ▸] ┐
│ Creado por Ana P. · 29/10/2026 10:12                                                         │
├─ 1. Qué y cuándo ────────────────────────────────────────────────────────────────────────────┤
│ Almacén* [Almacén Norte ▾]  Fecha* [29/10/2026] ✓ Octubre 2026 abierto   Tipo* (•) Conteo ( ) Cambio │
│ Motivo* [Conteo cíclico ▾ +nuevo]  → cuenta 5150 Ajustes de inventario                        │
├─ 2. Líneas ─────────────── [Cargar productos del almacén] [Pegar desde Excel] [Importar CSV] ┤
│ Producto (SKU · nombre · UdM)    │Sistema│Contado│Diferencia│Costo prom.│ Valor RD$│          │
│ QA-7734-TOR · Tornillo 1/4" · UN │  90   │  88   │  ▼ −2    │   10.00   │  −20.00  │ 🗑       │
│ ⚠ La existencia cambió desde el conteo (90 → 80). [Usar 80] [Mantener diferencia −2]          │
├─ 3. Impacto ─────────────────────────────────────────────────────────────────────────────────┤
│ 3 productos · −7.25 UN · Faltante RD$ −62.38 · Sobrante RD$ 0.00 · Asiento: 1140 ↔ 5150      │
├─ Notas y adjuntos (plegado) ─────────────────────────────────────────────────────────────────┤
└──────────────────────────────────────────────────────────────────────────────────────────────┘
Contabilizado: solo lectura + [Revertir] + «Contabilizado por … el …» + enlaces a asiento, kárdex y reversión.
```

- **Revaluación de costo como documento separado** («Revaluación de costo»), con su propia cuenta.
- **Confirmación** con el resumen de impacto; una diferencia de saldo bloquea y obliga a decidir.
- **Página completa:** el formato actual de página en pestaña es correcto para documentos de varias líneas (estándar 3.1).

### 9.B Ajuste de auditoría: **corregir y completar**

- Corregir AUD-01: el contabilizado debe abrir el período especial o de ajuste del ejercicio cerrado, y un fallo debe devolver un 4xx con un mensaje accionable.
- Pasos: 1) ejercicio (formateado), con la fecha y el período de ajuste visibles; 2) líneas con cuenta, concepto, dimensiones y débito **o** crédito; 3) cuadre en vivo con **diferencia** y formato monetario; 4) evidencia adjunta obligatoria; 5) «Enviar a aprobación», con confirmación y aprobador distinto del proponente.
- La lista abre un detalle con el historial de aprobación y el asiento resultante.
- Unificar la tabla con la de Asientos.

### 9.C Configuración general: **reestructurar**

- Página completa (`/settings/<sección>`) en lugar de un modal de 1067 px; en móvil, lista → detalle.
- Buscador global de ajustes arriba, con resultados que llevan a la sección y al campo.
- Un modelo de guardado: barra fija inferior «Descartar / Guardar cambios» que aparece al haber cambios, con contador. Para listas (secuencias, sucursales), edición por fila con confirmación.
- Guardia de cambios sin guardar en Escape, en el fondo, al cambiar de sección y al cerrar.
- El título de la sección es igual al rótulo de la barra lateral. Sección activa con `aria-current="page"`.
- Por permiso: secciones en solo lectura (o ocultas) para quien no puede editar. *Step-up* solo al **guardar**.
- Ajustes sensibles (cuentas por defecto, secuencias, impuestos) con confirmación que explica a qué documentos afecta y desde cuándo, y «restablecer valor por defecto».

### 9.D Ajustes de la caja: **retocar**

Mensaje de error en línea, atajos en un enlace de «Ayuda», valor por defecto neutral («CAJA-1») y la nota «Se guarda en este equipo».

---

## 10. Scorecard (1–10)

Calibración: 10 = a la altura o por encima de los líderes; 5 = utilizable en el camino feliz, con bloqueos que un cliente nota en la primera semana. La nota global no puede superar la menor entre «completabilidad» y «veracidad».

### 10.A Ajuste de inventario: **global 4/10**

| Eje | Nota | Justificación (hallazgos) | Para llegar a 10 |
|---|---|---|---|
| Arquitectura de la información | 5 | Orden correcto (almacén → líneas), pero el impacto no se ve antes (INV-05), revaluación mezclada (INV-09), sin UdM, motivo ni cuenta (§4.A) | Diseño 9.A completo |
| Completabilidad y ausencia de bloqueos | 5 | El camino feliz funciona; INV-06, INV-08, INV-04 | Solo lectura por permiso, borrador persistente, Revertir |
| Prevención y recuperación de errores | 3 | INV-01 (crítico), INV-02 (crítico), INV-13, INV-12; doble envío bien | Detección de saldo obsoleto, fechas acotadas, validación en vivo |
| Consistencia con el producto | 6 | *Shell* uniforme; tablas y bordes distintos (§6), INV-22 | Tokens únicos de tabla y campo |
| Calidad visual y jerarquía | 6 | Limpia; acciones del documento lejos de la cabecera, recortes (INV-10, INV-23) | Acciones en cabecera, columnas proporcionadas |
| Accesibilidad | 6 | axe 0, foco visible; *placeholder* como dato (INV-05), errores solo por color (INV-20) | Diferencia como texto, errores en línea asociados |
| Contenido, idioma y multipaís | 6 | Traducido en 3 idiomas; «Product id» (INV-11), sin moneda (INV-21); otro país no probado | Etiquetas completas, moneda ISO y símbolo, prueba en otros países |
| Responsive y rendimiento | 6 | Tabla con scroll propio en móvil, guardar visible en todos los tamaños | Vista de tarjetas por línea en móvil |
| Veracidad de datos y efectos | 7 | Todo real y cuadrado; INV-03, INV-15, INV-16 | Misma fecha en kárdex y asiento, redondeo único, revaluación en kárdex |
| Competitividad | 4 | Sin conteo masivo, importación, motivos, reversa ni vista previa | Paridad con 3.1 |

### 10.B Ajuste de auditoría: **global 1/10**

| Eje | Nota | Justificación | Para llegar a 10 |
|---|---|---|---|
| Arquitectura de la información | 3 | Sin detalle, sin evidencia, sin fecha ni período visibles (AUD-04) | 9.B |
| Completabilidad | **1** | AUD-01: HTTP 500 en el único caso de uso | Contabilizar en un período de ajuste y devolver 4xx accionable |
| Prevención | 3 | AUD-03, AUD-06; cuadre sí validado | Confirmación, aprobador distinto, validación por línea |
| Consistencia | 4 | AUD-07 | Reutilizar la tabla de Asientos |
| Visual | 4 | AUD-02 | Formato monetario y diferencia |
| Accesibilidad | 3 | AUD-05 (6 × `label` crítico) | Etiquetas por celda |
| Contenido | 5 | Textos claros; error genérico, AUD-08 | Mensaje que diga la causa |
| Responsive | — | No medido en tamaños | Medirlo |
| Veracidad | 2 | No produce efecto; totales falsos a la vista | Corregir AUD-01 y AUD-02 |
| Competitividad | 2 | Frente a SAP períodos 13–16 | 9.B |

### 10.C Configuración general: **global 4/10**

| Eje | Nota | Justificación | Para llegar a 10 |
|---|---|---|---|
| Arquitectura de la información | 5 | Grupos claros (cuenta, organización, finanzas, operaciones, sistema); sin buscador; 11/26 rótulos ≠ títulos; CFG-09 | 9.C |
| Completabilidad | 4 | CFG-03, CFG-06, CFG-07 | Mensajes de bloqueo, solo lectura por permiso, *step-up* al guardar |
| Prevención | 3 | CFG-02, CFG-10 | Guardia de cambios, confirmación en ajustes sensibles |
| Consistencia | 4 | CFG-05 (5 títulos, 3 modelos, 4 rótulos) | Un patrón de sección |
| Visual | 6 | Cuidada en escritorio; truncados (CFG-11) | Página completa |
| Accesibilidad | 4 | axe 0, pero CFG-04 (foco) | Patrón *dialog* APG o página |
| Contenido | 6 | Ayudas buenas; CFG-09 | Revisión de referencias cruzadas |
| Responsive | **2** | CFG-01 (105 px en móvil) | Lista → detalle en móvil |
| Veracidad | 8 | Efecto verificado en asiento, auditado con antes y después | Mostrar el historial en la propia sección |
| Competitividad | 4 | Frente a Odoo y QuickBooks | 9.C |

### 10.D Ajustes de la caja (POS): **global 6/10**

| Eje | Nota | Justificación | Para llegar a 10 |
|---|---|---|---|
| Arquitectura de la información | 6 | Mezcla ajustes y ayuda (POS-02) | Separar |
| Completabilidad | 7 | Funciona | Mensaje de error |
| Prevención | 5 | POS-01 | Error en línea |
| Consistencia | 7 | Coherente con el resto del POS | — |
| Visual | 7 | Claro en oscuro y en móvil | — |
| Accesibilidad | 7 | Foco atrapado (0/20 fuera), Escape; foco inicial en «Cerrar» | Foco inicial en el primer campo |
| Contenido | 6 | POS-03 | Valor por defecto neutral |
| Responsive | 8 | Correcto a 375 px | — |
| Veracidad | 7 | Persiste en el equipo; sin aviso de alcance (POS-04) | Indicar «solo este equipo» |
| Competitividad | 6 | Suficiente para un terminal | — |

---

## 11. Matriz de cobertura

| Elemento | Estados | Tamaños | Teclado | axe / a11y | Idioma | Rol restringido | Datos reales y efectos | % |
|---|---|---|---|---|---|---|---|---|
| A · lista | vacío ✅, con datos ✅, filtro ✅ | 1440 ✅ | — | — | es ✅ | ✅ | ✅ | 70 |
| A · formulario nuevo | vacío, inválido, lleno, sucio ✅ | 1920/1440/1366/768/375/zoom200 ✅ | orden de tabulación ✅ | axe ✅, foco ✅ | es/en/pt ✅ | 403 ✅ | ✅ | 90 |
| A · borrador / contabilizado / anulado | ✅ / ✅ / ✅ | 1440 | parcial | ✅ | es/en/pt ✅ | ✅ | ✅ kárdex, existencias, asiento | 85 |
| A · concurrencia (obsoleto, doble envío) | ✅ | — | — | — | — | — | ✅ | 100 |
| B · formulario | vacío, inválido, lleno, error 500 ✅ | 1440 solo | ✗ | axe ✅ | es/en/pt ✅ | ✗ | ✅ (falla) | 60 |
| C · 26 secciones | carga, diálogo *step-up* ✅; edición profunda solo en Perfil e Inventario | 1440/1366/768/375 (Inventario) | trampa de foco ✅ | axe ✅ (modal) | es ✅ | ✅ | ✅ (cuenta de ajuste) | 55 |
| D · POS | normal, inválido, guardado ✅ | 1440/1366/375 ✅ | trampa de foco ✅ | manual | es ✅ | ✗ | ✅ (`localStorage`) | 75 |

**No cubierto, y por qué:**

- **Otro país o moneda de organización.** Requiere una organización nueva de otro mercado; el país no se puede cambiar. Formatos regionales probados solo con en y pt.
- **Lotes, series y vencimientos; unidades alternativas; ubicaciones o bins.** No existen en la ventana.
- **Importar o pegar desde hoja de cálculo; rendimiento con más de 100 líneas.** No existe importación. No generé 1000 líneas (el límite de la API es `ArrayMaxSize(1000)`).
- **Ajuste de auditoría con política de aprobación activa** (camino PENDING → aprobar). Por inspección, el aprobado usa el mismo `postApproved` que falla en AUD-01. No verificado en pantalla.
- **Error de red y reintento.** No simulé cortes de red.
- **Sesión expirada con borrador abierto.** No probado.
- **Zoom real al 125 % y 150 %.** Solo el equivalente al 200 % por tamaño de ventana.
- **`prefers-reduced-motion`.** No inspeccionado.
- **Edición y guardado de las 24 secciones restantes de Configuración.** Solo se recorrieron (título, botones, campos, errores de red y consola); el guardado se probó en Perfil de la empresa (sin guardar, por CFG-03) y en Políticas de inventario.
- **Aplicación de escritorio (Electron).** Envuelve el mismo portal y el mismo POS; no la ejecuté.
- **Lighthouse.** No ejecutado; se usó axe-core.
