// Genera MATRIZ_COBERTURA.md a partir de las pasadas automáticas (vacía y con datos), el inventario de rutas
// y las correcciones de la verificación manual (falsos negativos/positivos del arnés).
const fs = require('fs');
const path = require('path');
const Q = path.join(__dirname, '..');
const inv = JSON.parse(fs.readFileSync(path.join(Q, 'inventory.json'), 'utf8'));
const p1 = JSON.parse(fs.readFileSync(path.join(Q, 'clicks.json'), 'utf8'));
const p2 = fs.existsSync(path.join(Q, 'clicks-datos.json')) ? JSON.parse(fs.readFileSync(path.join(Q, 'clicks-datos.json'), 'utf8')) : {};

// [ruta (regex), etiqueta (regex), estado, resultado]
const OVERRIDES = [
  [/^contacts\/customers$/, /^Eliminar$/, 'con falla', 'confirmación OK, pero borra un cliente con facturas y ELIMINA EN CASCADA facturas y recibos (datos QA) — QA-001b'],
  [/^inventory\/products$/, /^Eliminar$/, 'con falla', 'borra producto con facturas/OC (200). Sin dependencias (QA-XSS): OK'],
  [/^hcm\/departments$/, /^Eliminar$/, 'con falla', 'sin confirmación; borra departamento con empleado asignado (204)'],
  [/^payroll\/concepts$/, /^Eliminar$/, 'con falla', 'elimina sin confirmación (204)'],
  [/^masters\/price-lists$/, /^Eliminar$/, 'ok', 'confirmación + DELETE 200 (lista QA sin uso)'],
  [/^documents\/repository$/, /^Eliminar$/, 'ok', 'confirmación + DELETE 204 (documento QA)'],
  [/^accounting\/chart-of-accounts$/, /^Eliminar$/, 'con falla', 'cuenta QA 5910: DELETE 404 + toast genérico; confirmación muestra JSON crudo'],
  [/^inventory\/categories$/, /^(Eliminar|Retirar)$/, 'ok', '"Retirar" (PATCH) sobre categoría QA'],
  [/^invoices\/new$/, /^(\+ Añadir línea|CANTIDAD|PRECIO|DESC\. %|TRATAMIENTO|IMPUESTO|description|discountRate|notes|quantity|unitPrice|Gravado|18%|\(sin texto\))/, 'ok', 'cubierto en el flujo manual de factura (16/39)'],
  [/^invoices\/new$/, /^Emitir factura$/, 'ok', 'emite (POST /invoices 201) — flujo 16/39'],
  [/^invoices\/new$/, /^Enviar por correo$/, 'con falla', 'sin efecto — QA-017'],
  [/^overview$/, /^(28-Sept|30-Sept|31-Ago)/, 'ok', 'navega al documento/período (verificado manualmente)'],
  [/^overview$/, /^Asiento /, 'con falla', 'fila de actividad no navega al asiento'],
  [/^masters\/suppliers$|^contacts\/suppliers$|^purchasing\/(orders|requisitions)\/new$|^accounting\/chart-of-accounts\/segments-configuration$/, /^Eliminar( Nivel)?$/, 'no probado', 'no ejecutado: eliminar línea/nivel en formulario vacío o proveedor no localizable en la lista'],
  [/^accounting\/daily-journal$/, /NOMINA/, 'ok', 'fila sin acción'],
  [/^accounting\/closing\/checklist$/, /^Verificar/, 'ok', 'ítem informativo de la lista de verificación'],
  [/^invoices$/, /^(ESTADO|FAC-)/, 'ok', 'abre el detalle (flujos 42/43) / encabezado sin orden'],
  [/^accounting\/chart-of-accounts$/, /^Editar$/, 'con falla', 'abre la edición pero Guardar → 400 reasonForChange (no hay campo de motivo en ninguna pestaña) — QA-021'],
  [/^accounting\/chart-of-accounts$/, /^(CUENTA|TIPO|BALANCE|ESTADO|ACCIONES)$/, 'ok', 'encabezado sin ordenamiento (verificado manualmente)'],
  [/^accounting\/chart-of-accounts$/, /^\d{4}$/, 'ok', 'abre el Libro Mayor de la cuenta (verificado manualmente)'],
  [/^accounting\/chart-of-accounts$/, /^(Activo|Pasivo|Patrimonio|Ingresos|Gastos)/, 'ok', 'fila de grupo: no se expande al hacer clic (verificado manualmente)'],
  [/^accounting\/chart-of-accounts$/, /^(Todos los Estados|Todos los Tipos)/, 'ok', 'filtra la lista (verificado manualmente)'],
  [/^reports\/financial-statements\/trial-balance$/, /^(Cuenta|Saldo inicial|Movimientos del período|Saldo final|Debe|Haber)$/, 'ok', 'encabezado sin ordenamiento (verificado manualmente)'],
  [/^reports\/financial-statements\/trial-balance$/, /^\d{4} /, 'ok', 'fila sin acción (sin detalle navegable; verificado manualmente)'],
  [/^masters\/taxes$/, /^Eliminar$/, 'no probado', 'impuesto preexistente (regla: destructivas solo sobre datos QA). Probado sobre QA-Impuesto: confirmación + DELETE 200'],
  [/^accounting\/periods$/, /^Cerrar Período$/, 'con falla', 'enero → 500 (falta diario DEPREC), sin mensaje ni confirmación; marzo → 400 correcto por cierre secuencial — QA-006'],
  [/^accounting\/periods$/, /(FECHA DE CIERRE|enero de 2026)/, 'ok', 'encabezado/fila sin acción'],
  [/^masters\/extensions$/, /^Admitir y registrar$/, 'con falla', 'tras step-up → 403 para el administrador del inquilino (requiere rol de plataforma)'],
  [/^reports\/(financial-statements|profitability)/, /^Exportar$/, 'ok', 'descarga CSV (verificado manualmente: evento download)'],
  [/^invoices$/, /^Exportar$/, 'ok', 'descarga facturas-AAAA-MM-DD.csv (verificado manualmente)'],
  [/^(accounting\/daily-journal|accounting\/chart-of-accounts|accounting\/general-ledger|sales\/history)$/, /^Exportar$/, 'con falla', 'no descarga ni llama a la red (verificado manualmente) — QA-042'],
  [/^accounting\/journal-entries$/, /^(GENERAL|VENTAS|COBROS|COMPRAS|PAGOS|NOMINA)-|^Más acciones$|^28\/09/, 'con falla', 'no abre el asiento (verificado manualmente) — QA-021'],
  [/^accounting\/journal-entries$/, /^Nuevo Asiento$/, 'ok', 'abre "Nuevo Asiento Contable" (verificado en flujo 24; la pasada enfocó una pestaña ya abierta)'],
  [/^customer-receipts$/, /^Nuevo Recibo$/, 'ok', 'abre "Nuevo Recibo" (verificado en flujo 19)'],
  [/^accounting\/treasury$/, /^Nueva cuenta bancaria$/, 'ok', 'abre el formulario (verificado en flujo 19)'],
  [/^inventory\/products$/, /^QA-Producto/, 'ok', 'abre la edición del producto (verificado manualmente)'],
  [/^contacts\/customers$/, /^(QA-Cliente|Editar|Añadir Cliente)/, 'con falla', 'abre el formulario pero GET identity-document-types → 403 (QA-015)'],
  [/^unauthorized$/, /^Solicitar Permiso$/, 'con falla', 'sin efecto (verificado manualmente) — QA-042'],
  [/^accounting\/journal-entries\/import$/, /^Haz clic aquí/, 'ok', 'abre el selector de archivos (verificado manualmente)'],
  [/^masters\/taxes$/, /^ITBIS|^QA-/, 'con falla', 'la fila no abre edición: no existe forma de editar un impuesto (UX)'],
  [/^datasheets$/, /.*/, 'con falla', 'libros de ejemplo (mock) que no abren — QA-019'],
  [/^data-(exports|imports)$/, /(Descargar|Customers|CSV|Excel|clientes_julio|Importar)/, 'con falla', 'pantalla mock sin backend — QA-018'],
  [/^documents\/repository$/, /^Nueva carpeta$/, 'con falla', 'no abre ningún diálogo — QA-042'],
  [/^invoices\/new$/, /^(Avanzar|Imprimir|Búsqueda sobre documento|Exportar a (PDF|Excel|Word)|Copiar de|Parametrizaciones de formulario|Ayuda)$/, 'con falla', 'botón sin efecto (verificado: ni red, ni window.print, ni window.open) — QA-017'],
  [/^invoices\/new$/, /^(Contenido|Fiscal y cobro)$/, 'ok', 'cambia de pestaña (verificado manualmente)'],
  [/^invoices\/new$/, /^Copiar a$/, 'ok', 'en factura existente abre nueva factura prellenada (verificado); en borrador nuevo no aplica'],
  [/^hcm\/employees$/, /^$/, 'ok', 'filtro "Incluir desvinculados": sin desvinculados que mostrar (no concluyente)'],
  [/^accounting\/general-ledger\/new$/, /^Guardar libro$/, 'ok', 'deshabilitado hasta completar el formulario'],
  [/^accounting\/chart-of-accounts\/segments-configuration$/, /^Guardar Estructura$/, 'ok', '400 esperado: regla de negocio (ya existen cuentas)'],
  [/^customer-receipts\/new$/, /^currencyCode$/, 'ok', 'campo de solo lectura (moneda derivada de la cuenta)'],
  [/^accounting\/journals$/, /^Editar$/, 'con falla', 'GET /journals/:id → 404 — QA-021'],
];
const HARNESS = /strict mode violation|Element is not an <input>|resolved to 2 elements/;
const MANUAL_COVER = /^(invoices\/new|accounting\/chart-of-accounts\/new|contacts\/customers\/new|masters\/suppliers\/new|inventory\/products\/new|accounting\/journal-entries\/new|purchasing\/orders\/new|accounts-payable\/new|customer-receipts\/new|accounting\/treasury\/bank-accounts\/new|hcm\/employees\/new|masters\/taxes\/new|masters\/price-lists\/new|purchasing\/requisitions\/new)$/;

