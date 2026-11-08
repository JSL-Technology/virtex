#!/usr/bin/env node
/**
 * Every request body is a validated DTO class.
 *
 * The global ValidationPipe (`whitelist`, `forbidNonWhitelisted`) only acts on a parameter whose
 * declared type is a CLASS carrying class-validator metadata. A body typed as an object literal,
 * `Record<…>`, `Partial<Entity>`, `any` or a primitive passes through untouched — every field the
 * caller sends reaches the service. That is how `POST /push/subscribe` let one user overwrite another
 * user's row by sending its `id` (audit 2026-11-07, PLT-NOT-01) and how datasheets accepted a whole
 * entity from the client (PLTB-DS-02).
 *
 * This walks every controller with the TypeScript compiler (not a regex: decorators span lines) and
 * fails on any `@Body()` / `@Body('field')` parameter whose type is not a class reference.
 *
 * An exception needs a reason on the line before the parameter:
 *     // body-dto-allow: RFC 7591 client metadata is open by definition; validated in the service
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const APP = join(ROOT, 'apps', 'backend', 'api', 'src', 'app');

function controllers(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) controllers(full, out);
    else if (entry.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

const NOT_A_DTO = new Set(['Record', 'Partial', 'Pick', 'Omit', 'Required', 'Readonly', 'Array', 'Map', 'Set', 'Object', 'Promise']);

function decoratorName(decorator) {
  const expression = decorator.expression;
  if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)) return expression.expression.text;
  return null;
}

function describe(type) {
  if (!type) return 'no type';
  if (ts.isTypeReferenceNode(type)) {
    const name = type.typeName.getText();
    if (NOT_A_DTO.has(name)) return name;
    return null; // a named class / interface reference — see below for interfaces
  }
  return ts.SyntaxKind[type.kind];
}

const problems = [];
let checked = 0;

for (const file of controllers(APP)) {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lines = text.split('\n');
  const interfaces = new Set();
  source.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) interfaces.add(node.name.text);
  });

  const visit = (node) => {
    if (ts.isParameter(node)) {
      const body = ts.getDecorators(node)?.find((d) => decoratorName(d) === 'Body');
      if (body) {
        checked += 1;
        let problem = describe(node.type);
        // An interface or a type alias declared in the controller is not a class: no metadata.
        if (!problem && ts.isTypeReferenceNode(node.type) && interfaces.has(node.type.typeName.getText())) {
          problem = `${node.type.typeName.getText()} (interface/type, not a class)`;
        }
        if (problem) {
          const line = source.getLineAndCharacterOfPosition(node.getStart()).line;
          const previous = lines.slice(Math.max(0, line - 3), line + 1).join('\n');
          if (!/body-dto-allow:\s*\S/.test(previous)) {
            problems.push(`${relative(ROOT, file)}:${line + 1}  @Body ${node.name.getText()}: ${problem}`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (problems.length) {
  console.error('✗ body-dto: request bodies that bypass validation (type them with a class-validator DTO):\n');
  for (const problem of problems) console.error(`    ${problem}`);
  console.error('\n  A deliberate exception needs `// body-dto-allow: <reason>` on the line above the parameter.');
  process.exit(1);
}
console.log(`✓ body-dto: ${checked} request bodies, every one a validated DTO class (or a documented exception).`);
