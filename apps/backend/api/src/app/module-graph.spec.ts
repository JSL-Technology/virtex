import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * Every module that has a controller must be reachable from `AppModule`.
 *
 * ## The class of bug this closes
 *
 * A NestJS module that nothing imports is never instantiated, so its controllers register no
 * routes. Nothing fails: the code compiles, the tests pass, the module's own unit tests pass, and
 * the application starts. The routes simply are not there, and the only way to find out is to call
 * one.
 *
 * It has happened three times in this repository. `SalesModule` and `ReportsModule` went missing —
 * quote-to-invoice conversion and the ageing reports did not exist in the deployed product — and
 * were fixed with a comment in `AppModule` asking the next person to remember. The comment did not
 * work: `TreasuryModule` was in the same state at the same time, and because a bank account could
 * be created through no other route, it took supplier payments, customer collections, the cash
 * position and bank-statement import down with it. `IntercompanyModule` was the fourth.
 *
 * A comment is not a control. This is.
 *
 * ## How it works
 *
 * The whole module graph is read from source: `AppModule`'s `imports`, then each imported module's
 * imports, transitively. That is a static approximation — it does not resolve dynamic modules or
 * `forwardRef` targets by evaluation — but every module in this codebase is imported by its class
 * name, and the failure mode being guarded against is a class name that appears nowhere.
 *
 * Booting the container would be stricter, but it needs a database, Redis and a full environment,
 * which puts it out of reach of the fast suite. This runs in milliseconds on any machine, which is
 * what makes it a gate rather than a nightly.
 */
describe('the module graph', () => {
  const APP_ROOT = __dirname;

  const filesUnder = (dir: string, suffix: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return filesUnder(full, suffix);
      return full.endsWith(suffix) ? [full] : [];
    });

  const moduleFiles = filesUnder(APP_ROOT, '.module.ts');
  const controllerFiles = filesUnder(APP_ROOT, '.controller.ts');

  /** `export class XModule` → `XModule`, for each module file. */
  const declaredModules = new Map<string, string>();
  for (const file of moduleFiles) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/export\s+class\s+(\w+Module)\b/g)) {
      declaredModules.set(match[1], file);
    }
  }

  /**
   * The module class names one file references in its own `imports`.
   *
   * Read from the `@Module({...})` decorator body rather than the whole file, so a module that
   * merely imports a type from another module's file is not counted as depending on it.
   */
  const importsOf = (file: string): string[] => {
    const source = readFileSync(file, 'utf8');
    const decorator = source.indexOf('@Module(');
    if (decorator === -1) return [];
    const importsAt = source.indexOf('imports:', decorator);
    if (importsAt === -1) return [];

    // Walk from the opening bracket to its match, so nested objects and arrays are included.
    const open = source.indexOf('[', importsAt);
    let depth = 0;
    let end = open;
    for (let i = open; i < source.length; i++) {
      if (source[i] === '[') depth += 1;
      else if (source[i] === ']') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const body = source.slice(open, end);
    return [...body.matchAll(/\b(\w+Module)\b/g)].map((match) => match[1]);
  };

  const reachable = (): Set<string> => {
    const root = join(APP_ROOT, 'app.module.ts');
    const seen = new Set<string>(['AppModule']);
    const queue = [root];

    while (queue.length > 0) {
      const file = queue.shift() as string;
      for (const name of importsOf(file)) {
        if (seen.has(name)) continue;
        seen.add(name);
        const declaredIn = declaredModules.get(name);
        if (declaredIn) queue.push(declaredIn);
      }
    }
    return seen;
  };

  it('finds modules and controllers to check (guards against a silently empty sweep)', () => {
    expect(moduleFiles.length).toBeGreaterThan(20);
    expect(controllerFiles.length).toBeGreaterThan(20);
    expect(declaredModules.size).toBeGreaterThan(20);
  });

  it('reaches AppModule’s own imports', () => {
    const graph = reachable();
    // A few that have always been wired, so a bug in the traversal fails here rather than passing
    // everything.
    expect(graph).toContain('AuthModule');
    expect(graph).toContain('JournalEntriesModule');
    expect(graph).toContain('AccountingModule');
  });

  it('registers every module that declares a controller', () => {
    const graph = reachable();

    const unreachable = [...declaredModules.entries()]
      .filter(([name]) => !graph.has(name))
      .filter(([, file]) => {
        // Only modules that actually expose HTTP routes matter here: a provider-only module that
        // nothing imports is dead code worth removing, but it is not a missing endpoint.
        const source = readFileSync(file, 'utf8');
        return /controllers\s*:\s*\[\s*\w/.test(source);
      })
      .map(([name, file]) => `${name} (${basename(file)})`);

    expect(unreachable).toEqual([]);
  });

  it('places every controller file inside a module that declares it', () => {
    const declaredControllers = new Set<string>();
    for (const file of moduleFiles) {
      const source = readFileSync(file, 'utf8');
      const at = source.indexOf('controllers:');
      if (at === -1) continue;
      const open = source.indexOf('[', at);
      const close = source.indexOf(']', open);
      for (const match of source.slice(open, close).matchAll(/\b(\w*Controller)\b/g)) {
        declaredControllers.add(match[1]);
      }
    }

    const orphaned: string[] = [];
    for (const file of controllerFiles) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/export\s+class\s+(\w*Controller)\b/g)) {
        if (!declaredControllers.has(match[1])) orphaned.push(match[1]);
      }
    }

    expect(orphaned).toEqual([]);
  });
});
