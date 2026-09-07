import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * A background job says whose data it is touching.
 *
 * Under the row-level policies a job with no tenant context sees nothing. That is safe — it cannot
 * read another company's ledger — but it is not harmless: a recurring-entry poster that sees nothing
 * posts nothing, reports success, and stops working silently. A queue that quietly does nothing is
 * the worst of the three outcomes, worse than one that fails loudly.
 *
 * So every processor has to establish its tenant, and the tenant has to arrive in the job payload
 * rather than being looked up — looking it up means reading a row, and that read is the one with no
 * context yet.
 *
 * `mail.processor.ts` is exempt and says so: it sends an already-composed message and touches no
 * tenant table.
 */
const APP_DIR = join(__dirname, '..', '..');

const EXEMPT: Record<string, string> = {
  'mail/mail.processor.ts':
    'Envía un mensaje ya compuesto; no lee ninguna tabla con empresa.',
};

function processorFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...processorFiles(full));
    else if (entry.endsWith('.processor.ts') && !entry.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

describe('tenencia en los trabajos en cola', () => {
  const files = processorFiles(APP_DIR);

  it('encuentra los procesadores (evita una comprobación vacía)', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it('cada procesador establece contexto de empresa, o está exento con motivo', () => {
    const missing = files
      .map((f) => f.slice(APP_DIR.length + 1))
      .filter((rel) => !EXEMPT[rel])
      .filter((rel) => !readFileSync(join(APP_DIR, rel), 'utf8').includes('runAsTenantJob'));

    expect(missing).toEqual([]);
  });

  it('el payload del trabajo lleva organizationId', () => {
    const withoutTenant = files
      .map((f) => f.slice(APP_DIR.length + 1))
      .filter((rel) => !EXEMPT[rel])
      .filter((rel) => {
        const src = readFileSync(join(APP_DIR, rel), 'utf8');
        return !/job\.data\.organizationId/.test(src);
      });

    expect(withoutTenant).toEqual([]);
  });
});
