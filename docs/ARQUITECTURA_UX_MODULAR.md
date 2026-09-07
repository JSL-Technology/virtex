# Arquitectura de interfaz, módulos y flujo — Virtex ERP

Propuesta de estructura para el ERP principal: división por módulos, ventanas internas y el
flujo de trabajo que las une.

Sucede a `docs/TAB_ARCHITECTURE.md` en lo que respecta al modelo de ventanas, y anota la
especificación de producto existente. Se apoya en el inventario verificado de
`docs/INVENTARIO_Y_RACIONALIZACION.md`.

---

## 0. El diagnóstico que ordena todo lo demás

`TAB_ARCHITECTURE.md` §5.1 describe con precisión el defecto que la auditoría encontró meses
después: *«el sidebar enlaza a decenas de rutas que no tienen definición»*. §5.2 propone la
solución correcta: cada feature declara sus pestañas junto a sus rutas mediante `provideTabs`.

`provideTabs` **no se invoca en ningún archivo del proyecto**. El registro quedó con sus 15
patrones centrales y 40 de 50 enlaces del menú abren «En construcción».

El documento de diseño tenía razón y el código no lo obedeció. Esa es la enfermedad, y no es
de conocimiento:

> **Un invariante que depende de que alguien lo recuerde no es un invariante.**

El propio backend ya aprendió esta lección. `app.module.ts` registra CSRF y verificación de
suscripción como `APP_GUARD` porque, declarados por endpoint, llegaban a «4 de 50» y «1 de 67»
—sus propios comentarios lo dicen—. La misma lección no se aplicó a permisos (43 de 73) ni al
registro de pestañas (15 de ~90).

Toda decisión de este documento se somete a una prueba: **¿puede un desarrollador competente
violarla sin que nada se lo impida?** Si la respuesta es sí, la decisión está mal formulada.

---

## 1. Principio rector: una sola tabla de verdad por cada cosa

El inventario encontró el mismo patrón repetido: dos tablas de rutas, dos servicios de plan de
cuentas, dos formularios de cliente, dos mapas de configuración, dos listas de proveedores.

No son seis errores. Es uno solo, seis veces: **el sistema permite declarar la misma verdad en
dos sitios.**

Todo lo que sigue reduce fuentes de verdad. Ninguna propuesta de este documento añade un
registro que haya que mantener sincronizado a mano con otro.

---

## 2. El módulo como unidad de todo

### 2.1 Por qué el módulo y no el proceso

La especificación anterior proponía navegación por procesos y relegaba los módulos. El
argumento —«la unidad real de trabajo es el proceso»— es correcto como observación de uso e
incorrecto como unidad de arquitectura, porque el proceso no puede ser dueño de nada:

| El módulo es dueño de | El proceso no puede serlo |
|---|---|
| Un contexto acotado del backend (ya existen 46) | Atraviesa varios; no tiene tablas propias |
| Un espacio de nombres de permisos (`ventas:*`) | Los permisos se otorgan por dominio, no por flujo |
| Una unidad de release y de bandera de función | Se activa por partes en módulos distintos |
| Un equipo responsable | Ningún equipo sería dueño de «ciclo de venta» completo |
| Un contrato de API versionable | No tiene superficie propia |

Además, verificado en el código: **no existe entidad de proceso, etapa ni pipeline.** Construir
la navegación principal sobre un concepto que el backend no modela es cómo se producen las 40
páginas mock que ya tiene el producto.

**Resolución:** el módulo es la unidad de propiedad, permisos, release y navegación. El proceso
sobrevive como **lente** (§7.4): una vista que atraviesa módulos, construida cuando exista la
entidad que la sostenga. Se gana la idea sin apostar la navegación a algo que no existe.

### 2.2 Los módulos

Catálogo alineado con los contextos del backend. Los registros maestros **no** son un módulo:
cada uno vive en el módulo que lo gobierna, según el veredicto C.4 del inventario.

| Módulo | Contiene | Maestros que gobierna |
|---|---|---|
| **Ventas** | Cotizaciones, pedidos, facturas, notas de crédito, cobros | Clientes, listas de precios |
| **Compras** | Requisiciones, órdenes, recepciones, facturas de proveedor, pagos | Proveedores |
| **Inventario** | Existencias, movimientos, transferencias, ajustes, kardex | Productos, almacenes, unidades de medida |
| **Producción** | Órdenes de trabajo, lista de materiales, costeo | Rutas, centros de trabajo |
| **Tesorería** | Posición de caja, cuentas bancarias, transferencias, conciliación | Bancos, métodos y términos de pago |
| **Contabilidad** | Asientos, libros, periodos, cierre, activos fijos | Plan de cuentas, diarios, dimensiones |
| **Fiscal** | Secuencias, comprobantes electrónicos, declaraciones | Impuestos, regímenes |
| **Análisis** | Estados financieros, antigüedad, rentabilidad, datasheets | Definiciones de reporte |
| **Personas** | Empleados, nómina | Cargos, departamentos |
| **Administración** | Empresa, sucursales, usuarios, roles, integraciones, auditoría | Monedas, países |

