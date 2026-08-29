#!/usr/bin/env node
/**
 * =============================================================================
 *  VERIFICADOR DE CONTRASTE — VIRTEX DESIGN SYSTEM
 * =============================================================================
 *  Compila la hoja de estilos raíz, extrae los tokens semánticos realmente
 *  emitidos y comprueba cada pareja texto/superficie contra WCAG 2.1.
 *
 *  Verifica el ARTEFACTO, no la intención: lee el CSS compilado, de modo que
 *  un alias mal escrito o un token sobrescrito por accidente se detecta igual
 *  que un color mal elegido.
 *
 *  Uso:  node tools/verify-contrast.mjs [--verbose]
 *  Sale con código 1 si alguna pareja incumple, para poder encadenarlo en CI.
 * =============================================================================
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = 'apps/core/client-web/src/styles.scss';
const LOAD_PATH = 'apps/core/client-web/src';

const VERBOSE = process.argv.includes('--verbose');

/* ── Color ────────────────────────────────────────────────────────────────── */

function parseColor(value) {
  const v = String(value).trim();

  const hex = v.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }

  const rgb = v.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      return parts.slice(0, 3);
    }
  }
  return null;
}

const channel = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

const luminance = ([r, g, b]) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/* ── Extracción de tokens ─────────────────────────────────────────────────── */

function compile() {
  return execFileSync(
    'npx',
    ['--no-install', 'sass', `--load-path=${LOAD_PATH}`, '--no-source-map', ENTRY],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  );
}

/**
 * Recoge las declaraciones de custom properties de los bloques cuyo selector
 * coincide con `selectorPattern`, en orden de aparición, de forma que una
 * redeclaración posterior gane — igual que hace la cascada.
 */
function collectTokens(css, selectorPattern) {
  const tokens = {};
  const blocks = css.matchAll(/([^{}]+)\{([^{}]*)\}/g);

  for (const [, selector, body] of blocks) {
    if (!selectorPattern.test(selector.trim())) continue;
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      tokens[name] = value.trim();
    }
  }
  return tokens;
}

/** Resuelve `var(--x)` de forma recursiva hasta llegar a un color literal. */
function resolve_(tokens, name, seen = new Set()) {
  if (seen.has(name)) return null;
  seen.add(name);

  const raw = tokens[name];
  if (!raw) return null;

  const ref = raw.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (ref) return resolve_(tokens, ref[1], seen);

  return parseColor(raw);
}

/* ── Matriz de requisitos ─────────────────────────────────────────────────── */

const SURFACES = [
  '--surface-canvas',
  '--surface-base',
  '--surface-raised',
  '--surface-overlay',
  '--surface-sunken',
  '--surface-hover',
  '--surface-active',
];

// [token de contenido, ratio mínimo, nivel]
const CONTENT = [
  ['--content-primary', 7, 'AAA'],
  ['--content-secondary', 4.5, 'AA'],
  ['--content-tertiary', 4.5, 'AA'],
  ['--accent-text', 4.5, 'AA'],
  ['--content-link', 4.5, 'AA'],
  ['--success-text', 4.5, 'AA'],
  ['--warning-text', 4.5, 'AA'],
  ['--error-text', 4.5, 'AA'],
  ['--info-text', 4.5, 'AA'],
  ['--border-strong', 3, 'AA no textual'],
];

// Texto sobre relleno sólido: [token de texto, token de relleno]
const ON_SOLID = [
  ['--accent-on-solid', '--accent-solid'],
  ['--success-on-solid', '--success-solid'],
  ['--warning-on-solid', '--warning-solid'],
  ['--error-on-solid', '--error-solid'],
  ['--info-on-solid', '--info-solid'],
];

/* ── Ejecución ────────────────────────────────────────────────────────────── */

function auditTheme(label, tokens) {
  const failures = [];
  let checks = 0;

  const get = (name) => resolve_(tokens, name);

  for (const surfaceName of SURFACES) {
    const surface = get(surfaceName);
    if (!surface) {
      failures.push(`${label}: superficie «${surfaceName}» no resuelve a un color`);
      continue;
    }

    for (const [contentName, min, level] of CONTENT) {
      const content = get(contentName);
      if (!content) {
        failures.push(`${label}: token «${contentName}» no resuelve a un color`);
        continue;
      }

      const ratio = contrast(content, surface);
      checks++;

      if (ratio < min) {
        failures.push(
          `${label}: ${contentName} sobre ${surfaceName} = ${ratio.toFixed(2)}:1 ` +
            `(exigido ${min}:1, ${level})`
        );
      } else if (VERBOSE) {
        console.log(
          `    ok  ${contentName} / ${surfaceName}`.padEnd(62) +
            `${ratio.toFixed(2)}:1`
        );
      }
    }
  }

  for (const [textName, fillName] of ON_SOLID) {
    const text = get(textName);
    const fill = get(fillName);
    if (!text || !fill) {
      failures.push(`${label}: «${textName}» o «${fillName}» no resuelve a un color`);
      continue;
    }

    const ratio = contrast(text, fill);
    checks++;

    if (ratio < 4.5) {
      failures.push(
        `${label}: ${textName} sobre ${fillName} = ${ratio.toFixed(2)}:1 (exigido 4.5:1, AA)`
      );
    } else if (VERBOSE) {
      console.log(
        `    ok  ${textName} / ${fillName}`.padEnd(62) + `${ratio.toFixed(2)}:1`
      );
    }
  }

  return { failures, checks };
}

function main() {
  console.log('Verificando contraste de los tokens del sistema de diseño…\n');

  const css = compile();

  //  El tema claro vive en `:root`; el oscuro lo redefine en
  //  `:root[data-theme='dark']`, así que se parte del claro y se superpone.
  const light = collectTokens(css, /^:root$/);
  const dark = { ...light, ...collectTokens(css, /^:root\[data-theme=["']?dark["']?\]$/) };

  if (Object.keys(light).length === 0) {
    console.error('No se encontró ningún token en «:root». ¿Cambió la estructura de la hoja?');
    process.exit(1);
  }

  let total = 0;
  const allFailures = [];

  for (const [label, tokens] of [['CLARO', light], ['OSCURO', dark]]) {
    console.log(`  ${label}`);
    const { failures, checks } = auditTheme(label, tokens);
    total += checks;
    allFailures.push(...failures);
    console.log(
      `    ${checks} comprobaciones, ${failures.length} incumplimientos\n`
    );
  }

  if (allFailures.length > 0) {
    console.error('INCUMPLIMIENTOS DE CONTRASTE:\n');
    for (const f of allFailures) console.error(`  · ${f}`);
    console.error(
      `\n${allFailures.length} de ${total} comprobaciones incumplen WCAG 2.1.`
    );
    process.exit(1);
  }

  console.log(`Correcto: las ${total} comprobaciones cumplen WCAG 2.1.`);
}

main();