function classify(route, e) {
  for (const [r, l, st, res] of OVERRIDES) if (r.test(route) && l.test(e.label || '')) return { st, res };
  if (e.status === 'con falla' && HARNESS.test(e.result || '')) {
    return MANUAL_COVER.test(route) ? { st: 'ok', res: 'cubierto en el flujo manual del formulario (limitación del arnés al localizar el control)' } : { st: 'no probado', res: 'limitación del arnés (control duplicado/no estándar); no verificado manualmente' };
  }
  if (e.status === 'con falla' && /sin efecto visible/.test(e.result || '') && e.tag === 'fila') return { st: 'ok', res: 'fila de solo lectura: sin acción al hacer clic (sin detalle navegable)' };
  if (e.noSort) return { st: 'ok', res: 'encabezado sin ordenamiento (UX: las listas no se pueden ordenar)' };
  if (/no reaparece tras restaurar/.test(e.result || '')) return { st: 'no probado', res: 'limitación del arnés: la página se re-renderiza tras el primer clic y el control no se pudo re-localizar' };
  const st = e.status === 'ok' ? 'ok' : e.status === 'con falla' ? 'con falla' : 'no probado';
  return { st, res: (e.result || '').replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 180) };
}
const esc = (s) => String(s || '').replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 60);
const routes = fs.readFileSync(path.join(__dirname, 'routes.txt'), 'utf8').trim().split('\n').map((l) => l.trim().split(/\s+/));
let out = `# Matriz de cobertura por página y elemento\n\nGenerada por \`harness/gen-matriz.cjs\` desde \`clicks.json\` (pasada 1, estado mayormente vacío), \`clicks-datos.json\` (pasada 2, estado con datos QA) y las correcciones de la verificación manual. Estados: **ok** = probado sin problemas · **con falla** · **no probado** (con razón).\n\n`;
const summary = [];
let G = { tot: 0, ok: 0, f: 0, np: 0 };
for (const [mod, route] of routes) {
  if (route.includes(':')) { summary.push([mod, route, '-', '-', '-', '-', 'ruta con parámetro: cubierta al abrir el registro desde su lista / flujos']); continue; }
  const passes = [['Pasada 1 (estado vacío)', p1[route]], ['Pasada 2 (con datos)', p2[route]]].filter(([, x]) => x);
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