Diez módulos. La regla de admisión es la misma que usó la especificación anterior para separar
aplicaciones, aplicada un nivel más abajo: **si dos cosas se consultan mutuamente dentro de la
misma tarea, van en el mismo módulo.**

### 2.3 El manifiesto de módulo

Esta es la pieza central de la propuesta y la respuesta directa a «que se vea profesional por
cómo está organizado».

Hoy un módulo se declara en **cinco listas** mantenidas a mano: `app.routes.ts`,
`tab-definitions.ts`, `sidebar-menu.ts`, los `data.permissions` de cada ruta y el `SECTION_MAP`
del modal de configuración. Nada obliga a que coincidan. Ese desacople **es** el bug.

Un módulo se declara **una vez**:

```ts
export const VENTAS: ModuleManifest = {
  id: 'ventas',
  titleKey: 'MODULOS.VENTAS',
  icon: 'ShoppingBag',
  permissionNamespace: 'ventas',

  // Única declaración de rutas del módulo. El router y las ventanas leen de aquí.
  routes: [
    { path: 'facturas',            window: 'lista',     permission: 'ventas:factura:ver',
      load: () => import('./facturas/lista') },
    { path: 'facturas/nueva',      window: 'borrador',  permission: 'ventas:factura:crear',
      load: () => import('./facturas/borrador') },
    { path: 'facturas/:id',        window: 'documento', permission: 'ventas:factura:ver',
      load: () => import('./facturas/documento'),
      title: (doc) => `Factura ${doc.numero}` },
  ],

  // El menú se DERIVA de las rutas marcadas como destino. No es una lista aparte.
  menu: ['facturas', 'cotizaciones', 'clientes'],

  bandeja:   () => import('./bandeja'),          // §7.2
  buscar:    ['factura', 'cliente', 'cotizacion'], // aporta a Ctrl+K
  crearRapido: ['cliente', 'producto'],           // §7.5
  trabajos:  ['emision-masiva', 'recalculo-precios'],
  estado:    () => import('./contrib-barra-estado'),
};
```

Lo que esto elimina, por construcción y no por vigilancia:

- Un enlace de menú sin página deja de ser expresable: el menú se deriva de las rutas.
- Una ruta sin permiso deja de compilar: el campo es obligatorio.
- Una ventana sin ruta deja de existir: la ventana **es** una ruta resuelta (§3).
- Un módulo nuevo tiene una forma conocida. Eso es, literalmente, lo que se percibe como
  software profesional: que la segunda vez que aprendes algo, ya lo sabías.

Una prueba única recorre todos los manifiestos y falla si un destino de menú no resuelve, si
una ruta no declara permiso, o si un permiso declarado no existe en el backend. Es la misma
prueba para los diez módulos, no una por módulo.

---

## 3. Ventanas internas: el invariante que las hace seguras

El proyecto ya usa **Dockview 6.6** y quiere ventanas internas. Es una buena decisión para un
ERP —un contador conciliando necesita ver el extracto y el mayor a la vez— y es exactamente la
decisión que rompió el producto, porque se implementó como un segundo sistema de enrutado.

### 3.1 El invariante

> **Toda ventana interna es el resultado de resolver una URL. No existe ventana que ninguna URL
> pueda abrir, ni URL que no pueda abrirse como ventana.**

De aquí se deduce todo lo demás:

- Hay **una** tabla de rutas: la de los manifiestos. El workspace no tiene catálogo propio.
- Los guards y resolvers de una ruta corren **por ventana**. Una ventana no puede mostrar algo
  para lo que el usuario no tiene permiso, porque atraviesa el mismo control que la ruta.
- Todo lo visible es enlazable. Un usuario puede pasar la URL de lo que está viendo.
- Toda ventana es auditable: se sabe qué recurso mostró y bajo qué permiso.

### 3.2 Cómo se implementa sobre Angular

El router de Angular tiene una ruta activa a la vez. La propuesta no lo contradice: lo divide
en dos papeles explícitos.

| Papel | Quién lo cumple | Qué garantiza |
|---|---|---|
| **Ventana enfocada** | La ruta activa real del router | Barra de direcciones, historial, `Alt+←`, guards nativos |
| **Ventanas de fondo** | Resoluciones destacadas de la *misma* configuración de rutas | Mismo componente, mismos guards y resolvers, ejecutados por el host |
| **Enfocar una ventana** | Navegación a su URL, suprimiendo la reapertura | La ventana enfocada y la URL nunca discrepan |

