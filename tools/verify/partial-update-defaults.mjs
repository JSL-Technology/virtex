#!/usr/bin/env node
/**
 * A PATCH carries what it changes — and nothing the create DTO would default.
 *
 * `PartialType` (from `@nestjs/mapped-types` and `@nestjs/swagger` alike) copies the parent class's
 * PROPERTY INITIALIZERS into every instance of the partial class. A create DTO that declared
 * `isPostable?: boolean = false` therefore made every `PATCH /chart-of-accounts/:id` that left the
 * field out a request to turn the account into a summary account — refused once it had lines,
 * silently done before — and `isActive = true` / `isContraAccount = false` reactivated a deactivated
 * account and took the contra mark off accumulated depreciation on a rename (found by
 * `verify:inflation-adjustment`, 2026-11-22).
 *
 * A default belongs where the record is created — the service or the column — never on a DTO that a
 * partial type is built from. This fails the build when one is.
 *
 *     node tools/verify/partial-update-defaults.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const ROOT = resolve(process.cwd(), 'apps/backend/api/src');

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') && !full.endsWith('.spec.ts')) out.push(full);
  }
  return out;
};

/** Class name → its instance properties that carry an initializer, with the file they are in. */
const initialized = new Map();
/** Every class declared as `PartialType(Parent)`. */
const partials = [];

for (const file of walk(ROOT)) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (ts.isClassDeclaration(node) && node.name) {
      const props = node.members.filter(
        (member) =>
          ts.isPropertyDeclaration(member) &&
          member.initializer &&
          !(ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static),
      );
      if (props.length > 0) {
        initialized.set(node.name.text, {
          file,
          props: props.map((prop) => `${prop.name.getText(source)} = ${prop.initializer.getText(source)}`),
        });
      }
      for (const clause of node.heritageClauses ?? []) {
        for (const type of clause.types) {
          const expression = type.expression;
          if (ts.isCallExpression(expression) && expression.expression.getText(source) === 'PartialType') {
            const parent = expression.arguments[0];
            // `PartialType(OmitType(X, …))` and the like: the class at the bottom is what is copied.
            let base = parent;
            while (base && ts.isCallExpression(base)) base = base.arguments[0];
            if (base) partials.push({ file, child: node.name.text, parent: base.getText(source) });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const offenders = partials
  .map((partial) => ({ ...partial, parentInfo: initialized.get(partial.parent) }))
  .filter((partial) => partial.parentInfo);

if (offenders.length > 0) {
  console.error('✗ A partial DTO inherits property initializers: a PATCH that omits the field would reset it.\n');
  for (const offender of offenders) {
    console.error(
      `  ${relative(process.cwd(), offender.file)}: ${offender.child} = PartialType(${offender.parent})\n` +
        `    ${relative(process.cwd(), offender.parentInfo.file)}: ${offender.parentInfo.props.join(', ')}`,
    );
  }
  console.error('\n  Move the default to where the record is created (the service or the column), not the DTO.');
  process.exit(1);
}

console.log(`✓ ${partials.length} partial DTOs; none inherits a default from the DTO it is built from.`);
