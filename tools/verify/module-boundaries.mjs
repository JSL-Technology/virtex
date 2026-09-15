#!/usr/bin/env node
/**
 * Comprueba la frontera entre módulos declarada en `module-boundaries.config.mjs`.
 *
 * ## Qué comprueba
 *
 * Seis familias de violación, todas medidas sobre los imports reales del árbol:
 *
 * 1. `forbidden-dependency` — una arista hacia un módulo que el DAG no permite.
 * 2. `module-cycle` — A ↔ B. Ninguno se extrae sin el otro.
 * 3. `private-import` — import de `entities/`, `services/`, `dto/`… de otra carpeta. Acoplarse al
 *    interior de otro módulo es acoplarse a algo que su dueño tiene derecho a cambiar sin avisar.
 * 4. `foreign-entity-registration` — `forFeature([X])` con `X` de otro dueño: repositorio directo
 *    sobre la tabla ajena, que es la negación de «una tabla, un dueño».
 * 5. `cross-module-transaction` — pasar un `EntityManager` o un `QueryRunner` a un servicio de otro
 *    módulo. Una transacción que abarca dos dueños es el bloqueo más duro para separarlos: dos
 *    bases de datos no comparten un `BEGIN`.
 * 6. `forward-ref` — `forwardRef` en un `@Module`. No resuelve el ciclo; lo esconde del compilador
 *    dejándolo intacto en el grafo de despliegue.
 *
 * ## Cómo falla (el trinquete)
 *
 * El proyecto arranca con miles de violaciones, así que un fallo binario sería un gate que nadie
 * puede pasar y que por lo tanto se desactiva en una semana. En su lugar, `module-boundaries.baseline.json`
 * registra cuántas violaciones de cada tipo hay por par de módulos, y este verificador falla si
 * **alguna cuenta sube** o aparece un par nuevo. Bajar es gratis; subir cuesta el build.
 *
 * `--update` reescribe el baseline. Solo debe usarse cuando las cuentas bajan: el verificador se
 * niega a escribir un baseline peor que el vigente salvo con `--force`, para que una regresión no
 * se normalice por accidente.
 *
 * `--report` imprime el detalle completo con archivo y línea, sin fallar. Es el modo para trabajar
 * sobre una fase concreta.
 *
 * ## Por qué los `.spec.ts` se cuentan aparte
 *
 * El DAG existe para responder una pregunta: ¿se puede extraer este módulo? Un archivo de prueba no
 * se despliega, así que no cambia la respuesta — contarlo junto al código de producción no es más
 * estricto, es medir otra cosa, y además hace imposible llevar la cifra de producción a cero.
 *
 * Una prueba de integración cruza módulos **por definición**: eso es lo que integra. Las 32 suites
 * con `describeWithDb` de este repositorio ejercitan el ciclo completo de una factura o un cierre, y
 * prohibirles ver dos módulos sería prohibir la prueba de integración.
 *
 * Así que van a sus propias claves, con sufijo `:spec`, y tienen su propio trinquete. Cuando los
 * módulos sean proyectos Nx, estas pruebas serán un proyecto aparte con su propio tag —que es la
 * forma canónica de decir lo mismo— y este sufijo desaparece.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODULE_OF_FOLDER,
  ALLOWED_DEPENDENCIES,
  PUBLIC_SURFACE,
  PUBLIC_SURFACE_EXEMPT_TARGETS,
  RULES,
} from './module-boundaries.config.mjs';

const HERE = join(fileURLToPath(new URL('.', import.meta.url)));
const ROOT = join(HERE, '..', '..');
const APP = join(ROOT, 'apps', 'backend', 'api', 'src', 'app');
const BASELINE_PATH = join(HERE, 'module-boundaries.baseline.json');

const args = new Set(process.argv.slice(2));
const MODE_UPDATE = args.has('--update');
const MODE_REPORT = args.has('--report');
const FORCE = args.has('--force');

// ── Recolección ─────────────────────────────────────────────────────────────────────────────────

function collect(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/**
 * Comentarios fuera. Un docstring que cita el antipatrón —como el de este archivo— no es una
 * violación, y un import comentado tampoco es una dependencia.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');
}

const files = collect(APP);
const violations = [];

/** Toda carpeta de primer nivel necesita dueño declarado. */
const unmapped = readdirSync(APP)
  .filter((e) => statSync(join(APP, e)).isDirectory())
  .filter((e) => !(e in MODULE_OF_FOLDER));