El componente `WindowHost` recibe una ruta, la resuelve contra los manifiestos, ejecuta guards
y resolvers, y monta el componente. Es unas doscientas líneas y sustituye por completo a
`TabRegistryService`.

La diferencia con hoy es de una palabra: el host **resuelve** la tabla de rutas en vez de
**consultar un catálogo paralelo**. Esa palabra es la que separa un producto funcionando de uno
con el 80% invisible.

### 3.3 Qué va en la URL y qué no

`TAB_ARCHITECTURE.md` §2 decidió no codificar las pestañas en la URL. La decisión es correcta y
se conserva, con la separación hecha explícita:

| | Dónde vive | Por qué |
|---|---|---|
| **El elemento enfocado** | La URL | Debe ser compartible, verificable y auditable |
| **El layout** (qué ventanas, dónde, de qué tamaño) | Estado de workspace en **servidor** | Es preferencia del usuario, no identidad del recurso |

Hoy el layout vive en `sessionStorage` (`tab-persistence.service.ts:75,157`), que muere al
cerrar el navegador. La especificación anterior prometía en §5.3 «continuar en otro equipo»;
con `sessionStorage` no sobrevive ni a cerrar la pestaña. El workspace se persiste por
`(usuario, empresa, clase de dispositivo)` en el servidor.

### 3.4 Tres modos de ventana

Las ventanas internas son una función de poder. Hacerlas obligatorias castiga a la mayoría y
hace imposible la pantalla pequeña.

| Modo | Comportamiento | Para quién |
|---|---|---|
| **Enfocado** (por defecto) | Una ventana a la vez, tira de pestañas arriba | El 90% de los usuarios |
| **Taller** (opcional) | Dock, mosaico y flotantes de Dockview | Conciliación, cierre, análisis, varios monitores |
| **Compacto** (automático) | Pila única, sin MDI | Pantallas pequeñas |

El modo se recuerda por usuario. El invariante de §3.1 se cumple en los tres: cambiar de modo
no cambia qué es cada ventana, solo cómo se dispone.

### 3.5 Ciclo de vida

Se conserva lo bueno de la especificación anterior, con una corrección de fondo:

- Estados **activa / viva / suspendida** con indicador visible.
- Una ventana con cambios sin guardar **nunca** se suspende automáticamente.
- Al restaurar se recuperan filtros, scroll, paginación y borradores.
- **Corrección:** la distinción «guardado» vs «sincronizado» del §5.4 anterior desaparece del
  ERP principal. Un ERP transaccional multiusuario **no** debe tener escrituras locales
  pendientes: un asiento que existe solo en el navegador de alguien no existe. El icono de nube
  pertenece a Virtex Almacén y a Virtex POS, que sí operan sin conexión por diseño. Trasladar
  ese vocabulario al ERP promete una garantía que el modelo transaccional no da.

---

## 4. La empresa: por qué debe estar en la URL

### 4.1 El problema, verificado

La regla «una empresa por ventana» es correcta y hoy **imposible**:

- El tenant vive dentro del access token.
- `POST /organizations/switch` emite tokens nuevos en una familia de sesión nueva y **revoca la
  sesión anterior** (`organizations.controller.ts:94-115`).
- Los tokens viajan en cookies, compartidas por todas las ventanas del mismo origen.

Abrir la empresa B no da dos ventanas: convierte la ventana A en B y mata su sesión. La regla
existe para evitar exactamente ese escenario y la implementación lo garantiza.

### 4.2 La decisión

**La empresa pasa a la ruta: `/e/{empresa}/ventas/facturas/123`.** El token acredita *quién
eres* y de qué empresas eres miembro; la URL declara *en cuál estás actuando*; cada petición
verifica la pertenencia contra la base de datos.

Esto modifica la regla normativa de `TAB_ARCHITECTURE.md` §2 («sin prefijo»). La objeción
original era contra un prefijo vacío como `/app`. `/e/{empresa}` no es decorativo: es el dato
que decide qué datos se devuelven.

Lo que se gana:

| | Antes | Después |
|---|---|---|
| Dos empresas a la vez | Imposible; la segunda mata la primera | Dos ventanas del navegador, sin relación entre sí |
| Enlace compartido | Ambiguo: depende del token de quien lo abre | Inequívoco: dice a qué empresa pertenece |
| Verificación del §7.1 anterior («¿misma empresa dueña?») | Requiere consultar el token | Se lee de la URL, gratis |
| Cambiar de empresa | Rotación de sesión y revocación | Abrir otra URL |
| Auditoría | «El usuario hizo X» | «El usuario hizo X actuando en la empresa Y» |

