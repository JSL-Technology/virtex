import { isLocalizedName, localizedNameIn } from './localized-name.contract';
import { NARRATIVE_MAX_DEPTH, isNarrativeRef, renderNarrative, type NarrativeRef, type NarrativeRenderer } from './narrative.contract';

/**
 * How a narrative the system wrote is read in another language — the one rule the server and the
 * client share, so a stored narrative reads the same wherever it is rendered.
 */
describe('narrative contract', () => {
  /** A catalogue of four messages, in English, and names read in English. */
  const english: Record<string, string> = {
    'ledger.reconciliation.category_line': 'Category: {{account}}',
    'ledger.reversal.line': 'Reversal: {{line}}',
    'ledger.adjustment.period_end': 'Period-end adjustment ({{type}}): {{description}}',
    'ledger.adjustment_type.accrual': 'accrual',
  };
  const renderer: NarrativeRenderer = {
    message: (key, values) =>
      key in english ? english[key].replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => (name in values ? String(values[name]) : match)) : null,
    name: (name) => localizedNameIn(name, 'en', 'es'),
  };

  describe('isLocalizedName', () => {
    it('is a name when every key is a language and every value a text', () => {
      expect(isLocalizedName({ es: 'Bancos' })).toBe(true);
      expect(isLocalizedName({ es: 'Bancos', en: 'Banks', pt: 'Bancos' })).toBe(true);
    });

    it('is not a name otherwise: empty, a key that is no language, a value that is no text, a list, nothing', () => {
      expect(isLocalizedName({})).toBe(false);
      expect(isLocalizedName({ es: 'Bancos', code: '1102' })).toBe(false);
      expect(isLocalizedName({ es: 1 })).toBe(false);
      expect(isLocalizedName(['es'])).toBe(false);
      expect(isLocalizedName(null)).toBe(false);
      expect(isLocalizedName('Bancos')).toBe(false);
      expect(isLocalizedName({ key: 'ledger.x.y', params: {} })).toBe(false);
    });
  });

  describe('isNarrativeRef', () => {
    it('is exactly a catalogue key and its values', () => {
      expect(isNarrativeRef({ key: 'ledger.reversal.line', params: {} })).toBe(true);
      expect(isNarrativeRef({ key: 'ledger.reversal.line', params: { line: 'x' }, extra: 1 })).toBe(false);
      expect(isNarrativeRef({ key: 'not a key', params: {} })).toBe(false);
      expect(isNarrativeRef({ key: 'ledger.reversal.line' })).toBe(false);
      expect(isNarrativeRef({ key: 'ledger.reversal.line', params: [] })).toBe(false);
      expect(isNarrativeRef({ es: 'Bancos' })).toBe(false);
    });
  });

  describe('renderNarrative', () => {
    it('renders a name kept in several languages in the reader’s', () => {
      const ref: NarrativeRef = { key: 'ledger.reconciliation.category_line', params: { account: { es: 'Gastos bancarios', en: 'Bank charges' } } };
      expect(renderNarrative(ref, renderer)).toBe('Category: Bank charges');
    });

    it('renders a narrative nested in another, and a catalogue key among the values', () => {
      const ref: NarrativeRef = {
        key: 'ledger.reversal.line',
        params: {
          line: { key: 'ledger.adjustment.period_end', params: { type: 'ledger.adjustment_type.accrual', description: 'Intereses' } },
        },
      };
      expect(renderNarrative(ref, renderer)).toBe('Reversal: Period-end adjustment (accrual): Intereses');
    });

    it('keeps what a person typed exactly as typed — a value shaped like no key is text', () => {
      const ref: NarrativeRef = { key: 'ledger.reversal.line', params: { line: 'Pago de luz' } };
      expect(renderNarrative(ref, renderer)).toBe('Reversal: Pago de luz');
    });

    it('keeps a value shaped like a key the catalogue does not hold as it is', () => {
      const ref: NarrativeRef = { key: 'ledger.reversal.line', params: { line: 'see.section.four' } };
      expect(renderNarrative(ref, renderer)).toBe('Reversal: see.section.four');
    });

    it('cannot render a message the catalogue lacks — the caller shows the record, whole', () => {
      expect(renderNarrative({ key: 'ledger.not.here', params: {} }, renderer)).toBeNull();
      // Nor a narrative that nests one it lacks: half in one language is worse than the record.
      expect(renderNarrative({ key: 'ledger.reversal.line', params: { line: { key: 'ledger.not.here', params: {} } } }, renderer)).toBeNull();
    });

    it('stops at a depth no narrative the product writes reaches', () => {
      let ref: NarrativeRef = { key: 'ledger.reversal.line', params: { line: 'x' } };
      for (let level = 0; level <= NARRATIVE_MAX_DEPTH + 1; level++) ref = { key: 'ledger.reversal.line', params: { line: ref } };
      expect(renderNarrative(ref, renderer)).toBeNull();
    });
  });
});
