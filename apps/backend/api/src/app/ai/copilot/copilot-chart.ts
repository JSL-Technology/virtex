import { CopilotSchema, s } from '../../contracts/copilot/copilot-tools.contract';
import { AiChartData, AiChartMapping, AiChartType } from '../entities/ai-chart.entity';

export const CHART_TOOL_NAME = 'show_chart';

/** A chart shows a comparison, not a ledger: past this many points it says how many were left out. */
export const MAX_CHART_POINTS = 60;
const MAX_SERIES = 6;
const CHART_TYPES: readonly AiChartType[] = ['line', 'area', 'column', 'bar', 'pie'];

/**
 * The copilot's chart tool, offered beside the domain tools.
 *
 * The model does not send figures. It names a read tool it may already use, the input to call it
 * with, and which fields of the result to draw; the server calls that tool itself, as the person,
 * and takes the series from its result. So a chart cannot show a number the business data did not
 * produce, and a chart pinned to the dashboard can be drawn again tomorrow from tomorrow's data.
 */
export const CHART_TOOL = {
  name: CHART_TOOL_NAME,
  description:
    'Show the person a chart drawn from one of your read tools. Use it when a trend or a comparison reads better as ' +
    'a picture (sales by month, balances by ageing bucket, a cash projection, top products). Call the source tool ' +
    'first so you know the shape of its result, then pass: the source tool name; its input as a JSON string (the same ' +
    'input you would call it with, "{}" for none); "rows", the dotted path in its result to the list of rows (empty ' +
    'string when the result is itself the list); "label", the field of each row that names it; and the numeric fields ' +
    'to draw as series. When the path points to an object of numbers instead of a list (e.g. ageing totals), use ' +
    'label "key" and one series with field "value". The server reads the figures from the tool itself — never type ' +
    'numbers here — and the person can pin the chart to their dashboard, where it stays up to date. Do not repeat ' +
    'every figure the chart shows in your answer.',
  inputSchema: s.object({
    title: s.string('Short title, in the person’s language.'),
    type: s.enum(CHART_TYPES, 'line/area for a trend over time, column/bar to compare, pie for parts of a whole.'),
    source_tool: s.string('A read tool you have, e.g. sales_trend.'),
    source_input_json: s.string('The input for that tool, as a JSON object string.'),
    rows: s.string('Dotted path to the rows in the tool result, e.g. "months" or "weekly"; "" for the result itself.'),
    label: s.string('Field of each row used as its label, e.g. "month".'),
    series: s.array(s.object({ name: s.string('Legend name.'), field: s.string('Numeric field of each row.') }), '1 to 6 series.'),
    unit: s.nullable(s.string('Currency code or unit of the values, if the result states one.')),
  }) as CopilotSchema,
};

export interface ChartRequest {
  title: string;
  type: AiChartType;
  sourceTool: string;
  sourceInput: Record<string, unknown>;
  mapping: AiChartMapping;
}

/** The model's call, checked. Throws a message the model can act on. */
export function parseChartRequest(input: Record<string, unknown>): ChartRequest {
  const title = String(input['title'] ?? '').trim().slice(0, 120);
  if (!title) throw new Error('title is required');
  const type = String(input['type'] ?? '') as AiChartType;
  if (!CHART_TYPES.includes(type)) throw new Error(`type must be one of ${CHART_TYPES.join(', ')}`);
  const sourceTool = String(input['source_tool'] ?? '').trim();
  if (!sourceTool || sourceTool === CHART_TOOL_NAME) throw new Error('source_tool must name one of your read tools');

  let sourceInput: unknown;
  try {
    sourceInput = JSON.parse(String(input['source_input_json'] ?? '{}') || '{}');
  } catch {
    throw new Error('source_input_json is not valid JSON');
  }
  if (!sourceInput || typeof sourceInput !== 'object' || Array.isArray(sourceInput)) {
    throw new Error('source_input_json must be a JSON object');
  }

  const series = Array.isArray(input['series']) ? (input['series'] as Array<Record<string, unknown>>) : [];
  const mapped = series
    .map((entry) => ({ name: String(entry?.['name'] ?? '').trim().slice(0, 60), field: String(entry?.['field'] ?? '').trim() }))
    .filter((entry) => entry.field);
  if (mapped.length === 0 || mapped.length > MAX_SERIES) throw new Error(`series must have 1 to ${MAX_SERIES} entries`);
  if (type === 'pie' && mapped.length !== 1) throw new Error('a pie chart has exactly one series');

  const label = String(input['label'] ?? '').trim();
  if (!label) throw new Error('label is required');
  const unit = input['unit'] === null || input['unit'] === undefined ? null : String(input['unit']).trim().slice(0, 12) || null;

  return {
    title,
    type,
    sourceTool,
    sourceInput: sourceInput as Record<string, unknown>,
    mapping: { rows: String(input['rows'] ?? '').trim(), label, series: mapped.map((m) => ({ name: m.name || m.field, field: m.field })), unit },
  };
}

/**
 * The series a mapping picks out of a tool's result. Pure: the same result always draws the same
 * chart. Throws a message naming what did not match, so the model can correct the mapping.
 */
export function drawChart(result: unknown, mapping: AiChartMapping, type: AiChartType, now = new Date()): AiChartData {
  const target = mapping.rows ? valueAt(result, mapping.rows) : result;
  let rows: Array<Record<string, unknown>>;
  if (Array.isArray(target)) {
    rows = target.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row));
  } else if (target && typeof target === 'object') {
    // An object of figures (ageing totals, components of a balance): one row per numeric entry.
    rows = Object.entries(target as Record<string, unknown>)
      .filter(([, value]) => toNumber(value) !== null)
      .map(([key, value]) => ({ key, value }));
  } else {
    throw new Error(`nothing to draw at "${mapping.rows || '(result)'}" — it is not a list or an object of numbers`);
  }
  if (rows.length === 0) throw new Error(`the rows at "${mapping.rows || '(result)'}" are empty`);

  const drawn = rows.slice(0, MAX_CHART_POINTS);
  const categories = drawn.map((row) => {
    const value = valueAt(row, mapping.label);
    return value === null || value === undefined || value === '' ? '—' : String(value).slice(0, 60);
  });
  const series = mapping.series.map((entry) => {
    const values = drawn.map((row) => toNumber(valueAt(row, entry.field)));
    if (values.every((value) => value === null)) {
      throw new Error(`field "${entry.field}" has no numbers in these rows`);
    }
    return { name: entry.name, values };
  });
  if (type === 'pie' && series[0].values.some((value) => value !== null && value < 0)) {
    throw new Error('a pie chart cannot show negative values; use a column chart');
  }
  return {
    categories,
    series,
    unit: mapping.unit,
    omitted: rows.length - drawn.length,
    drawnAt: now.toISOString(),
  };
}

/** `a.b.0.c` into a JSON value; undefined when any step is missing. */
function valueAt(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const step of path.split('.').filter(Boolean)) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = Array.isArray(current) && /^\d+$/.test(step) ? current[Number(step)] : (current as Record<string, unknown>)[step];
  }
  return current;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  return null;
}