### 4.3 El aislamiento no puede seguir siendo manual

El aislamiento entre empresas se sostiene hoy recordando `where organizationId` en **87
servicios**. No hay interceptor global ni Row-Level Security. Una migración del repositorio
documenta una fuga entre tenants ya ocurrida: *«shipped a cross-tenant leak — every subscriber
receiving every tenant's payloads»*.

La propuesta de producto añade encima siete aplicaciones, dos portales para usuarios externos y
enlaces compartidos. Multiplicar superficies sobre un aislamiento que depende de la memoria del
programador es el mayor riesgo del plan, y ya falló con una sola aplicación.

**Row-Level Security en PostgreSQL, con la empresa en una variable de sesión fijada por el
interceptor de petición.** Ninguna consulta puede olvidarla porque el motor no se lo permite.
Es lo que convierte el plan de siete aplicaciones en algo defendible en vez de temerario.

El mismo defecto existe en el canal de eventos: `events.gateway.ts:71` emite
`user-status-update` con `this.server.emit(...)` —difusión global, sin sala por empresa—, de
modo que cada usuario de cada empresa recibe la conexión de todos los demás. La presencia por
documento que pide la especificación se construiría sobre una fuga existente. Salas por
`(empresa, recurso)` antes de cualquier función de presencia.

---

## 5. Los cinco gestos

Un ERP se siente profesional cuando la regla que el usuario aprendió en Ventas también rige en
Compras. Eso no se consigue con una guía de estilo, sino acotando el vocabulario de interacción.

**Toda interacción del ERP es uno de cinco gestos. No se inventa un sexto.**

| Gesto | Qué es | Tratamiento canónico | Ventana |
|---|---|---|---|
| **Buscar** | Encontrar un conjunto | Lista con vistas guardadas, columnas configurables, virtualización | `lista` |
| **Leer** | Entender un registro | Documento: encabezado, cuerpo, panel lateral de comentarios e historial | `documento` |
| **Redactar** | Cambiar un borrador | Edición en línea dentro del documento, validación bajo el campo | `borrador` |
| **Transicionar** | Ejecutar la acción de negocio | Precondiciones + efectos, y confirmación (§6) | superpuesta |
| **Ejecutar** | Lanzar trabajo largo | Panel de trabajos con progreso y resultado (§7.6) | panel |

Cada gesto tiene un solo componente rector, en la capa compartida. Un módulo no escribe su
propia lista ni su propio documento: los configura.

El beneficio no es de código. Es que **el usuario aprende el sistema una vez**. Y el
desarrollador que llega en un año no puede inventar una sexta forma de mostrar una lista,
porque no hay dónde ponerla.

---

## 6. La transición con previsualización de efectos

Aquí es donde el producto se separa de sus competidores, y es la propuesta que más justifica
el «sin importar el costo».

### 6.1 El problema

En todo ERP de mercado medio, pulsar **Emitir** es un acto de fe. El usuario descubre lo que
pasó después de que pasó: si el periodo estaba cerrado, si había secuencia disponible, si el
asiento cuadró, qué cuentas se movieron. Cuando algo sale mal, la corrección es un asiento de
ajuste y una conversación incómoda con el auditor.

### 6.2 La propuesta

**Toda transición de negocio se previsualiza antes de ejecutarse.** Al pulsar «Emitir», antes
de confirmar, el usuario ve dos bloques:

**Precondiciones** — cada una con su estado, y las que fallan con su remedio y un enlace para
resolverlo:

```
✓ Periodo contable 2026-09 abierto
✓ Secuencia fiscal B01 disponible — siguiente: B0100000247
✓ Existencias suficientes en Almacén Central
✗ Cliente excede su límite de crédito (RD$ 45,800 sobre RD$ 40,000)
     → Solicitar excepción · Ver estado de cuenta
```

**Efectos** — lo que va a ocurrir, en el lenguaje de cada dominio:

```
Asiento contable  #—  (borrador)
   1101 Cuentas por cobrar          45,800.00
   4101 Ingresos por ventas                      38,813.56
   2105 ITBIS por pagar                           6,986.44
   5101 Costo de ventas             27,400.00
   1301 Inventario                                27,400.00

Movimientos de existencias   3 líneas · Almacén Central
Secuencia fiscal             consume B0100000247
Comprobante electrónico      se enviará a DGII tras confirmar
```

### 6.3 Por qué esto es viable aquí y no en otros

Porque el backend **ya calcula todo esto**. Existen `invoice-posting.service.ts` con el asiento
y el costo de venta (líneas 157-180), `PeriodLockGuard`, las secuencias fiscales, `stock_movements`
y `after-commit.service.ts`, que retiene los efectos hasta que la transacción es durable.

