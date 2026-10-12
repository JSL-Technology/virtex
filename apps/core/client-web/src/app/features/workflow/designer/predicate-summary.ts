import { TranslateService } from '@ngx-translate/core';
import { composeKey } from '@virteex/shared/types';
import { PredicateOp, UNARY_OPS, WorkflowPredicate } from '../data/workflow.service';

const SYMBOLS: Partial<Record<PredicateOp, string>> = { eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤' };

/**
 * A condition in one readable line — «Importe > 10 000 y Proveedor contiene “ACME”» — for the
 * connection's label on the canvas and the branch list in the panel. Long conditions are cut with an
 * ellipsis; the panel shows the full editor.
 */
export function summarizePredicate(
  translate: TranslateService,
  predicate: WorkflowPredicate | undefined,
  labelOf: (variable: string) => string = (v) => v,
  max = 80,
): string {
  if (!predicate) return '';
  const text = render(translate, predicate, labelOf, true);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function render(translate: TranslateService, p: WorkflowPredicate, labelOf: (v: string) => string, top: boolean): string {
  if ('all' in p || 'any' in p) {
    const items = 'all' in p ? p.all : p.any;
    const joiner = ` ${translate.instant('all' in p ? 'workflow_engine.condition.and' : 'workflow_engine.condition.or')} `;
    const body = items.map((item) => render(translate, item, labelOf, false)).join(joiner);
    return top || items.length < 2 ? body : `(${body})`;
  }
  if ('not' in p) return `${translate.instant('workflow_engine.condition.not')} ${render(translate, p.not, labelOf, false)}`;
  const label = labelOf(p.var);
  if (UNARY_OPS.has(p.op)) return `${label} ${translate.instant(composeKey('workflow_engine.op', p.op)).toLowerCase()}`;
  const op = SYMBOLS[p.op] ?? translate.instant(composeKey('workflow_engine.op', p.op)).toLowerCase();
  return `${label} ${op} ${formatValue(p.value)}`;
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(formatValue).join(', ')}]`;
  if (typeof value === 'string') return `“${value}”`;
  if (typeof value === 'number') return value.toLocaleString();
  return String(value);
}
