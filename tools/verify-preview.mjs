// Diagnóstico VISUAL del área de trabajo y de «vista previa al abrir».
//
//   VX_EMAIL=... VX_PASS=... node tools/verify-preview.mjs
//   (o deja que lo pregunte; la contraseña se teclea oculta)
// Opcionales: VX_BASE, HEADED=1

import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import readline from 'node:readline';

const BASE = process.env.VX_BASE || 'http://localhost:4200';

function ask(q, hidden = false) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  if (hidden) {
    const orig = rl._writeToOutput?.bind(rl);
    rl._writeToOutput = (s) => (s.includes('\n') ? orig?.(s) : orig?.('*'));
  }
  return new Promise((res) => rl.question(q, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); res(a.trim()); }));
}

const EMAIL = process.env.VX_EMAIL || (await ask('Email: '));
const PASS = process.env.VX_PASS || (await ask('Contraseña (oculta): ', true));
const SHOTS = 'tools/_shots';
mkdirSync(SHOTS, { recursive: true });

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: process.env.HEADED ? false : 'new',
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => log(' [pageerror]', e.message));

const snapshot = () => page.evaluate(() => {
  const tabs = [...document.querySelectorAll('.dv-tab')].map((t) => ({
    title: t.querySelector('.tab-title')?.textContent?.trim() ?? '?',
    preview: !!t.querySelector('.tab-header')?.classList.contains('is-preview'),
    active: t.classList.contains('dv-active-tab'),
  }));
  const railRaw = [...document.querySelectorAll('.rail__item')].map((b) => b.textContent.trim().replace(/\s+/g, ' '));
  const sidebar = [...document.querySelectorAll('.sidebar .menu-item, app-sidebar .menu-item')].map((a) => ({
    text: a.textContent.trim().replace(/\s+/g, ' '),
  }));
  const content = document.querySelector('app-tab-wrapper .tab-scroll, .tab-scroll')?.innerText?.slice(0, 220) ?? '';
  const toast = [...document.querySelectorAll('[class*="toast"], [class*="notification"], .p-toast-message')].map((t) => t.textContent.trim()).filter(Boolean).slice(0, 3);
  return { url: location.pathname + location.search, tabs, rail: railRaw, sidebar, content, toast };
});

async function shot(name) { await page.screenshot({ path: `${SHOTS}/${name}.png` }); }

function printSnap(label, s) {
  log(`\n──────── ${label}  (URL ${s.url})`);
  log(`  Pestañas (${s.tabs.length}): ` + s.tabs.map((t) => `${t.active ? '▶' : ''}${t.preview ? '〔prev〕' : ''}"${t.title}"`).join('  |  '));
  if (s.rail?.length) log(`  Rail: ${s.rail.join(' · ')}`);
  if (s.sidebar?.length) log(`  Sidebar: ${s.sidebar.map((x) => x.text).join(' · ')}`);
  if (s.toast?.length) log(`  Toast/aviso: ${s.toast.join(' | ')}`);
  if (s.content) log(`  Contenido: ${JSON.stringify(s.content.slice(0, 160))}`);
}

/** Clic DENTRO de la página por texto (rail/sidebar/enlaces). Robusto ante re-render. */
async function clickByText(selector, needle) {
  return page.evaluate((sel, nd) => {
    const els = [...document.querySelectorAll(sel)];
    const el = els.find((e) => e.textContent.toLowerCase().includes(nd.toLowerCase()));
    if (!el) return null;
    el.scrollIntoView();
    el.click();
    return el.textContent.trim().replace(/\s+/g, ' ');
  }, selector, needle);
}

/** Clic en el enésimo enlace de registro (.table-link) dentro de la página. */
async function clickRecord(n) {
  return page.evaluate((idx) => {
    const links = [...document.querySelectorAll('.table-link')];
    if (!links[idx]) return false;
    links[idx].scrollIntoView();
    links[idx].click();
    return true;
  }, n);
}
const countRecords = () => page.evaluate(() => document.querySelectorAll('.table-link').length);

try {
  log('→ Abriendo', BASE);
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });

  const email = await page.$('input[type="email"]');
  if (email) {
    log('→ Login…');
    await email.type(EMAIL, { delay: 12 });
    await (await page.$('input[type="password"]')).type(PASS, { delay: 12 });
    await Promise.all([page.keyboard.press('Enter'), page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})]);
    await sleep(3000);
  }
  await page.waitForSelector('.dv-tabs-container, app-tab-container', { timeout: 30000 });
  await sleep(1500);

  printSnap('INICIO (recién logueado)', await snapshot());
  await shot('00-inicio');

  // Prueba dirigida: abrir un registro de Facturas y luego uno de Clientes. Con vista previa, ambos
  // comparten UNA sola pestaña efímera (la segunda reemplaza a la primera).
  const previewTabs = (s) => s.tabs.filter((t) => t.preview);

  async function openFirstRecordOf(module, entry) {
    await clickByText('.rail__item', module); await sleep(1500);
    await clickByText('.sidebar .menu-item, app-sidebar .menu-item', entry); await sleep(2200);
    const n = await countRecords();
    if (n < 1) { log(`   ⚠ «${entry}»: 0 registros clicables.`); return null; }
    await clickRecord(0); await sleep(2600);
    return snapshot();
  }

  log('\n★ PRUEBA DE VISTA PREVIA (abrir 2 registros distintos → deben compartir una pestaña efímera)');

  const s1 = await openFirstRecordOf('Ventas', 'Facturas');
  if (s1) {
    printSnap('Tras abrir la FACTURA', s1);
    await shot('02-factura');
    log(`   → pestañas en vista previa ahora: ${previewTabs(s1).map((t) => `"${t.title}"`).join(', ') || 'NINGUNA'}`);
  }

  const s2 = await openFirstRecordOf('Ventas', 'Clientes');
  if (s2) {
    printSnap('Tras abrir el CLIENTE', s2);
    await shot('03-cliente');
    const pv = previewTabs(s2);
    log(`   → pestañas en vista previa ahora: ${pv.map((t) => `"${t.title}"`).join(', ') || 'NINGUNA'}`);

    log('\n=================  VEREDICTO  =================');
    if (pv.length === 1) {
      log(`✓ VISTA PREVIA OK: una sola pestaña efímera, ahora muestra "${pv[0].title}" (reemplazó a la factura).`);
    } else if (pv.length === 0) {
      log('✗ NO hay ninguna pestaña en vista previa (cursiva). Los registros abren permanentes.');
    } else {
      log(`✗ Hay ${pv.length} pestañas en vista previa (deberían fundirse en una): ${pv.map((t) => t.title).join(', ')}`);
    }
    log('==============================================');
  }

  log(`\nCapturas en ${SHOTS}/ (00-inicio, 02-factura, 03-cliente)`);
} catch (e) {
  log('\n✗ ERROR:', e.message);
  await shot('error');
} finally {
  await browser.close();
}