Lo que falta no es lógica: es **exponerla sin ejecutarla**. Regla arquitectónica:

> Todo endpoint de transición tiene un gemelo de previsualización que devuelve precondiciones y
> efectos sin comprometer nada, calculado por el mismo código que después ejecuta.

«Por el mismo código» es la parte que importa. Una previsualización calculada aparte es una
segunda fuente de verdad —justo lo que prohíbe el §1— y mentiría en cuanto las dos derivaran.

### 6.4 Qué compra esto

- **Confianza contable.** Un contador que ve el asiento antes de emitir, firma. Es la diferencia
  entre una herramienta que ejecuta y una en la que se delega.
- **Formación.** El usuario nuevo aprende la contabilidad de su negocio usándola.
- **Menos soporte.** «¿Por qué esta factura movió esa cuenta?» se responde antes de preguntarla.
- **Auditoría.** La previsualización aceptada se guarda junto a la transición: queda registrado
  qué se le mostró al usuario cuando decidió.
- **Es demostrable.** En una venta contra un competidor establecido, esta pantalla gana la
  reunión.

Requiere además **clave de idempotencia obligatoria** en toda transición. Hoy existe para el
alta y Stripe, no para facturas ni cobros: un doble clic en «Emitir» puede postear dos veces.

---

## 7. Estructura de la interfaz y flujo

### 7.1 Anatomía de la ventana

```
┌──────────────────────────────────────────────────────────────────────┐
│ [V]  ◀ ▶   [● Nortex Comercial ▾]   [Buscar…  Ctrl K]   [⚙][🔔][👤]  │  barra de aplicación
├──────┬───────────────────┬───────────────────────────────────────────┤
│      │                   │  ┌─────────┬──────────┬────────┐    [+]   │
│  ▪   │  VENTAS           │  └─────────┴──────────┴────────┘          │  ventanas
│Vent. │                   ├───────────────────────────────────────────┤
│      │  Bandeja      12  │                                           │
│  ▪   │                   │                                           │
│Comp. │  Facturas         │                                           │
│      │  Cotizaciones     │            área de trabajo                │
│  ▪   │  Pedidos          │                                           │
│Inv.  │  Cobros           │                                           │
│      │                   │                                           │
│  ▪   │  ── Maestros ──   │                                           │
│Cont. │  Clientes         │                                           │
│      │  Listas de precio │                                           │
│  ▪   │                   │                                           │
│Tes.  │  ── Vistas ──     │                                           │
│      │  Vencidas +30d ★  │                                           │
│  ⚙   │  Sin cobrar ★     │                                           │
├──────┴───────────────────┴───────────────────────────────────────────┤
│ Nortex · Periodo 2026-09 abierto · DOP · 2 trabajos · Conectado      │  barra de estado
└──────────────────────────────────────────────────────────────────────┘
```

**Rail de módulos** — la división por módulos, hecha visible y primaria. Los no contratados se
muestran atenuados con candado, no se ocultan.

**Panel del módulo** — tres bloques con orden fijo en los diez módulos: la **Bandeja**, los
**documentos** del módulo, sus **maestros**, y las **vistas guardadas** del usuario. Que el
orden sea idéntico en todos es lo que hace que el segundo módulo no haya que aprenderlo.

**Barra de estado** — ausente en la especificación anterior y, a mi juicio, el elemento que más
profesionalismo aporta por línea de código: **el estado del mundo, siempre visible.** Empresa
activa, periodo contable y si está abierto, moneda base, trabajos en curso, conexión.

Su justificación es concreta: la frustración más común en un ERP es intentar trabajo que el
sistema va a rechazar. Un usuario que ve «Periodo 2026-08 cerrado» no intenta postear en agosto.
Es información que el sistema ya tiene y que hoy solo revela al fallar.

### 7.2 La Bandeja: el flujo de trabajo diario

Cada módulo abre en su **Bandeja**: qué requiere atención aquí, ordenado por lo que bloquea, no
por fecha ni por tipo.

```
BANDEJA DE VENTAS                                        12 requieren atención

  ⛔  Factura B0100000231 · Distribuidora del Este      RD$ 45,800
      Sin existencias en 2 líneas · bloquea la emisión           [Resolver]

  ⛔  Cobro no aplicado · Ferretería La Económica       RD$ 12,300
      Recibido hace 6 días, sin factura asociada               [Aplicar]

  ⚠   Cotización COT-0092 · Proyectos Globales         RD$ 89,400
      Sin respuesta hace 9 días · vence en 3                 [Dar seguimiento]
```

Tres cosas la hacen distinta de una lista con filtro:

