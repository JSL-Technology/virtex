import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { FiscalRangesCardComponent } from './fiscal-ranges-card.component';
import { FiscalDocumentTypeView, FiscalRange } from '../../data/fiscal-settings.service';
import { environment } from '../../../../../environments/environment';

/**
 * The authorised ranges, in any market.
 *
 * The Dominican page and the regime page of every other market used to keep two copies of this,
 * against two APIs with two sets of rules. One card now, against one API; what differs between
 * markets is the catalogue it is handed and the material the market's ranges carry. What the tests
 * pin is what would fail quietly: the server's reading of a range is shown rather than a second
 * one computed here, the secret never comes back, and a range is retired or reactivated — never
 * deleted.
 */
describe('FiscalRangesCardComponent', () => {
  let fixture: ComponentFixture<FiscalRangesCardComponent>;
  let component: FiscalRangesCardComponent;
  let httpMock: HttpTestingController;

  const ranges = `${environment.apiUrl}/einvoicing/regime/ranges`;

  const type = (overrides: Partial<FiscalDocumentTypeView>): FiscalDocumentTypeView => ({
    code: 'E31',
    labelKey: 'fiscal.do.e31',
    name: 'Factura de Crédito Fiscal Electrónica',
    sequenceFormat: null,
    expirationRequired: true,
    isElectronic: true,
    side: 'sales',
    isCreditNote: false,
    requiresBuyerTaxId: true,
    ...overrides,
  });

  const range = (overrides: Partial<FiscalRange> = {}): FiscalRange => ({
    id: 'range-1',
    documentType: 'E31',
    series: '',
    startsAt: 1,
    endsAt: 100,
    currentSequence: 0,
    remaining: 100,
    isActive: true,
    validUntil: '2027-12-31',
    authorizationCode: 'AUT-2026',
    hasSecret: false,
    secretKind: null,
    runningLow: false,
    expired: false,
    ...overrides,
  });

  const types = [
    type({ code: 'B01', labelKey: 'fiscal.do.b01', isElectronic: false }),
    type({ code: 'E31' }),
    type({ code: '33', labelKey: 'fiscal.cl.33', expirationRequired: false }),
  ];

  const create = (rows: FiscalRange[] = [], inputs: Record<string, unknown> = {}) => {
    fixture = TestBed.createComponent(FiscalRangesCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('documentTypes', types);
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url === ranges && r.method === 'GET').flush(rows);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FiscalRangesCardComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('derives the secret kind from the market, so nobody has to know it is called AUTHORISED_FOLIOS', () => {
    create([], { secretKind: 'AUTHORISED_FOLIOS' });

    component.form.patchValue({ documentType: '33', startsAt: 1, endsAt: 100, secret: '<AUTORIZACION><CAF/></AUTORIZACION>' });
    component.register();

    const created = httpMock.expectOne((r) => r.url === ranges && r.method === 'POST');
    expect(created.request.body.secretKind).toBe('AUTHORISED_FOLIOS');
    created.flush(range({ documentType: '33' }));
    httpMock.expectOne((r) => r.url === ranges && r.method === 'GET').flush([range({ documentType: '33' })]);
  });

  it('sends no secret kind where the market issues no material with its ranges', () => {
    const changed = jest.fn();
    create();
    component.changed.subscribe(changed);

    component.form.patchValue({ documentType: 'E31', startsAt: 1, endsAt: 100, validUntil: '2027-12-31' });
    component.register();

    const created = httpMock.expectOne((r) => r.url === ranges && r.method === 'POST');
    expect(created.request.body).toEqual({ documentType: 'E31', startsAt: 1, endsAt: 100, validUntil: '2027-12-31' });
    created.flush(range());
    httpMock.expectOne((r) => r.url === ranges && r.method === 'GET').flush([range()]);
    // A new range can make a type issuable: whoever shows what the company can issue reads it again.
    expect(changed).toHaveBeenCalled();
  });

  it('refuses a range whose upper bound is below its lower one', () => {
    create();
    component.form.patchValue({ documentType: '33', startsAt: 100, endsAt: 1 });
    component.register();
    httpMock.expectNone((r) => r.method === 'POST');
  });

  it('asks for the expiry of a type whose ranges expire, before the server refuses', () => {
    create();

    component.form.patchValue({ documentType: 'E31', startsAt: 1, endsAt: 100, validUntil: '' });
    expect(component.expiryRequired()).toBe(true);
    component.register();
    httpMock.expectNone((r) => r.method === 'POST');

    component.form.patchValue({ documentType: '33' });
    expect(component.expiryRequired()).toBe(false);
    expect(component.form.valid).toBe(true);
  });

  it('offers only the kind of document the company issues, where the market has both', () => {
    create([], { emissionModeApplies: true, emissionMode: 'TRADITIONAL' });
    expect(component.rangeDocumentTypes().map((t) => t.code)).toEqual(['B01']);

    fixture.componentRef.setInput('emissionMode', 'ELECTRONIC');
    expect(component.rangeDocumentTypes().map((t) => t.code)).toEqual(['E31', '33']);

    // A market with one kind is not narrowed by a mode it does not have.
    fixture.componentRef.setInput('emissionModeApplies', false);
    expect(component.rangeDocumentTypes()).toHaveLength(3);
  });

  it('shows only whether the range carries authority material, never the material', () => {
    create([range({ hasSecret: true, secretKind: 'AUTHORISED_FOLIOS' })]);
    const text = fixture.nativeElement.textContent as string;
    // A CAF read back through an API lets whoever reads it stamp documents in the taxpayer's name.
    expect(text).toContain('settings.pages.einvoicing.has_secret');
    expect(text).not.toContain('AUTORIZACION');
  });

  it("says what the server says about a range: running low, expired, exhausted, retired", () => {
    create([
      range({ id: 'low', remaining: 12, runningLow: true }),
      range({ id: 'lapsed', remaining: 900, expired: true }),
      range({ id: 'spent', remaining: 0, currentSequence: 100, runningLow: true }),
      range({ id: 'retired', isActive: false }),
      range({ id: 'fine' }),
    ]);

    const status = (id: string) => {
      const row = component.ranges().find((candidate) => candidate.id === id);
      if (!row) throw new Error(`no range ${id}`);
      return component.statusKey(row).key;
    };
    expect(status('low')).toBe('settings.fiscal.range_status_running_low');
    // Numbers left is not the same as usable: the authority refuses a number from a lapsed range.
    expect(status('lapsed')).toBe('settings.fiscal.range_status_expired');
    expect(status('spent')).toBe('settings.fiscal.range_status_exhausted');
    expect(status('retired')).toBe('settings.fiscal.range_status_retired');
    expect(status('fine')).toBe('settings.fiscal.range_status_active');
  });

  it('retires a range and puts a superseded one back in force, keeping both on file', () => {
    create([range({ id: 'current' }), range({ id: 'previous', isActive: false })]);

    component.setActive(component.ranges()[0], false);
    const retired = httpMock.expectOne((r) => r.url === `${ranges}/current` && r.method === 'PATCH');
    expect(retired.request.body).toEqual({ isActive: false });
    retired.flush(range({ id: 'current', isActive: false }));
    httpMock.expectOne((r) => r.url === ranges && r.method === 'GET').flush([]);

    component.setActive(range({ id: 'previous', isActive: false }), true);
    const reactivated = httpMock.expectOne((r) => r.url === `${ranges}/previous` && r.method === 'PATCH');
    expect(reactivated.request.body).toEqual({ isActive: true });
    reactivated.flush(range({ id: 'previous' }));
    httpMock.expectOne((r) => r.url === ranges && r.method === 'GET').flush([]);
    httpMock.expectNone((r) => r.method === 'DELETE');
  });

  it('offers no reactivation for a range that has nothing left or has lapsed', () => {
    create([range({ id: 'spent', isActive: false, remaining: 0 }), range({ id: 'lapsed', isActive: false, expired: true })]);
    expect(fixture.nativeElement.textContent).not.toContain('settings.fiscal.reactivate_range');
  });

  it('is read, not changed, without the permission to edit the fiscal set-up', () => {
    create([range()], { readonly: true });
    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('settings.pages.einvoicing.add_range');
    expect(text).not.toContain('settings.pages.einvoicing.retire');
  });
});
