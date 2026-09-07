import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TranslateModule } from '@ngx-translate/core';
import { TaxJurisdictionsPage } from './tax-jurisdictions.page';
import { TaxJurisdiction } from '../../../../core/api/fiscal-settings.service';
import { environment } from '../../../../../environments/environment';

/**
 * Where the tenant is registered to collect tax, and at what rate.
 *
 * ## The one thing this screen must not get wrong
 *
 * A rate is entered as a percentage and stored as a fraction. Sending 8.25 where the server
 * expects 0.0825 does not fail, does not warn, and charges a customer **a hundred times** the tax
 * on every US invoice until somebody notices. There is no validation that can catch it either —
 * both numbers are inside every plausible range — so the conversion itself is what the test pins.
 *
 * ## Why this screen exists at all
 *
 * Without rows in `tax_jurisdictions`, `TenantJurisdictionProvider` answers `NO_NEXUS` and a US
 * invoice goes out with no tax. The table existed and could only be filled through the API, which
 * is to say it could not be filled.
 */
describe('TaxJurisdictionsPage', () => {
  let fixture: ComponentFixture<TaxJurisdictionsPage>;
  let component: TaxJurisdictionsPage;
  let httpMock: HttpTestingController;

  const jurisdiction = (overrides: Partial<TaxJurisdiction> = {}): TaxJurisdiction => ({
    id: 'j1',
    countryCode: 'US',
    stateCode: 'TX',
    county: null,
    city: null,
    postalCode: null,
    level: 'STATE',
    name: 'Texas',
    rate: 0.0625,
    isRegistered: true,
    sourcing: 'ORIGIN',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    ...overrides,
  });

  const url = `${environment.apiUrl}/localization/tax-jurisdictions`;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaxJurisdictionsPage, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(TaxJurisdictionsPage);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  const flushList = (rows: TaxJurisdiction[] = [jurisdiction()]) => {
    httpMock.expectOne((request) => request.url === url && request.method === 'GET').flush(rows);
    fixture.detectChanges();
  };

  it('lists the jurisdictions the tenant is registered in, grouped by state', () => {
    flushList([
      jurisdiction(),
      jurisdiction({ id: 'j2', stateCode: 'TX', level: 'CITY', name: 'Austin', rate: 0.01 }),
      jurisdiction({ id: 'j3', stateCode: 'CA', name: 'California', rate: 0.0725 }),
    ]);

    // Grouped by country and state together: a taxpayer registered in more than one country
    // thinks about "Texas" and "Jalisco" as separate places, and two states sharing a code across
    // countries would otherwise collapse into one heading.
    const groups = component.byState();
    expect(groups.map((group) => group.state)).toEqual(['US · TX', 'US · CA']);

    // The state-level and the city-level jurisdiction of the same state belong together: a sale in
    // Austin bears both, and reading them apart is how one of the two gets forgotten.
    expect(groups.find((group) => group.state === 'US · TX')?.rows).toHaveLength(2);
  });

  it('sends the rate as a fraction, not as the percentage the operator typed', () => {
    flushList([]);

    component.form.patchValue({
      countryCode: 'US',
      stateCode: 'TX',
      level: 'STATE',
      name: 'Texas',
      // 8.25 %, as it is written on the comptroller's own page.
      ratePercent: 8.25,
      effectiveFrom: '2026-01-01',
    });
    component.save();

    const created = httpMock.expectOne(
      (request) => request.url === url && request.method === 'POST',
    );
    // Not 8.25. A hundredfold error that no validator can catch, on every invoice, silently.
    expect(created.request.body.rate).toBeCloseTo(0.0825, 10);
    created.flush(jurisdiction({ rate: 0.0825 }));

    httpMock.expectOne((request) => request.url === url && request.method === 'GET').flush([]);
  });

  it('renders a stored fraction back as the percentage a person reads', () => {
    flushList([jurisdiction({ rate: 0.0825 })]);
    expect(component.percent(0.0825)).toBeCloseTo(8.25, 10);
  });

  it('refuses to submit without the state the jurisdiction belongs to', () => {
    flushList([]);

    component.form.patchValue({ countryCode: 'US', stateCode: '', name: 'Texas', ratePercent: 6 });
    component.save();

    // No request at all: an unnamed state produces a jurisdiction nothing can match a sale to.
    httpMock.expectNone((request) => request.method === 'POST');
    expect(component.form.invalid).toBe(true);
  });

  it('shows the nexus note, because a missing jurisdiction is silent', () => {
    flushList();
    const text = fixture.nativeElement.textContent as string;
    // Post-*Wayfair*, economic nexus is what obliges a seller to register at all, and the failure
    // mode of not registering is an invoice with no tax rather than an error.
    expect(text).toContain('NEXUS');
  });
});