1. **Ordena por bloqueo**, no por fecha. Un pedido sin stock va sobre una cotización sin
   responder porque detiene más dinero.
2. **Dice el motivo en lenguaje de negocio**, no el estado técnico. «Sin existencias en 2 líneas»,
   no «estado = BLOQUEADO».
3. **Ofrece la acción que resuelve**, no solo el enlace al documento.

**Mi trabajo** agrega las diez bandejas en una sola vista, ordenada por el mismo criterio. Es la
pantalla de inicio del usuario y sustituye al `/overview` actual, que hoy muestra la actividad
inventada de una empresa que no existe.

Es computable hoy: sale de documentos y sus estados. No requiere la entidad de proceso que no
existe.

### 7.3 Flujo de trabajo canónico

```
Mi trabajo  ──▶  clic en un ítem
                      │
                      ▼
              Ventana del documento en su módulo
                      │
                      ├──▶ Redactar (edición en línea, validación bajo el campo)
                      │
                      └──▶ Transicionar
                             │
                             ▼
                    Precondiciones + efectos  ──✗──▶  remedio con enlace
                             │
                             ✓
                             ▼
                    Ejecutar (idempotente)
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        Documento      Barra de estado   Bandeja
        transiciona    refleja el efecto  se actualiza
```

El bucle se cierra: la acción cambia la bandeja de la que salió. El usuario ve que su trabajo
redujo la cola. Ningún ERP de mercado medio cierra este bucle.

### 7.4 El proceso como lente

Recuperada la buena idea de la especificación anterior, en el lugar donde no compromete la
navegación.

Un **proceso** es una definición declarativa sobre documentos que ya existen: etapas, reglas de
transición y motivos de bloqueo. No es un módulo ni un menú: es una **vista** que se abre desde
Mi trabajo y muestra el ciclo completo —cotización → pedido → factura → cobro → asiento— con
conteos e importes por etapa.

Se construye **después** del manifiesto de módulo y de la Bandeja, porque necesita que cada
módulo declare qué documentos aporta a qué etapa. Construida antes, es una maqueta.

### 7.5 Cruce entre módulos

La creación rápida en línea de la especificación anterior (§6.6) es correcta y se conserva: al
escribir un producto que no existe, el campo ofrece crearlo con los campos esenciales, y
«Editar completo» lo abre en su propia ventana sin perder el documento en curso.

La adición: **qué puede crearse rápido lo declara el manifiesto** (`crearRapido`), no cada
formulario por su cuenta. Así el conjunto de creaciones rápidas es auditable y consistente, y
no crece por acumulación.

### 7.6 Trabajos largos

Cierre mensual, consolidación, importación, revaluación de moneda y emisión masiva tardan
minutos. El modelo de ventanas asume interacción; sin un concepto de trabajo, estas operaciones
o bloquean una ventana o desaparecen de la vista.

La infraestructura existe y está en uso: BullMQ con tres colas registradas (`account-jobs`,
`recurring-entries`, `mail`). Lo que falta es el concepto **de cara al usuario**: iniciar,
progreso, cancelar, resultado, notificación al terminar, y un histórico consultable.

Un trabajo se lanza desde su módulo, vive en el panel de trabajos, se cuenta en la barra de
estado y notifica al concluir. Cerrar la ventana que lo lanzó no lo cancela.

### 7.7 Paleta de comandos

`Ctrl+K` alimentada por los manifiestos: cada módulo aporta sus acciones y sus tipos buscables.
Al no ser una lista central, no se desincroniza.

La búsqueda cruza entidades: escribir el nombre de un cliente devuelve su ficha, sus facturas y
sus cobros agrupados. El usuario no debería tener que saber en qué módulo buscar.

---

## 8. Permisos: la espina, no una pantalla

El inventario encontró que el frontend simula un control que el backend no aplica: 43 de 73
controladores declaran permisos y `PermissionsGuard` no es `APP_GUARD`. `InventoryController`,
`SuppliersController`, `PriceListsController`, `DatasheetsController` y otros quedan accesibles
a cualquier miembro autenticado, mientras la interfaz finge restringirlos.

En la estructura propuesta el permiso deja de ser un campo que se recuerda:

- El manifiesto **obliga** a declarar el permiso de cada ruta; sin él no compila.
- La visibilidad del menú se deriva del permiso de la ruta.
- El `WindowHost` verifica antes de montar; una ventana no puede existir sin autorización.
- El backend deniega por defecto: una ruta sin permiso declarado no arranca.
- Si el permiso se revoca con la ventana abierta, la ventana degrada a un estado explícito de
  «sin acceso». Nunca se queda mostrando datos que ya no corresponden.

---

## 9. Errores de negocio

