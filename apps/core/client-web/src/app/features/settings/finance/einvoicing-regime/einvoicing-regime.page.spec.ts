import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TranslateModule } from '@ngx-translate/core';
import { EinvoicingRegimePage } from './einvoicing-regime.page';
import {
  FiscalRange,
  FiscalRegimeSettings,
  MarketCoverage,
} from '../../../../core/api/fiscal-settings.service';
import { environment } from '../../../../../environments/environment';

/**
 * The screen that makes six markets issuable.
 *
 * The regimes are implemented and the documents are built and signed, but a Chilean tenant cannot
 * issue without a CAF and an Ecuadorean one without an emission point. Until this page existed the
 * only way to supply either was an `INSERT`, so the product refused to issue — correctly — with
 * nowhere for the tenant to go.
 *
 * What the tests below pin is the part that would fail quietly: which fields a market is asked
 * for, and that the CAF never comes back out of the API.
 */
describe('EinvoicingRegimePage', () => {
  let fixture: ComponentFixture<EinvoicingRegimePage>;
  let component: EinvoicingRegimePage;
  let httpMock: HttpTestingController;

  const localization = `${environment.apiUrl}/localization`;
  const regime = `${environment.apiUrl}/einvoicing/regime`;

  const coverageFor = (countryCode: string): MarketCoverage => ({
    countryCode,
    capabilities: [{ capability: 'electronicInvoicing', level: 'needs-credentials' }],
  });

  const range = (overrides: Partial<FiscalRange> = {}): FiscalRange => ({
    id: 'range-1',
    documentType: '33',
    series: '',
    startsAt: 1,
    endsAt: 100,
    currentSequence: 0,
    remaining: 100,
    isActive: true,
    validUntil: '2027-12-31',
    authorizationCode: 'CAF-2026-33',
    hasSecret: true,
    secretKind: 'CAF_XML',
    ...overrides,
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EinvoicingRegimePage, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(EinvoicingRegimePage);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  const flush = (
    countryCode: string,
    settings: FiscalRegimeSettings | null = null,
    ranges: FiscalRange[] = [],
  ) => {
    httpMock.expectOne((r) => r.url === `${localization}/fiscal-coverage`).flush(coverageFor(countryCode));
    httpMock.expectOne((r) => r.url === `${regime}/settings` && r.method === 'GET').flush(settings);
    httpMock.expectOne((r) => r.url === `${regime}/ranges` && r.method === 'GET').flush(ranges);
    fixture.detectChanges();
  };

  it('asks an Ecuadorean tenant for their emission point and nothing Brazilian', () => {
    flush('EC');

    // The server refuses on exactly what it is missing. This is the same list, from the side that
    // asks for it — and asking an Ecuadorean tenant for an IBGE municipality code would produce a
    // form nobody can complete and a support conversation about a field that does not apply.
    expect(component.fields()).toEqual(['establishment', 'emissionPoint', 'numericCode']);
    expect(component.needs('municipalityCode')).toBe(false);
  });

  it('asks a Brazilian tenant for their IBGE codes', () => {
    flush('BR');
    expect(component.needs('stateCode')).toBe(true);
    expect(component.needs('municipalityCode')).toBe(true);
    expect(component.needs('emissionPoint')).toBe(false);
  });

  it('says plainly that a market with no regime has nothing to configure', () => {
    flush('PA');

    expect(component.hasRegime()).toBe(false);
    // An empty form would invite the tenant to fill it in and wait for something to happen.
    expect(fixture.nativeElement.textContent).toContain('NO_REGIME');
  });

  it('sends only the fields the market uses', () => {
    flush('CL');

    component.settingsForm.patchValue({
      environment: 'PRODUCTION',
      activityCode: '620200',
      originComuna: 'Providencia',
      originCity: 'Santiago',
      // Left over from a market this tenant is not in. Sending it would store a blank where the
      // server expects two digits or nothing at all.
      stateCode: '',
      municipalityCode: '',
    });
    component.saveSettings();

    const saved = httpMock.expectOne((r) => r.url === `${regime}/settings` && r.method === 'PUT');
    expect(saved.request.body).toEqual({
      environment: 'PRODUCTION',
      activityCode: '620200',
      originComuna: 'Providencia',
      originCity: 'Santiago',
    });
    saved.flush({ environment: 'PRODUCTION' });
  });

  it('derives the secret kind from the market, so nobody has to know it is called CAF_XML', () => {
    flush('CL');

    component.rangeForm.patchValue({
      documentType: '33',
      startsAt: 1,
      endsAt: 100,
      secret: '<AUTORIZACION><CAF/></AUTORIZACION>',
    });
    component.registerRange();

    const created = httpMock.expectOne((r) => r.url === `${regime}/ranges` && r.method === 'POST');
    expect(created.request.body.secretKind).toBe('CAF_XML');
    created.flush(range());

    httpMock.expectOne((r) => r.url === `${regime}/ranges` && r.method === 'GET').flush([range()]);
  });

  it('refuses a range whose upper bound is below its lower one', () => {
    flush('CL');

    component.rangeForm.patchValue({ documentType: '33', startsAt: 100, endsAt: 1 });
    component.registerRange();

    httpMock.expectNone((r) => r.method === 'POST');
  });

  it('shows only whether the range carries authority material, never the material', () => {
    flush('CL', null, [range()]);

    const text = fixture.nativeElement.textContent as string;
    // A CAF read back through an API lets whoever reads it stamp documents in the taxpayer's name.
    expect(text).toContain('HAS_SECRET');
    expect(text).not.toContain('AUTORIZACION');
    expect(component.ranges()[0].hasSecret).toBe(true);
  });

  it('warns before a range runs out, because a new one takes days to obtain', () => {
    flush('CL', null, [range({ remaining: 12 })]);
    expect(component.runningOut(component.ranges()[0])).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('RUNNING_OUT');
  });

  it('flags an expired authorisation however many numbers remain', () => {
    flush('CL', null, [range({ validUntil: '2020-01-31', remaining: 900 })]);

    // Numbers left is not the same as usable: the SII refuses a folio drawn from an expired CAF.
    expect(component.expired(component.ranges()[0])).toBe(true);
    expect(component.runningOut(component.ranges()[0])).toBe(false);
  });

  it('keeps a retired range in the list, because past documents were issued under it', () => {
    flush('CL', null, [range({ isActive: false })]);
    expect(component.ranges()).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('RETIRED');
  });

  it('renders stored nulls as empty fields rather than the string "null"', () => {
    flush('CL', {
      environment: 'CERTIFICATION',
      activityCode: '620200',
      originComuna: null,
      originCity: null,
    } as FiscalRegimeSettings);

    expect(component.settingsForm.controls.originComuna.value).toBe('');
  });
});
