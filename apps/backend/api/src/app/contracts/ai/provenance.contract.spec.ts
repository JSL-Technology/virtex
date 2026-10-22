import { compareFields } from './provenance.contract';

describe('compareFields', () => {
  it('tells the fields kept as read from those a person corrected, ignoring what the AI left empty', () => {
    const suggested = { ncf: 'B0100000001', total: 1180, date: '2026-10-01', dueDate: null, vendorId: 'v-1', currencyCode: 'dop' };
    const saved = { ncf: 'b01-0000-0001', total: '1180.00', date: new Date('2026-10-01T00:00:00Z'), dueDate: '2026-10-31', vendorId: 'v-2', currencyCode: 'DOP' };
    expect(compareFields(suggested, saved)).toEqual({ accepted: ['currencyCode', 'date', 'ncf', 'total'], edited: ['vendorId'] });
  });

  it('counts a suggested value that was cleared as edited', () => {
    expect(compareFields({ ncf: 'B0100000001' }, { ncf: null })).toEqual({ accepted: [], edited: ['ncf'] });
  });
});