«Periodo cerrado», «límite de crédito excedido», «sin existencias» y «requiere aprobación» no
son errores de validación: son **estados legítimos del negocio** que el sistema conoce.

Cada uno es un tipo con código estable, mensaje localizado, remedio y enlace profundo a donde se
resuelve. Aparecen en las precondiciones de la transición (§6.2) antes de intentar, y como
resultado si algo cambió entre la previsualización y la ejecución.

La diferencia con un 400 genérico es la diferencia entre un sistema que te dice qué hacer y uno
que te dice que no.

---

## 9-bis. Estado de implementación

Lo que sigue está construido, verificado y en la rama. El resto de este documento describe el
destino; esta tabla dice hasta dónde se llegó.

| Capa | Estado | Verificación |
|---|---|---|
| **Permisos: guard global y denegación por defecto** | **Hecho** | 102 handlers sin declarar pasan a 0. `route-authorisation.spec.ts` falla nombrando cualquier ruta nueva que no declare. Comprobado que falla al quitar un decorador |
| **Idempotencia en transiciones** | **Hecho** | 15 transiciones con `@Idempotent()`. 7 pruebas cubren reintento, doble clic concurrente, misma clave con otro cuerpo, y liberación tras fallo |
| **Aislamiento por empresa (RLS)** | **Hecho, extremo a extremo** | 79 tablas con política. `verify:rls` lo demuestra en la base; `verify:rls-runtime` lo demuestra a través de la aplicación, como rol `virtex_app`, con repositorios `@InjectRepository` corrientes. Se activa cambiando `DB_USERNAME` |
| **Presencia acotada por empresa** | **Hecho** | El gateway difundía a todos los sockets. 5 pruebas, verificado que fallan al reintroducir la difusión |
| **Manifiesto de módulo y ventana = ruta** | **Hecho** | 89 rutas declaradas, 42 entradas de menú, **42 abren su página, 0 «En construcción»** (antes: 10 de 50). 13 pruebas sobre la derivación |
| Los cinco gestos como componentes rectores | Pendiente | — |
| **Barra de estado** | **Hecha** | Empresa, periodo y si está abierto, moneda base y conexión, permanentes. `GET /accounting/current-period`. 6 pruebas |
| **Errores de negocio tipados** | **Ya existía** | 695 lanzamientos con código estable, clave localizada y parámetros — lo cubrió el trabajo de `main`. Lo que faltaba, el remedio, vive ahora en `REMEDIES` |
| Panel de trabajos | Pendiente | — |
| **Previsualización de transiciones** | **Hecha** | Ejecuta la transición real y la deshace. `verify:invoicing` comprueba que no deja rastro y que el número e importe previstos son los emitidos. 8 pruebas del diálogo |
| Bandeja por módulo y Mi trabajo | Pendiente | — |
| Empresa en la URL y workspace en servidor | Pendiente | — |
| Modo taller · El proceso como lente | Pendiente | — |

### Cómo se activa el aislamiento

Las políticas están instaladas y el contexto por petición está construido. Falta un único cambio
**operativo**, no de código:

```
DB_USERNAME=virtex_app   # en vez del dueño de las tablas
```

`ENABLE ROW LEVEL SECURITY` no aplica al dueño de una tabla. Mientras la API conecte como dueño,
las políticas existen y no protegen; conectando como `virtex_app` —que no posee nada— pasan a
regir. El rol lo crea la propia migración, con permisos sobre las tablas presentes y futuras.

Lo que hace que ese cambio sea seguro es que el camino ya está probado con los dos roles:

- `npm run verify:rls` — contra la base: sin contexto no se ve ninguna fila, cada empresa ve solo
  la suya, insertar en otra es rechazado, y ninguna tabla con empresa obligatoria queda sin política.
- `npm run verify:rls-runtime` — a través de la aplicación, con el inyector real: un repositorio
  `@InjectRepository` **sin filtro de empresa en la consulta** devuelve solo lo del tenant activo,
  el query builder obedece, `dataSource.transaction` usa la conexión de la petición, y fuera de
  contexto no se ve nada. El script **se niega a correr como dueño**, para no reportar un éxito que
  vendría del motivo equivocado.

`TenantConnectionInterceptor` fija la conexión de cada petición y estampa el tenant; el parche de
`Repository.manager` y `DataSource.transaction` hace que los 91 servicios que usan
`@InjectRepository` y los 96 sitios que abren transacción viajen por ella sin tocarlos.

Dos cosas que solo aparecieron al ejecutarlo, y que conviene saber:

1. El parche debe aplicarse **al cargar el módulo**, no en `onModuleInit`: los repositorios se
   construyen durante la inicialización y `Repository` asigna `this.manager` en su constructor, de
   modo que una propiedad propia tapa para siempre el accesor del prototipo.
