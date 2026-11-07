#!/usr/bin/env node
/**
 * Every scheduled method runs on one replica at a time: each `@Cron(...)` / `@Interval(...)` must be
 * followed by `@ExclusiveJob(...)` (see shared/scheduling/exclusive-job.ts), or carry a
 * `cron-exclusive-allow: <why>` comment on the line above the scheduling decorator.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'apps/backend/api/src/app';
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith('.ts') && !path.endsWith('.spec.ts')) files.push(path);
  }
})(ROOT);

const problems = [];
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (!/^\s*@(Cron|Interval|Timeout)\(/.test(line)) return;
    const above = lines[index - 1] ?? '';
    if (/cron-exclusive-allow:/.test(above)) return;
    // The decorators stacked on the same method, below this one.
    let next = index + 1;
    let found = false;
    while (next < lines.length && /^\s*@/.test(lines[next])) {
      if (/^\s*@ExclusiveJob\(/.test(lines[next])) found = true;
      next++;
    }
    if (!found) problems.push(`${file}:${index + 1}  ${line.trim()}`);
  });
}

if (problems.length) {
  console.error('✗ Scheduled methods that would run on every replica at once:\n');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('\n  Add @ExclusiveJob() directly under the scheduling decorator, or a `cron-exclusive-allow: <why>` line above it.');
  process.exit(1);
}
console.log('✓ cron-exclusive: every scheduled job runs on one replica at a time.');
