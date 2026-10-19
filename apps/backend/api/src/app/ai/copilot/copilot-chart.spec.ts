import { drawChart, MAX_CHART_POINTS, parseChartRequest } from './copilot-chart';

/** A chart is drawn from a tool's own result: the mapping picks figures, it never supplies them. */
describe('copilot charts', () => {
  const mapping = { rows: 'months', label: 'month', series: [{ name: 'Ventas', field: 'total' }], unit: 'DOP' };

  it('picks the rows, labels and series out of a result', () => {
    const chart = drawChart({ months: [{ month: '2026-07', total: 10 }, { month: '2026-08', total: '12.5' }] }, mapping, 'line', new Date('2026-10-19T00:00:00Z'));
    expect(chart).toEqual({
      categories: ['2026-07', '2026-08'],
      series: [{ name: 'Ventas', values: [10, 12.5] }],
      unit: 'DOP',
      omitted: 0,
      drawnAt: '2026-10-19T00:00:00.000Z',
    });
  });

  it('reads nested paths, and turns an object of figures into rows', () => {
    const aging = { totals: { current: 500, d1_30: 200, d31_60: 50, currency: 'DOP' } };
    const chart = drawChart(aging, { rows: 'totals', label: 'key', series: [{ name: 'Saldo', field: 'value' }], unit: null }, 'pie');
    expect(chart.categories).toEqual(['current', 'd1_30', 'd31_60']);
    expect(chart.series[0].values).toEqual([500, 200, 50]);
  });

  it('keeps a chart to a readable number of points and says how many it left out', () => {
    const months = Array.from({ length: MAX_CHART_POINTS + 5 }, (_, i) => ({ month: `m${i}`, total: i }));
    const chart = drawChart({ months }, mapping, 'column');
    expect(chart.categories).toHaveLength(MAX_CHART_POINTS);
    expect(chart.omitted).toBe(5);
  });

  it('names what does not match, so the model can correct it', () => {
    expect(() => drawChart({ months: [] }, mapping, 'line')).toThrow('empty');
    expect(() => drawChart({ weeks: [] }, mapping, 'line')).toThrow('nothing to draw at "months"');
    expect(() => drawChart({ months: [{ month: 'x', total: 'n/a' }] }, mapping, 'line')).toThrow('field "total" has no numbers');
    expect(() => drawChart({ months: [{ month: 'x', total: -3 }] }, mapping, 'pie')).toThrow('negative');
  });

  it('checks the call itself', () => {
    const base = {
      title: 'Ventas',
      type: 'column',
      source_tool: 'sales_trend',
      source_input_json: '{"months":6}',
      rows: 'months',
      label: 'month',
      series: [{ name: 'Ventas', field: 'total' }],
      unit: null,
    };
    expect(parseChartRequest(base)).toMatchObject({ sourceTool: 'sales_trend', sourceInput: { months: 6 }, mapping: { unit: null } });
    expect(() => parseChartRequest({ ...base, type: 'radar' })).toThrow('type');
    expect(() => parseChartRequest({ ...base, source_tool: 'show_chart' })).toThrow('read tools');
    expect(() => parseChartRequest({ ...base, source_input_json: '[1]' })).toThrow('JSON object');
    expect(() => parseChartRequest({ ...base, source_input_json: '{' })).toThrow('not valid JSON');
    expect(() => parseChartRequest({ ...base, type: 'pie', series: [{ name: 'a', field: 'a' }, { name: 'b', field: 'b' }] })).toThrow('exactly one');
    expect(() => parseChartRequest({ ...base, series: [] })).toThrow('1 to 6');
  });
});