2. Al liberar la conexión hay que usar `RESET`, no fijar cadena vacía: `''::uuid` lanza
   `invalid input syntax for type uuid`, y la petición fallaría con un error de base de datos en
   vez de simplemente no ver nada. Las políticas usan `NULLIF` por si acaso.

**Los trabajos en cola también.** Un procesador de BullMQ no tiene petición HTTP, así que
`runAsTenantJob` establece su contexto a partir del `organizationId` que ahora viaja en el payload
—no se deduce leyendo, porque esa lectura es justo la que no tendría contexto todavía—. En
intercompañía el tenant del trabajo es la empresa **destino**, que es en cuyos libros postea.
`queue-tenancy.spec.ts` falla si un procesador nuevo lo olvida; `mail` está exento y dice por qué.

---

## 10. Orden de construcción

Cada capa hace barata la siguiente. Ninguna se sostiene sin la anterior.

| # | Capa | Por qué va aquí |
|---|---|---|
| 1 | RLS por empresa · `PermissionsGuard` global · idempotencia en transiciones | Correcciones de seguridad; no dependen de nada y condicionan todo |
| 2 | **Manifiesto de módulo** y `WindowHost` sobre la tabla de rutas única | Elimina el bug de las dos tablas por construcción y hace visible el 80% ya construido |
| 3 | Los cinco gestos como componentes rectores compartidos | Hace que los diez módulos se sientan uno solo |
| 4 | Barra de estado · Panel de trabajos · Errores de negocio tipados | Alto valor, esfuerzo bajo, sin dependencias nuevas |
| 5 | Previsualización de transiciones | Es el diferenciador; necesita 1 y 3 |
| 6 | Bandeja por módulo y Mi trabajo | Sustituye el `/overview` mock por trabajo real |
| 7 | Empresa en la URL y workspace en servidor | Habilita multi-empresa real y «continuar en otro equipo» |
| 8 | Modo taller de Dockview | Función de poder; después de que el modo enfocado sea sólido |
| 9 | El proceso como lente | Requiere que los módulos declaren sus etapas |
| 10 | Aplicaciones satélite y capa compartida extraída | Cuando el manifiesto tenga un consumidor probado |

La capa compartida se **extrae** de dos consumidores reales. Inventada antes de tener uno, se
convierte en el problema que quería resolver.

---

## 11. Lo que esta propuesta rechaza

| Rechazado | Motivo |
|---|---|
| Navegación primaria por procesos | El backend no modela el proceso; sería la función más visible construida como maqueta |
| Un módulo de «Datos maestros» | Cajón de sastre sin dueño; 8 de sus 13 páginas actuales son mock, y esa es la causa |
| Ventanas internas por defecto | Función de poder; obligatoria castiga a la mayoría y elimina la pantalla pequeña |
| Icono de sincronización en el ERP | Promete una garantía que un ERP transaccional no da; pertenece al POS y a Almacén |
| Catálogo de ventanas separado del router | Es el defecto que ya tiene el producto |
| Siete aplicaciones desde el primer día | Hoy no se logra coherencia con una; siete darían siete incoherencias |
| Previsualización calculada aparte de la ejecución | Segunda fuente de verdad; mentiría en cuanto ambas derivaran |

---

## 12. Resumen de decisiones

| Decisión | Alternativa descartada | Motivo |
|---|---|---|
| El módulo es la unidad de propiedad, permisos y navegación | El proceso como unidad principal | El proceso no puede ser dueño de tablas, permisos ni releases |
| Manifiesto único por módulo | Cinco listas mantenidas a mano | El desacople entre ellas es el bug actual |
| La ventana es una ruta resuelta | Catálogo de ventanas paralelo | Un catálogo aparte se desincroniza; ya pasó |
| URL = elemento enfocado; layout = estado de servidor | Codificar el layout en la URL | URLs ilegibles; el layout es preferencia, no identidad |
| Empresa en la ruta | Empresa en el token | Con el token, dos empresas a la vez es imposible |
| Aislamiento por RLS en PostgreSQL | `where organizationId` en 87 servicios | Ya produjo una fuga entre tenants |
| Cinco gestos, sin un sexto | Cada módulo resuelve su UI | El vocabulario acotado es lo que se percibe como coherencia |
| Transición con precondiciones y efectos | Ejecutar y avisar después | Es donde se gana la confianza de quien firma los números |
| Barra de estado permanente | Descubrir el estado al fallar | El sistema ya conoce el dato; ocultarlo solo genera intentos fallidos |
| Bandeja por módulo, ordenada por bloqueo | Lista con filtro por fecha | El bucle se cierra: la acción reduce la cola de la que salió |