// ── Reglas 1-3: el grafo de imports ─────────────────────────────────────────────────────────────

const isPublic = (relPath) => PUBLIC_SURFACE.some((re) => re.test(relPath));

for (const file of files) {
  const rel = relative(APP, file).split('\\').join('/');
  const fromFolder = rel.split('/')[0];
  const fromModule = MODULE_OF_FOLDER[fromFolder];
  if (!fromModule) continue;

  const isSpec = rel.endsWith('.spec.ts');
  const source = stripComments(readFileSync(file, 'utf8'));
  const lines = source.split('\n');

  lines.forEach((line, i) => {
    const m = line.match(/from\s+['"](\.[^'"]+)['"]/) || line.match(/import\(\s*['"](\.[^'"]+)['"]\s*\)/);
    if (!m) return;

    const targetRel = relative(APP, resolve(dirname(file), m[1])).split('\\').join('/');
    if (targetRel.startsWith('..')) return;

    const toFolder = targetRel.split('/')[0];
    const toModule = MODULE_OF_FOLDER[toFolder];
    if (!toModule || toModule === fromModule) return;

    const where = { file: rel, line: i + 1, spec: m[1], from: fromModule, to: toModule, isSpec };

    const scoped = (rule) => (isSpec ? `${rule}:spec` : rule);

    if (!(ALLOWED_DEPENDENCIES[fromModule] ?? []).includes(toModule)) {
      violations.push({ rule: scoped(RULES.FORBIDDEN_DEPENDENCY), ...where });
    }
    if (!PUBLIC_SURFACE_EXEMPT_TARGETS.includes(toModule) && !isPublic(targetRel)) {
      violations.push({ rule: scoped(RULES.PRIVATE_IMPORT), ...where });
    }
  });
}

/**
 * Ciclos de dos nodos sobre el grafo agregado por módulo, **solo con aristas de producción**: una
 * prueba no se despliega, así que no puede impedir que un módulo se extraiga.
 */
const edge = new Set();
for (const f of files) {
  const rel = relative(APP, f).split('\\').join('/');
  if (rel.endsWith('.spec.ts')) continue;
  const fromModule = MODULE_OF_FOLDER[rel.split('/')[0]];
  if (!fromModule) continue;
  const source = stripComments(readFileSync(f, 'utf8'));
  for (const m of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const t = relative(APP, resolve(dirname(f), m[1])).split('\\').join('/');
    if (t.startsWith('..')) continue;
    const toModule = MODULE_OF_FOLDER[t.split('/')[0]];
    if (toModule && toModule !== fromModule) edge.add(`${fromModule}>${toModule}`);
  }
}
const cycles = new Set();
for (const e of edge) {
  const [a, b] = e.split('>');
  if (edge.has(`${b}>${a}`)) cycles.add([a, b].sort().join(' <-> '));
}
for (const c of cycles) {
  const [a, b] = c.split(' <-> ');
  violations.push({ rule: RULES.MODULE_CYCLE, from: a, to: b, file: '(grafo)', line: 0, spec: c });
}

// ── Regla 4: entidades ajenas registradas ───────────────────────────────────────────────────────

/** Clase de entidad → carpeta que la declara. */
const entityOwner = new Map();
for (const file of files) {
  const rel = relative(APP, file).split('\\').join('/');
  const folder = rel.split('/')[0];
  const source = stripComments(readFileSync(file, 'utf8'));
  const re = /@Entity\([^)]*\)\s*(?:@[\w.]+\([^)]*\)\s*)*export\s+class\s+(\w+)/g;
  for (const m of source.matchAll(re)) entityOwner.set(m[1], { folder, module: MODULE_OF_FOLDER[folder], file: rel });
}

