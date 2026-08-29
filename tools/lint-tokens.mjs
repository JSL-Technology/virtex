#!/usr/bin/env node
/**
 * =============================================================================
 *  GUARDIÁN DE TOKENS
 * =============================================================================
 *  Impide que vuelvan a aparecer colores fijos y tokens inexistentes.
 *
 *  Sin esta comprobación la migración se deshace sola: basta con que alguien,
 *  con toda la buena intención, pegue un `#4ade80` en un componente nuevo. La
 *  auditoría que motivó este trabajo encontró 400 literales cromáticos y 40
 *  custom properties usadas pero nunca definidas; ambas cosas se acumularon una
 *  línea cada vez, y ninguna herramienta las señaló.
 *
 *  Comprueba tres cosas:
 *    1. Ningún color literal (hex / rgb / hsl / nombre CSS) fuera del sistema.
 *    2. Toda `var(--x)` usada existe realmente.
 *    3. Ningún componente redefine un token global (secuestro de tema).
 *
 *  Uso:
 *    node tools/lint-tokens.mjs            comprueba
 *    node tools/lint-tokens.mjs --verbose  además, detalla cada hallazgo
 * =============================================================================
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'apps/core/client-web/src');
const ENTRY = 'apps/core/client-web/src/styles.scss';

const VERBOSE = process.argv.includes('--verbose');

/* Rutas donde SÍ se permite escribir colores literales: son las que los
   definen. Todo lo demás debe consumir tokens. */
const COLOR_AUTHORITIES = [
  'assets/styles/design-system/_primitives.scss',
  'assets/styles/design-system/_theme.scss',
  // Traduce nombres heredados a tokens; necesita expresar el color de sombra.
  'assets/styles/design-system/_compat.scss',
];

/* Excepciones acotadas y justificadas, cada una con su motivo. */
const ALLOWED_LITERALS = new Map([
  // Los colores de marca de terceros son literales por definición: alterarlos
  // infringe sus normas de uso.
  ['features/auth/register/steps/step-access/step-access.html', 'logotipo de Google'],
  // Lienzo propio de la pantalla de acceso, con prefijo --auth-.
  ['features/auth/components/auth-layout/auth-layout.component.scss', 'lienzo de autenticación'],
  ['features/auth/components/auth-footer/auth-footer.component.scss', 'transparencias sobre el lienzo'],
  // Página de bienvenida de Nx: andamiaje del generador, no interfaz de producto.
  ['app/nx-welcome.ts', 'plantilla generada por Nx'],
  // Hojas de IMPRESIÓN: el papel no tiene tema. Tinta negra sobre blanco es el
  // resultado correcto y fijarlo es deliberado.
  ['features/invoices/detail/detail.page.scss', 'hoja de impresión de factura'],
  ['features/invoices/detail/detail.page.ts', 'hoja de impresión de factura'],
]);

/*  Un `#` seguido de dígitos aparece también en texto de negocio («Factura
    #00128»), así que se exige que el literal esté en posición de VALOR CSS:
    precedido de `:`, `,`, `(` o espacio dentro de una declaración, y que su
    longitud sea la de un color real (3, 4, 6 u 8 dígitos). */
const HEX = /(?<=[:,(\s])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![0-9a-zA-Z])/g;
const FUNC_COLOR = /\b(?:rgba?|hsla?)\(\s*[0-9]/g;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function stripComments(text, isScss) {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, '');
  if (isScss) out = out.replace(/(^|\s)\/\/[^\n]*/g, '$1');
  return out;
}

/*  Vacía el contenido de las cadenas conservando su longitud. Sin esto, un
    texto de negocio como «Factura #00128» o una dirección «Calle Principal
    #123» se cuenta como color literal. Solo se aplica a TS/HTML: en SCSS un
    color entre comillas sigue siendo un color mal puesto. */
