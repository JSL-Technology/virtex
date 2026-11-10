import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { EinvoicingRegimePage } from './einvoicing-regime.page';
import {
  FiscalRange,
  FiscalRegimeSettings,
  MarketCoverage,
} from '../../../../core/api/fiscal-settings.service';
import { FiscalRangesCardComponent } from '../../fiscal/shared';
import { By } from '@angular/platform-browser';
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
 * for, and which kind of material its ranges carry. The ranges themselves are the shared card's
 * (`fiscal-ranges-card.component.spec.ts`), the same in every market.
 */
describe('EinvoicingRegimePage', () => {
  let fixture: ComponentFixture<EinvoicingRegimePage>;
  let component: EinvoicingRegimePage;
  let httpMock: HttpTestingController;

  const localization = `${environment.apiUrl}/localization`;
  const regime = `${environment.apiUrl}/einvoicing/regime`;
  let transmission: Record<string, unknown> = {
    countryCode: 'CL', transmissionEndpoint: null, statusEndpoint: null, soapAction: null,
    credentialScheme: null, hasCredential: false, credentialUpdatedAt: null, configured: false,
  };

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
    runningLow: false,
    expired: false,
    ...overrides,
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EinvoicingRegimePage],
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
    httpMock.expectOne((r) => r.url === `${regime}/transmission` && r.method === 'GET').flush(transmission);
    httpMock.expectOne((r) => r.url === `${localization}/fiscal-document-types`).flush(documentTypes);
    // A market with one kind of document and no certificate on this screen's tests: the shared
    // cards (emission mode, certificate) have nothing further to ask for.
    httpMock.expectOne((r) => r.url === `${environment.apiUrl}/invoices/context`).flush({
      ready: true,
      missing: [],
      countryCode,
      baseCurrency: 'USD',
      taxRates: [],
      taxRequiresConfiguration: false,
      fiscalDocumentTypes: [],
      emissionModeApplies: false,
      certificateRequired: false,
      serviceChargeRate: 0,
      defaultPaymentTermDays: 0,
      today: '2026-10-11',
    });
    fixture.detectChanges();
    // A market with a regime shows the ranges card, which reads the ranges itself.
    if (component.hasRegime()) {
      httpMock.expectOne((r) => r.url === `${regime}/ranges` && r.method === 'GET').flush(ranges);
      fixture.detectChanges();
    }
  };

  const card = (): FiscalRangesCardComponent =>
    fixture.debugElement.query(By.directive(FiscalRangesCardComponent)).componentInstance as FiscalRangesCardComponent;

  const documentTypes = [
    { code: '33', labelKey: 'fiscal.cl.33', name: 'Factura Electrónica', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false },
    { code: '61', labelKey: 'fiscal.cl.61', name: 'Nota de Crédito Electrónica', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', isCreditNote: true, requiresBuyerTaxId: false },
  ];

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
    expect(fixture.nativeElement.textContent).toContain('settings.pages.einvoicing.no_regime');
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

  it("hands the ranges card the material its market's ranges carry, and the market's types", () => {
    flush('CL', null, [range()]);

    // A tenant should not have to know that their CAF is called `CAF_XML` in this product.
    expect(card().secretKind()).toBe('CAF_XML');
    expect(card().documentTypes().map((type) => type.code)).toEqual(['33', '61']);
    expect(card().ranges()).toHaveLength(1);
  });

  it('asks for no authority material where the market issues none with its ranges', () => {
    flush('EC');
    expect(card().secretKind()).toBeNull();
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

  describe('transmission (FAC-EINV-04)', () => {
    it('never shows the stored credential, only that one is stored', () => {
      transmission = { ...transmission, transmissionEndpoint: 'https://pac.example.com/stamp', credentialScheme: 'BEARER', hasCredential: true, configured: true };
      try {
        flush('MX');
        expect(component.transmissionForm.getRawValue().credential).toBe('');
        expect(fixture.nativeElement.textContent).toContain('settings.pages.einvoicing.transmission.credential_stored');
      } finally {
        transmission = { ...transmission, hasCredential: false, configured: false, transmissionEndpoint: null };
      }
    });

    it('a blank credential keeps the stored one; a typed one replaces it', () => {
      flush('MX');
      component.transmissionForm.patchValue({ transmissionEndpoint: 'https://pac.example.com/stamp', credential: '' });
      component.saveTransmission();
      const kept = httpMock.expectOne((r) => r.url === `${regime}/transmission` && r.method === 'PUT');
      expect('credential' in kept.request.body).toBe(false);
      kept.flush({ ...transmission, configured: true });
      httpMock.match(() => true);

      component.transmissionForm.patchValue({ credential: 'nuevo-token' });
      component.saveTransmission();
      const replaced = httpMock.expectOne((r) => r.url === `${regime}/transmission` && r.method === 'PUT');
      expect(replaced.request.body.credential).toBe('nuevo-token');
    });

    it('refuses an endpoint that is not HTTPS before asking the server', () => {
      flush('MX');
      component.transmissionForm.patchValue({ transmissionEndpoint: 'http://pac.example.com/stamp' });
      component.saveTransmission();
      httpMock.expectNone((r) => r.url === `${regime}/transmission` && r.method === 'PUT');
    });
  });
});