for (const file of files) {
  const rel = relative(APP, file).split('\\').join('/');
  if (rel.endsWith('.spec.ts')) continue;
  const fromModule = MODULE_OF_FOLDER[rel.split('/')[0]];
  if (!fromModule) continue;
  const source = stripComments(readFileSync(file, 'utf8'));
  for (const m of source.matchAll(/forFeature\(\s*\[([^\]]*)\]/gs)) {
    const at = source.slice(0, m.index).split('\n').length;
    for (const raw of m[1].split(',')) {
      const cls = raw.trim();
      if (!/^\w+$/.test(cls)) continue;
      const owner = entityOwner.get(cls);
      if (owner && owner.module && owner.module !== fromModule) {
        violations.push({
          rule: RULES.FOREIGN_ENTITY_REGISTRATION,
          from: fromModule,
          to: owner.module,
          file: rel,
          line: at,
          spec: `${cls} (${owner.folder})`,
        });
      }
    }
  }
}

// ── Regla 5: transacción compartida entre módulos ───────────────────────────────────────────────

/**
 * `this.<algo>Service.metodo(..., manager)` — el `EntityManager` del llamador entregado a otro
 * servicio. Se resuelve el módulo destino por el import del tipo de ese servicio en el archivo.
 */
const HANDOFF =
  /this\.(\w+)\s*\.\s*(\w+)\s*\(([^;]{0,400}?)\b(manager|em|entityManager|queryRunner|outerManager|trxManager)\b/g;

for (const file of files) {
  const rel = relative(APP, file).split('\\').join('/');
  if (rel.endsWith('.spec.ts')) continue;
  const fromModule = MODULE_OF_FOLDER[rel.split('/')[0]];
  if (!fromModule) continue;
  const source = stripComments(readFileSync(file, 'utf8'));

  /** propiedad inyectada → módulo, leído del constructor y de los imports del archivo. */
  const propModule = new Map();
  for (const m of source.matchAll(/(?:private|public|protected)\s+(?:readonly\s+)?(\w+)\s*:\s*(\w+)/g)) {
    const [, prop, type] = m;
    const imp = source.match(new RegExp(`import\\s*\\{[^}]*\\b${type}\\b[^}]*\\}\\s*from\\s*['"](\\.[^'"]+)['"]`));
    if (!imp) continue;
    const t = relative(APP, resolve(dirname(file), imp[1])).split('\\').join('/');
    if (t.startsWith('..')) continue;
    const mod = MODULE_OF_FOLDER[t.split('/')[0]];
    if (mod) propModule.set(prop, mod);
  }

  for (const m of source.matchAll(HANDOFF)) {
    const target = propModule.get(m[1]);
    if (!target || target === fromModule) continue;
    violations.push({
      rule: RULES.CROSS_MODULE_TRANSACTION,
      from: fromModule,
      to: target,
      file: rel,
      line: source.slice(0, m.index).split('\n').length,
      spec: `${m[1]}.${m[2]}(…, ${m[4]})`,
    });
  }
}

// ── Regla 6: forwardRef en módulos ──────────────────────────────────────────────────────────────

for (const file of files.filter((f) => f.endsWith('.module.ts'))) {
  const rel = relative(APP, file).split('\\').join('/');
  const fromModule = MODULE_OF_FOLDER[rel.split('/')[0]];
  if (!fromModule) continue;
  const source = stripComments(readFileSync(file, 'utf8'));
  for (const m of source.matchAll(/forwardRef\(\s*\(\)\s*=>\s*(\w+)/g)) {
    violations.push({
      rule: RULES.FORWARD_REF,
      from: fromModule,
      to: m[1],
      file: rel,
      line: source.slice(0, m.index).split('\n').length,
      spec: m[1],
    });
  }
}

// ── Trinquete ───────────────────────────────────────────────────────────────────────────────────

/** `regla|origen|destino` → cuántas. El par es la granularidad: mueve una y se ve. */
const counts = {};
for (const v of violations) {
  const key = `${v.rule}|${v.from}|${v.to}`;
  counts[key] = (counts[key] ?? 0) + 1;
}

const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : { counts: {} };
const previous = baseline.counts ?? {};

const regressions = [];
const improvements = [];
for (const [key, n] of Object.entries(counts)) {
  const before = previous[key] ?? 0;
  if (n > before) regressions.push({ key, before, now: n });
}
for (const [key, before] of Object.entries(previous)) {
  const now = counts[key] ?? 0;
  if (now < before) improvements.push({ key, before, now });
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
const totalBefore = Object.values(previous).reduce((a, b) => a + b, 0);

const byRule = {};
for (const v of violations) byRule[v.rule] = (byRule[v.rule] ?? 0) + 1;

// ── Salida ──────────────────────────────────────────────────────────────────────────────────────

if (MODE_REPORT) {
  const grouped = {};
  for (const v of violations) (grouped[v.rule] ??= []).push(v);
  for (const [rule, list] of Object.entries(grouped)) {
    console.log(`\n═══ ${rule} (${list.length}) ═══`);
    const pairs = {};
    for (const v of list) (pairs[`${v.from} -> ${v.to}`] ??= []).push(v);
    for (const [pair, items] of Object.entries(pairs).sort((a, b) => b[1].length - a[1].length)) {
      console.log(`\n  ${pair}  (${items.length})`);
      for (const it of items.slice(0, 12)) console.log(`    ${it.file}:${it.line}  ${it.spec}`);
      if (items.length > 12) console.log(`    … y ${items.length - 12} más`);
    }
  }
}

console.log('\n── Frontera entre módulos ──');
if (unmapped.length) {
  console.error(`✗ Carpetas sin dueño declarado en MODULE_OF_FOLDER: ${unmapped.join(', ')}`);
}
for (const [rule, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(n).padStart(5)}  ${rule}`);
}
console.log(`   ${String(total).padStart(5)}  TOTAL   (baseline: ${totalBefore})`);

if (MODE_UPDATE) {
  if (total > totalBefore && !FORCE) {
    console.error(
      `\n✗ El baseline no se reescribe hacia arriba (${totalBefore} → ${total}).\n` +
        `  Si la subida es deliberada y está justificada, --force.`,
    );
    process.exit(1);
  }
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify({ generatedFrom: 'tools/verify/module-boundaries.mjs', total, byRule, counts }, null, 2)}\n`,
  );
  console.log(`\n✓ Baseline actualizado: ${totalBefore} → ${total}`);
  process.exit(0);
}

if (unmapped.length) process.exit(1);

if (regressions.length) {
  console.error(`\n✗ ${regressions.length} par(es) empeoraron respecto al baseline:\n`);
  for (const r of regressions.sort((a, b) => b.now - b.before - (a.now - a.before))) {
    const [rule, from, to] = r.key.split('|');
    console.error(`   ${rule}: ${from} -> ${to}   ${r.before} → ${r.now}  (+${r.now - r.before})`);
    for (const v of violations.filter((v) => `${v.rule}|${v.from}|${v.to}` === r.key).slice(0, 6)) {
      console.error(`       ${v.file}:${v.line}  ${v.spec}`);
    }
  }
  console.error(
    `\n  La frontera está declarada en tools/verify/module-boundaries.config.mjs.\n` +
      `  Para ver todo el detalle: npm run verify:boundaries -- --report\n`,
  );
  process.exit(1);
}

if (improvements.length) {
  console.log(`\n✓ ${improvements.length} par(es) mejoraron. Fija el avance con:  npm run verify:boundaries -- --update`);
}
console.log('\n✓ Sin regresiones de frontera.\n');