function blankStrings(text) {
  return text.replace(/(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g, (m) => m[0].repeat(m.length));
}

function isAllowed(rel) {
  return [...ALLOWED_LITERALS.keys()].some((k) => rel.includes(k));
}

function main() {
  const files = walk(SRC).filter((f) => /\.(scss|ts|html)$/.test(f) && !f.endsWith('.spec.ts'));

  const literalHits = [];
  const shadowHits = [];
  const usedVars = new Set();
  const definedVars = new Set();

  for (const file of files) {
    const rel = relative(SRC, file);
    const raw = readFileSync(file, 'utf8');
    const isScss = file.endsWith('.scss');
    let body = stripComments(raw, isScss);

    if (file.endsWith('.html')) {
      //  En una plantilla, el texto visible no es CSS: «Calle Principal #123»
      //  o «Factura #00128» no son colores. Solo se inspecciona donde puede
      //  haber estilos de verdad — bloques <style> y atributos style/fill/
      //  stroke/color.
      body = [
        ...body.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi),
        ...body.matchAll(/\b(?:style|fill|stroke|color|stop-color)\s*=\s*"([^"]*)"/gi),
        ...body.matchAll(/\b(?:style|fill|stroke|color|stop-color)\s*=\s*'([^']*)'/gi),
      ].map((m) => m[1]).join('\n');
    } else if (!isScss) {
      body = blankStrings(body);
    }

    const isAuthority = COLOR_AUTHORITIES.some((a) => rel.replace(/\\/g, '/').includes(a.replace('assets/styles/', 'assets/styles/')));

    for (const [, name] of body.matchAll(/(--[\w-]+)\s*:/g)) definedVars.add(name);
    for (const [, name] of body.matchAll(/var\(\s*(--[\w-]+)/g)) {
      //  `var(--control-height-#{$size})` es interpolación de Sass: el nombre
      //  se completa en compilación, así que aquí llega truncado. Se omite.
      if (!body.includes(`var(--${name.slice(2)}-#{`) && !name.endsWith('-')) {
        usedVars.add(name);
      }
    }

    if (isAuthority || isAllowed(rel)) continue;

    const hexes = [...body.matchAll(HEX)].map((m) => m[0]);
    const funcs = [...body.matchAll(FUNC_COLOR)].map((m) => m[0]);

    //  `rgba(var(--x-rgb), .1)` es la forma correcta de componer opacidad y no
    //  debe contarse: solo se marca rgba() con canales numéricos literales.
    if (hexes.length || funcs.length) {
      literalHits.push({ rel, hexes, funcs: funcs.length });
    }

    //  Un componente que redefine un token global lo secuestra para todo su
    //  subárbol. Es lo que hacía que las pantallas de acceso ignorasen el tema.
    //  BrandingService sobrescribe tokens de acento a propósito: es el punto
    //  de extensión documentado para la personalización por organización, y lo
    //  hace en `:root`, no secuestrando un subárbol.
    if (!rel.startsWith('assets/styles/') && !rel.endsWith('services/branding.ts')) {
      for (const [, name] of body.matchAll(/^\s*(--[\w-]+)\s*:/gm)) {
        if (GLOBAL_TOKENS.some((p) => name.startsWith(p))) {
          shadowHits.push({ rel, name });
        }
      }
    }
  }

  //  Los tokens que el sistema publica de verdad, leídos del CSS compilado.
  const css = execFileSync(
    'npx',
    ['--no-install', 'sass', `--load-path=apps/core/client-web/src`, '--no-source-map', ENTRY],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  );
  for (const [, name] of css.matchAll(/(--[\w-]+)\s*:/g)) definedVars.add(name);

  const undefinedVars = [...usedVars].filter((v) => !definedVars.has(v)).sort();

  /* ── Informe ───────────────────────────────────────────────────────────── */

  let failed = false;

  const literalCount = literalHits.reduce((n, h) => n + h.hexes.length + h.funcs, 0);
  console.log('Guardián de tokens\n');

  if (literalCount) {
    failed = true;
    console.error(`  Colores literales fuera del sistema de diseño: ${literalCount} en ${literalHits.length} archivos`);
    for (const h of literalHits.slice(0, VERBOSE ? 999 : 12)) {
      console.error(`    ${h.rel}: ${[...new Set(h.hexes)].slice(0, 6).join(' ')}${h.funcs ? ` (+${h.funcs} rgb/hsl)` : ''}`);
    }
    if (!VERBOSE && literalHits.length > 12) {
      console.error(`    … y ${literalHits.length - 12} archivos más (usa --verbose)`);
    }
    console.error('');
  } else {
    console.log('  Colores literales: ninguno fuera del sistema de diseño.');
  }

  if (undefinedVars.length) {
    failed = true;
    console.error(`  Tokens usados pero nunca definidos: ${undefinedVars.length}`);
    for (const v of undefinedVars.slice(0, VERBOSE ? 999 : 20)) console.error(`    ${v}`);
    console.error('');
  } else {
    console.log('  Tokens indefinidos: ninguno.');
  }

  if (shadowHits.length) {
    failed = true;
    console.error(`  Componentes que redefinen tokens globales: ${shadowHits.length}`);
    for (const h of shadowHits.slice(0, VERBOSE ? 999 : 15)) {
      console.error(`    ${h.rel}: ${h.name}`);
    }
    console.error('');
  } else {
    console.log('  Secuestro de tokens globales: ninguno.');
  }

  if (failed) {
    console.error('\nEl guardián de tokens ha fallado.');
    process.exit(1);
  }
  console.log('\nCorrecto.');
}

/* Prefijos reservados al sistema. Un componente puede declarar variables
   propias, pero no con estos nombres. */
const GLOBAL_TOKENS = [
  '--surface-', '--content-', '--border-', '--accent-', '--success-',
  '--warning-', '--error-', '--info-', '--shadow-', '--radius-',
  '--space-', '--text-', '--font-', '--duration-', '--ease-', '--z-',
  '--viz-', '--scrim', '--focus-ring',
];

main();
