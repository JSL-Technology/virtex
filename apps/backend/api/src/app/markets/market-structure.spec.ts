import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MARKET_CAPABILITIES, type MarketDefinition } from './contracts';
import { allMarkets } from './registry';

/**
 * Every market follows the same structure (docs/ARQUITECTURA_MERCADOS.md §2.1).
 *
 * The point of the architecture is that how a country is configured is predictable: open
 * `markets/<cc>/` and the same eleven files answer the same questions, for Mexico as for the
 * Dominican Republic or Guatemala. This suite is what keeps it predictable — a package with a missing
 * or an extra file, a package the catalogue does not list, or a package reaching into another
 * market's, fails here rather than in a review.
 */
const ROOT = __dirname;
/** The folders of `markets/` that are not a market: they serve every market alike. */
const SHARED_FOLDERS = ['contracts', 'kit', 'queries'];
const CANONICAL_FILES = ['index.ts', ...MARKET_CAPABILITIES.map((capability) => `${capability}.ts`)].sort();

const packageFolders = readdirSync(ROOT)
  .filter((entry) => statSync(join(ROOT, entry)).isDirectory())
  .filter((entry) => !SHARED_FOLDERS.includes(entry))
  .sort();

const sourceFilesOf = (folder: string): string[] =>
  readdirSync(folder).flatMap((entry) => {
    const full = join(folder, entry);
    if (statSync(full).isDirectory()) return sourceFilesOf(full);
    return entry.endsWith('.ts') && !entry.endsWith('.spec.ts') ? [full] : [];
  });

/** The relative imports of a file, comments excluded. */
const importsOf = (file: string): string[] => {
  const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  return [...source.matchAll(/(?:from\s+|import\(\s*)['"](\.[^'"]+)['"]/g)].map((match) => match[1]);
};

describe('market packages: one structure for every market', () => {
  it('lists every package in the catalogue, and nothing else', () => {
    expect(allMarkets().map((market) => market.code.toLowerCase()).sort()).toEqual(packageFolders);
  });

  it('declares each market once', () => {
    const codes = allMarkets().map((market) => market.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  describe.each(packageFolders)('%s', (folder) => {
    const market = allMarkets().find((m) => m.code.toLowerCase() === folder) as MarketDefinition;

    it('has exactly the canonical files, and capability subfolders only', () => {
      const entries = readdirSync(join(ROOT, folder));
      const files = entries.filter((entry) => !statSync(join(ROOT, folder, entry)).isDirectory() && !entry.endsWith('.spec.ts'));
      expect(files.sort()).toEqual(CANONICAL_FILES);
      // A capability's own implementation lives in a subfolder named after it (`einvoicing/`).
      const folders = entries.filter((entry) => statSync(join(ROOT, folder, entry)).isDirectory());
      for (const sub of folders) expect(MARKET_CAPABILITIES as readonly string[]).toContain(sub);
    });

    it('is declared under its own ISO code', () => {
      expect(market.code).toBe(folder.toUpperCase());
      expect(market.code).toMatch(/^[A-Z]{2}$/);
    });

    it('composes its definition from its capability files', () => {
      for (const capability of MARKET_CAPABILITIES) {
        const file = require(join(ROOT, folder, capability)) as Record<string, unknown>;
        expect(file[capability]).toBe(market[capability]);
      }
    });

    it('reaches no other market: what two markets share lives in kit/', () => {
      for (const file of sourceFilesOf(join(ROOT, folder))) {
        for (const spec of importsOf(file)) {
          const target = join(file, '..', spec);
          const relativeToRoot = target.slice(ROOT.length + 1);
          const [first] = relativeToRoot.split('/');
          const allowed = first === folder || SHARED_FOLDERS.includes(first);
          if (!allowed) throw new Error(`${file.slice(ROOT.length + 1)} imports ${spec}: a market reaches another only through kit/`);
        }
      }
    });
  });

  it.each(SHARED_FOLDERS)('%s/ names no market package', (shared) => {
    for (const file of sourceFilesOf(join(ROOT, shared))) {
      for (const spec of importsOf(file)) {
        const relativeToRoot = join(file, '..', spec).slice(ROOT.length + 1);
        const [first] = relativeToRoot.split('/');
        if (packageFolders.includes(first)) {
          throw new Error(`${file.slice(ROOT.length + 1)} imports the ${first.toUpperCase()} package: shared code serves every market alike`);
        }
      }
    }
  });
});
