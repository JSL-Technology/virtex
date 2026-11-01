// Verificación en vivo del catálogo de bancos de República Dominicana (lista oficial SB/BCRD).
// Importa desde la interfaz, comprueba lo cargado en la base, la idempotencia y el bloqueo de BIC
// retirados, y al final borra lo que la sesión creó (bancos sin cuentas).
const { execSync } = require('child_process');
const { launch, instrument, uiLogin, shot, go, panel, toasts } = require('./lib.cjs');

const sql = (q) => execSync(`psql -U postgres -h localhost -d erp -At -F '|' -c ${JSON.stringify(q)}`).toString().trim();
const out = (id, data) => console.log(JSON.stringify({ id, ...data }));
const ORG = "(select id from organizations where slug='virtex-dev')";

(async () => {
  const { browser, context } = await launch();
  const page = await context.newPage();
  const log = instrument(page);
  await uiLogin(page);
  const p = panel(page);
  const api = (method, url, body) =>
    page.evaluate(
      async ({ method, url, body }) => {
        const csrf = document.cookie.split('; ').find((c) => /xsrf-token=/i.test(c))?.split('=')[1];
        const res = await fetch('http://localhost:3000/api/v1' + url, {
          method,
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-XSRF-TOKEN': decodeURIComponent(csrf) } : {}) },
          body: body ? JSON.stringify(body) : method === 'GET' ? undefined : '{}',
        });
        let json = null;
        try { json = await res.json(); } catch { /* sin cuerpo */ }
        return { status: res.status, json };
      },
      { method, url, body },
    );

  if (process.env.QA_CLEANUP_ONLY) {
    await cleanup();
    await browser.close();
    return;
  }

  const before = Number(sql(`select count(*) from banks where organization_id=${ORG}`));
  out('estado-inicial', { bancos: before, referencia: (await api('GET', '/treasury/banks/reference')).json });

  // Catálogo vacío: la llamada a la acción del estado vacío.
  await go(page, 'masters/banks');
  await page.waitForTimeout(2000);
  const cta = p.locator('[data-testid=banks-import-reference-empty]');
  out('cta-vacio', {
    visible: await cta.isVisible().catch(() => false),
    texto: (await cta.innerText().catch(() => '')).trim(),
    ayuda: (await p.locator('.empty-copy').innerText().catch(() => '')).replace(/\s+/g, ' '),
    evidencia: await shot(page, 'r3-bancos-rd-vacio'),
  });

  await cta.click();
  await page.waitForTimeout(2500);
  const rows = await p.locator('tbody tr').count();
  out('importacion-ui', {
    aviso: await toasts(page),
    filas: rows,
    peticiones: log.requests.filter((r) => /banks\/reference/.test(r.url)).map((r) => `${r.method} ${r.url.replace(/^.*\/api\/v1/, '')} ${r.status}`),
    botonTrasImportar: await p.locator('[data-testid=banks-import-reference]').count(),
    evidencia: await shot(page, 'r3-bancos-rd-lista'),
  });

  out('datos-en-base', {
    total: Number(sql(`select count(*) from banks where organization_id=${ORG}`)),
    conSwift: Number(sql(`select count(*) from banks where organization_id=${ORG} and swift_bic is not null`)),
    conRnc: Number(sql(`select count(*) from banks where organization_id=${ORG} and tax_id is not null`)),
    porTipo: sql(`select kind, count(*) from banks where organization_id=${ORG} group by kind order by kind`).split('\n'),
    muestra: sql(
      `select name, coalesce(swift_bic,'—'), coalesce(local_code,'—'), coalesce(tax_id,'—'), kind from banks where organization_id=${ORG} and name in ('Banco Popular','Banco BHD','Asociación Duarte','Banco Adopem','JMMB Bank') order by name`,
    ).split('\n'),
  });

  // Idempotencia: una segunda importación no agrega ni modifica nada.
  const updatedAt = sql(`select max(updated_at) from banks where organization_id=${ORG}`);
  const again = await api('POST', '/treasury/banks/reference-import');
  out('idempotencia', {
    status: again.status,
    respuesta: again.json,
    total: Number(sql(`select count(*) from banks where organization_id=${ORG}`)),
    sinCambios: sql(`select max(updated_at) from banks where organization_id=${ORG}`) === updatedAt,
  });

  // BIC retirados: rechazados al crear y al editar.
  const bellbank = await api('POST', '/treasury/banks', { name: 'QA3 Bellbank', swiftBic: 'BELNDOSD' });
  const bancamerica = await api('POST', '/treasury/banks', { name: 'QA3 Bancamérica', swiftBic: 'AHCSDOSDXXX' });
  out('bic-retirados', {
    bellbank: { status: bellbank.status, key: bellbank.json?.messageKey, mensaje: bellbank.json?.message },
    bancamerica: { status: bancamerica.status, key: bancamerica.json?.messageKey, mensaje: bancamerica.json?.message },
  });

  // El formulario muestra razón social, RNC y tipo.
  const popularId = sql(`select id from banks where organization_id=${ORG} and name='Banco Popular'`);
  await go(page, `masters/banks/${popularId}/edit`);
  await page.waitForTimeout(2000);
  out('formulario', {
    razonSocial: await p.locator('#bankLegalName').inputValue().catch(() => null),
    rnc: await p.locator('#bankTaxId').inputValue().catch(() => null),
    tipo: await p.locator('#bankKind option:checked').innerText().catch(() => null),
    swift: await p.locator('#bankSwift').inputValue().catch(() => null),
    evidencia: await shot(page, 'r3-bancos-rd-formulario'),
  });

  await cleanup();
  await browser.close();

  // Limpieza: solo los bancos que esta sesión creó (ninguno tiene cuentas).
  async function cleanup() {
  const created = sql(`select id from banks where organization_id=${ORG} and created_at >= now() - interval '1 hour'`).split('\n').filter(Boolean);
  const statuses = [];
  // The API throttles bursts (429): each delete waits out the limit and retries.
  for (const id of created) {
    let status = 429;
    for (let attempt = 0; attempt < 8 && status === 429; attempt++) {
      if (attempt) await page.waitForTimeout(2000 * attempt);
      status = (await api('DELETE', `/treasury/banks/${id}`)).status;
    }
    statuses.push(status);
  }
  out('limpieza', {
    borrados: statuses.filter((s) => s === 204).length,
    fallidos: statuses.filter((s) => s !== 204).length,
    restantes: Number(sql(`select count(*) from banks where organization_id=${ORG}`)),
    erroresPagina: log.pageErrors.slice(0, 3),
  });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
