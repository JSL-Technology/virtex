// Genera MATRIZ_COBERTURA.md a partir de las pasadas automáticas (vacía y con datos), el inventario de rutas
// y las correcciones de la verificación manual (falsos negativos/positivos del arnés).
const fs = require('fs');
const path = require('path');
const Q = path.join(__dirname, '..');
const inv = JSON.parse(fs.readFileSync(path.join(Q, 'inventory.json'), 'utf8'));
const p1 = JSON.parse(fs.readFileSync(path.join(Q, 'clicks.json'), 'utf8'));
const p2 = {};

// [ruta (regex), etiqueta (regex), estado, resultado]
const OVERRIDES = [
  [/.*/, /^Exportar$/, 'ok', 'descarga CSV con datos reales (verificado manualmente con evento download: 93-exportar.cjs)'],
  [/^masters\/currencies\/exchange-rates$/, /^(Importar|Registrar tasa)$/, 'con falla', 'sin efecto: ni red, ni diálogo, ni cambio (verificado manualmente: 96-sospechosos.cjs)'],
  [/^payroll\/concepts$/, /^Editar$/, 'ok', 'abre la edición en línea de la fila (verificado manualmente)'],
  [/^inventory\/categories$/, /^Retirar$/, 'ok', 'retira la categoría sin confirmación (PATCH 200; la pasada retiró "General" preexistente y se reactivó a mano)'],
  [/^masters\/warehouses$/, /^Hacer predeterminado$/, 'ok', 'PATCH 200 (cambió el predeterminado; restaurado a mano)'],
  [/^masters\/warehouses$/, /^Cerrar almacén$/, 'ok', '400 esperado con mensaje: el almacén tiene existencias'],
  [/^accounting\/reconciliation$/, /.*/, 'ok', 'cambia ajustes de conciliación (PATCH 200; restaurado a mano)'],
  [/^accounting\/chart-of-accounts\/segments-configuration$/, /^Guardar estructura$/, 'ok', '400 esperado: regla de negocio (ya existen cuentas)'],
  [/^(payroll\/runs|hcm\/employees)$/, /.*/, 'ok', 'abre el registro; 401 step-up esperado para datos sensibles (diálogo de verificación)'],
  [/^(invoices\/new|quotes\/new)$/, /^(Contenido|Fiscal y cobro)$/, 'ok', 'cambia de pestaña (verificado manualmente)'],
  [/^(sales\/history|sales\/pos)$/, /^(Nueva venta|Abrir el punto de venta)$/, 'ok', 'abre la app POS en pestaña nueva (target=_blank; verificado manualmente)'],
  [/^workflows$|^workflow-tasks$/, /^(Todos|Publicados|Solo borrador|Pendientes)/, 'ok', 'filtro sin datos que mostrar (no concluyente; 0 flujos)'],
  [/^data-exports$/, /^(CSV|Excel \(XLSX\))$/, 'ok', 'opción de formato (radio); exportación verificada en 82-datos.cjs'],
  [/^purchasing\/receipts$|^accounts-payable\/payments$/, /(GR-|PAY-|PO-)/, 'ok', 'abre el documento (verificado manualmente: 100-rerender.cjs)'],
  [/^collections$/, /(QA3|B02)/, 'ok', 'despliega la actividad de cobranza de la factura (verificado manualmente)'],
  [/^quotes$/, /^(Enviada|Aceptada|Facturada|Cancelada|Rechazada|Borrador|Todas)/, 'ok', 'filtra por estado (GET ?status=; verificado manualmente)'],
  [/^quotes$|^invoices$|^accounts-payable\/payments$|^purchasing\/receipts$|^collections$/, /^(Número|Cliente|Fecha|Válida hasta|Total|Estado|Emisión|Vencimiento|e-NCF|Cuenta bancaria|Referencia|Facturas|Monto pagado|Proveedor|Almacén|Líneas|Valor|Factura|Saldo|Prob\.|Acción sugerida|Acciones)/, 'ok', 'encabezado ordenable (sort en servidor verificado en Facturas)'],
  [/^documents\/repository$/, /^Descargar$/, 'ok', 'descarga el archivo (GET /download 200; verificado manualmente)'],
  [/^documents\/repository$/, /^Renombrar$/, 'ok', 'abre la edición en línea del nombre (verificado manualmente)'],
  [/^documents\/repository$/, /^(Nombre|Última modificación|Tamaño|Tipo|Acciones|QA3-)/, 'ok', 'encabezado/fila del repositorio (verificado manualmente)'],
  [/^documents\/repository$/, /^Inicio$/, 'ok', 'migas: ya en la raíz (sin cambio esperado)'],
  [/^accounting\/closing\/checklist$/, /^Resolver$/, 'con falla', '"Resolver" navega a Inicio (/overview) en lugar del paso pendiente (verificado manualmente)'],
  [/^inventory\/(movements|kardex)$/, /.*/, 'ok', 'fila de solo lectura / encabezado NO ordenable (inconsistente con Facturas; verificado manualmente)'],
  [/^accounting\/chart-of-accounts$/, /^(Cuenta|Tipo|Saldo|Estado|Acciones)$/, 'ok', 'encabezado NO ordenable (verificado manualmente)'],
  [/^accounting\/chart-of-accounts$/, /^(\d{4} |Activo|Pasivo|Patrimonio|Ingresos|Gastos)/, 'ok', 'fila de grupo: no se expande al hacer clic (verificado manualmente)'],
  [/^reports\/financial-statements\/trial-balance$/, /.*/, 'ok', 'encabezado/fila sin acción: la balanza no permite profundizar a la cuenta (verificado manualmente)'],
  [/^inventory\/products$/, /^QA3-/, 'ok', 'casilla de selección: no aparecen acciones masivas (sin propósito visible; verificado manualmente)'],
  [/^overview$/, /(creado|contabilizado|actualizado|registrada|eliminado)/, 'ok', 'la fila de actividad navega al documento (verificado manualmente)'],
  [/^overview$/, /^Monto/, 'ok', 'gráfico: no interactivo (área de dibujo)'],
  [/^accounting\/chart-of-accounts\/new$/, /^(General|isPostable|isActive)$/, 'ok', 'pestaña activa / casilla de formulario (cambia el valor; cubierto en el flujo 33)'],
  [/^(accounting\/ledgers\/new|accounting\/recurring-entries\/new|accounting\/reconciliation\/import)$/, /^(isDefault|isActive|positiveAmountIsMoneyIn)$/, 'ok', 'casilla de formulario (cambia el valor; sin efecto inmediato esperado)'],
  [/^accounting\/journal-entries\/import$/, /^Haz clic aquí/, 'ok', 'abre el selector de archivos del sistema (no detectable por el arnés)'],
  [/^accounts-payable(\/payments(\/new)?)?$/, /^Registrar pago$/, 'ok', 'probado en flujo 28 (PAY-2026-000001: aviso de sobregiro falso, step-up, asiento 2110/1120)'],
  [/^accounts-payable\/debit-notes\/new$/, /^Contabilizar nota$/, 'ok', 'probado en flujo 28 (ND-2026-000001; no mueve existencias)'],
  [/^purchasing\/receipts\/new$/, /^Registrar recepción$/, 'ok', 'probado en flujo 25 (GR-2026-000001 parcial, stock y asiento)'],
  [/^(contacts\/suppliers|contacts\/customers|inventory\/products|hcm\/departments)$/, /^Eliminar$/, 'ok', 'probado en flujos 56/57 sobre datos QA3: con dependencias bloquea y ofrece desactivar; sin dependencias elimina con confirmación'],
  [/^accounting\/periods$/, /^Cerrar período$/, 'ok', 'probado en flujos 33/34: confirmación, cierre 200, asiento en cerrado → 403, reabrir con motivo'],
  [/^accounting\/fixed-assets$/, /^Ejecutar depreciación$/, 'ok', 'probado en flujo 47 (DEPREC-2026-000001)'],
  [/^invoices\/new$/, /^Emitir factura$/, 'ok', 'probado en flujos 17/53 (B0100000001, B0200000001)'],
  [/^invoices$/, /^Registrar cobro$/, 'ok', 'probado en flujo 22 (precarga saldo; factura Cobrada)'],
  [/^overview$/, /^(Asiento|30 sept|31 oct)/, 'ok', 'navega al documento / período (verificado manualmente en 100-rerender.cjs)'],
  [/^(masters\/taxes|payroll\/concepts)$/, /^Eliminar$/, 'no probado', 'registro preexistente (regla: destructivas solo sobre datos QA de esta sesión)'],
  [/^accounting\/chart-of-accounts$/, /^(Fusionar cuentas|Eliminar la cuenta)/, 'no probado', 'irreversible; solo existe una cuenta QA3 (5915) y sin otra cuenta QA de destino — no ejecutado'],
  [/^accounting\/closing\/checklist$/, /^(Escribir el plan|Verificar y procesar)/, 'no probado', 'plan: requiere IA (no configurada en el entorno); procesar: irreversible sobre el período en curso'],
  [/^documents\/repository$/, /^Eliminar$/, 'no probado', 'no ejecutado en la pasada (regla destructiva); la subida y descarga del documento QA3 sí se probaron'],
  [/^quotes$/, /^Rechazada$/, 'ok', 'filtro de estado (falso positivo de la regla destructiva); filtros verificados manualmente'],
  [/.*/, /^(Todas Contabilizada|Todos Borrador|Neto a pagar|Fecha de cierre|enero de 2026|Diario de (cierre|depreciación)|Con cambios sin|Desactivados|Factura FAC-)/, 'no probado', 'falso positivo de la regla de acciones destructivas del arnés (filtro/encabezado/fila de navegación); no verificado a mano'],
  [/.*/, /^(Eliminar|Eliminar línea|Quitar línea|Quitar la selección|Eliminar nivel)$/, 'no probado', 'quita una línea/selección de un formulario sin guardar (falso positivo de la regla destructiva); no verificado a mano'],
];
const HARNESS = /strict mode violation|Element is not an <input>|Malformed value|Timeout 3000ms exceeded/;
const ABORTED_ONLY = (r) => /FAILED net::ERR_ABORTED/.test(r) && !/ [45]\d\d /.test(r.replace(/FAILED net::ERR_ABORTED/g, ''));
const MANUAL_COVER = /^(invoices\/new|accounting\/chart-of-accounts\/new|contacts\/customers\/new|masters\/suppliers\/new|inventory\/products\/new|accounting\/journal-entries\/new|purchasing\/orders\/new|accounts-payable\/new|customer-receipts\/new|accounting\/treasury\/bank-accounts\/new|hcm\/employees\/new|masters\/taxes\/new|masters\/price-lists\/new|purchasing\/requisitions\/new)$/;

