#!/usr/bin/env node
/**
 * Remove results CodeQL marked as suppressed in source before the SARIF is uploaded.
 *
 * A false positive is suppressed where it occurs, with the rule and the reason on the line above:
 *
 *   // codeql[js/insufficient-password-hash] HIBP's range API is keyed by SHA-1; storage uses Argon2id.
 *
 * CodeQL's `AlertSuppression.ql` (added to the analysis in codeql.yml) records those comments as
 * `suppressions` on the matching results, but code scanning does not act on that property: the
 * alert would stay open. So the suppressed results are dropped here, and each one is listed in the
 * job summary so a suppression is never silent.
 *
 * With --fail-on-unused, a suppression comment that matches no result is an error: either the code
 * it excused was fixed and the comment is stale, or the rule id is wrong and it excuses nothing.
 * Only meaningful on a full analysis: on pull requests CodeQL reports results on changed lines
 * only, so a comment above an unchanged line legitimately matches nothing there.
 *
 *   node tools/ci/drop-suppressed-sarif-results.mjs <sarif file or directory> [--fail-on-unused]
 */
import { appendFileSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const failOnUnused = args.includes('--fail-on-unused');
const [target] = args.filter((a) => !a.startsWith('--'));
if (!target) {
  console.error('usage: drop-suppressed-sarif-results.mjs <sarif file or directory> [--fail-on-unused]');
  process.exit(2);
}

const sarifFiles = statSync(target).isDirectory()
  ? readdirSync(target)
      .filter((f) => f.endsWith('.sarif') || f.endsWith('.sarif.json'))
      .map((f) => join(target, f))
  : [target];

const isSuppressed = (result) =>
  (result.suppressions ?? []).some((s) => s.kind === 'inSource' && s.status !== 'rejected');

const dropped = [];
let analysedJavaScript = false;

for (const file of sarifFiles) {
  const sarif = JSON.parse(readFileSync(file, 'utf8'));
  for (const run of sarif.runs ?? []) {
    // The CLI lists rules on the driver; the Action lists them on the query-pack extensions.
    const rules = [run.tool?.driver, ...(run.tool?.extensions ?? [])].flatMap((c) => c?.rules ?? []);
    if (rules.some((r) => r.id?.startsWith('js/'))) analysedJavaScript = true;
    const kept = [];
    const before = dropped.length;
    for (const result of run.results ?? []) {
      if (!isSuppressed(result)) {
        kept.push(result);
        continue;
      }
      const loc = result.locations?.[0]?.physicalLocation;
      dropped.push({
        rule: result.ruleId,
        where: `${loc?.artifactLocation?.uri}:${loc?.region?.startLine}`,
        line: loc?.region?.startLine,
        uri: loc?.artifactLocation?.uri,
      });
    }
    run.results = kept;
    console.log(`${relative(process.cwd(), file)}: ${kept.length} result(s) kept, ${dropped.length - before} suppressed`);
  }
  writeFileSync(file, JSON.stringify(sarif));
}

const summary = [
  '### CodeQL results suppressed in source',
  '',
  dropped.length
    ? dropped.map((d) => `- \`${d.rule}\` at \`${d.where}\``).join('\n')
    : '_None._',
  '',
];
console.log(summary.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n'));

// Every `// codeql[...]` line in the JavaScript/TypeScript sources must have excused a result.
if (failOnUnused && !analysedJavaScript) {
  console.error('✗ --fail-on-unused given, but no JavaScript analysis found in the SARIF.');
  process.exit(1);
}
if (failOnUnused) {
  let grep = '';
  try {
    grep = execFileSync(
      'git',
      ['grep', '-n', '-E', '^[[:space:]]*//[[:space:]]*codeql[[:space:]]*\\[', '--', '*.ts', '*.tsx', '*.js', '*.mjs', '*.cjs'],
      { encoding: 'utf8' },
    );
  } catch (error) {
    if (error.status !== 1) throw error; // 1: no matches
  }
  const used = new Set(dropped.map((d) => `${d.uri}:${d.line - 1}`));
  const stale = grep
    .split('\n')
    .filter(Boolean)
    .map((l) => /^([^:]+):(\d+):/.exec(l))
    .filter((m) => m && !used.has(`${m[1]}:${m[2]}`))
    .map((m) => `${m[1]}:${m[2]}`);
  if (stale.length) {
    console.error(
      `\n✗ ${stale.length} codeql[...] suppression comment(s) excuse no result — remove them or fix the rule id:\n` +
        stale.map((s) => `  - ${s}`).join('\n'),
    );
    process.exit(1);
  }
}
