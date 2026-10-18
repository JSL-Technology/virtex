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

let numberFormat: Intl.NumberFormat | null = null;
let numberLocale = '';

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(formatValue).join(', ')}]`;
  if (typeof value === 'string') return `“${value}”`;
  if (typeof value === 'number') return (numberFormat ?? new Intl.NumberFormat()).format(value);
  return String(value);
}

/**
 * The locale numbers in summaries are written in — the tenant's, set once by the designer — rather
 * than the browser's: an English Windows showed «10,000» on a Dominican tenant's canvas while the
 * rest of the screen said «10 000».
 */
export function setSummaryLocale(locale: string): void {
  if (locale === numberLocale) return;
  numberLocale = locale;
  try {
    numberFormat = new Intl.NumberFormat(locale);
  } catch {
    numberFormat = null;
  }
}