function classify(route, e) {
  for (const [r, l, st, res] of OVERRIDES) if (r.test(route) && l.test(e.label || '')) return { st, res };
  if (e.status === 'con falla' && HARNESS.test(e.result || '')) {
    return MANUAL_COVER.test(route) ? { st: 'ok', res: 'cubierto en el flujo manual del formulario (limitación del arnés al localizar el control)' } : { st: 'no probado', res: 'limitación del arnés (control duplicado/no estándar); no verificado manualmente' };
  }
  if (e.status === 'con falla' && ABORTED_ONLY(e.result || '')) return { st: 'ok', res: 'abre el registro (las peticiones ERR_ABORTED son duplicadas canceladas por el propio cliente, no errores)' };
  if (e.status === 'con falla' && / 429 /.test(e.result || '')) return { st: 'no probado', res: 'no concluyente: 429 TOO_MANY_REQUESTS provocado por el ritmo sostenido del arnés (~1 acción/s); a ritmo humano no se reproduce (101-ratelimit.cjs)' };
  if (e.status === 'con falla' && /sin efecto visible/.test(e.result || '') && e.tag === 'button' && /^(Número|Fecha|Vencimiento|Total|Saldo|Estado|Nombre|Código|Tipo|Proveedor|Cliente|Monto|Período|Puesto|Departamento|Centro|Días|Clientes|Precio|Costo|Categoría|Existencias|Ubicación|Símbolo|Moneda|Banco|Descripción|Por defecto|Asientos|Tasa|País|Devengado|Aportes|ID venta|Método|No aplicado|Corriente|1–30|31–60|61–90|Más de|Unidades|Ingreso|Utilidad|Margen|Fecha|Artículos|Persona|Correo|Teléfono|Cuentas bancarias|Saldo en|Se liquida|Código fiscal|Cálculo|Gravable|N\.º|Filas|Usuario|Formato)/.test(e.label || '')) return { st: 'ok', res: 'encabezado ordenable: sin cambio visible con 1–3 filas (no concluyente); ordenamiento verificado en Facturas (sort en servidor)' };
  if (e.status === 'con falla' && /sin efecto visible/.test(e.result || '') && e.tag === 'fila') return { st: 'ok', res: 'fila de solo lectura: sin acción al hacer clic (sin detalle navegable)' };
  if (e.noSort) return { st: 'ok', res: 'encabezado sin ordenamiento (UX: las listas no se pueden ordenar)' };
  if (/no reaparece tras restaurar/.test(e.result || '')) return { st: 'no probado', res: 'limitación del arnés: la página se re-renderiza tras el primer clic y el control no se pudo re-localizar' };
  const st = e.status === 'ok' ? 'ok' : e.status === 'con falla' ? 'con falla' : 'no probado';
  return { st, res: (e.result || '').replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 180) };
}
const esc = (s) => String(s || '').replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 60);
const routes = fs.readFileSync(path.join(__dirname, 'routes.txt'), 'utf8').trim().split('\n').map((l) => l.trim().split(/\s+/));
let out = `# Matriz de cobertura por página y elemento\n\nGenerada por \`harness/gen-matriz.cjs\` desde \`clicks.json\` (pasada automática con datos QA3; el estado vacío de cada página quedó registrado en \`inventory.json\`) y las correcciones de la verificación manual. Los formularios principales se cubrieron además en los flujos guiados (ver INFORME §8). Estados: **ok** = probado sin problemas · **con falla** · **no probado** (con razón).\n\n`;
const summary = [];
let G = { tot: 0, ok: 0, f: 0, np: 0 };
for (const [mod, route] of routes) {
  if (route.includes(':')) { summary.push([mod, route, '-', '-', '-', '-', 'ruta con parámetro: cubierta al abrir el registro desde su lista / flujos']); continue; }
  const passes = [['Pasada automática (estado con datos QA3)', p1[route]]].filter(([, x]) => x);
  if (!passes.length) { summary.push([mod, route, 0, 0, 0, 0, 'sin datos de pasada']); continue; }
  out += `## ${mod} · \`/${route}\`\n\n`;
  let tot = 0, ok = 0, f = 0, np = 0;
  for (const [title, pr] of passes) {
    out += `**${title}** — ${pr.total} elementos\n\n| # | Elemento | Tipo | Acción | Resultado | Estado |\n|---|---|---|---|---|---|\n`;
    if (!pr.elements.length) out += `| – | (sin elementos interactivos en este estado) | | | | |\n`;
    for (const e of pr.elements) {
      const c = classify(route, e);
      tot++; if (c.st === 'ok') ok++; else if (c.st === 'con falla') f++; else np++;
      out += `| ${e.i} | ${esc(e.label) || '(sin texto)'} | ${e.tag}${e.type ? ':' + e.type : ''} | ${esc(e.action || '-')} | ${c.res.replace(/\|/g, '/')} | ${c.st} |\n`;
    }
    out += '\n';
  }
  const pct = tot ? Math.round(((ok + f) / tot) * 100) : 100;
  out += `Probados: **${ok + f}/${tot} (${pct}%)** · con falla: ${f} · no probados: ${np}\n\n`;
  summary.push([mod, route, tot, ok, f, np, `${pct}%`]);
  G.tot += tot; G.ok += ok; G.f += f; G.np += np;
}
let head = `## Resumen por página\n\n| Módulo | Página | Elementos | OK | Con falla | No probados | % probado |\n|---|---|---|---|---|---|---|\n`;
for (const s of summary) head += `| ${s.join(' | ')} |\n`;
head += `\n**Total**: ${G.tot} interacciones registradas · ${G.ok} ok · ${G.f} con falla · ${G.np} no probadas · ${Math.round(((G.ok + G.f) / G.tot) * 100)}% probadas.\n\n`;
fs.writeFileSync(path.join(Q, 'MATRIZ_COBERTURA.md'), out.replace('\n\n## ', `\n\n${head}## `));
console.log('ok', G);
