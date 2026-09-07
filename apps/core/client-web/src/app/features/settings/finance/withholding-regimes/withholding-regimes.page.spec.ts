import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TranslateModule } from '@ngx-translate/core';
import { WithholdingRegimesPage } from './withholding-regimes.page';
import { MarketCoverage, WithholdingRegime } from '../../../../core/api/fiscal-settings.service';
import { environment } from '../../../../../environments/environment';

/**
 * The withholding regimes a tenant maintains, and the coverage statement beside them.
 *
 * Two things this has to get right, and they are the same two the entity enforces:
 *
 * 1. **The rate is a fraction.** Entered as a percentage, stored as a fraction, like every other
 *    rate in the product. Sending 18 where the server expects 0.18 withholds a hundredfold.
 * 2. **The legal basis is required.** The whole point of moving withholding off the request was to
 *    stop a rate being a number somebody typed, and a regime with no citation is exactly that.
 */
describe('WithholdingRegimesPage', () => {
  let fixture: ComponentFixture<WithholdingRegimesPage>;
  let component: WithholdingRegimesPage;
  let httpMock: HttpTestingController;

  const base = `${environment.apiUrl}/localization`;

  const regime = (overrides: Partial<WithholdingRegime> = {}): WithholdingRegime => ({
    id: 'r1',
    code: 'ITBIS-100',
    label: 'Retención ITBIS 100 %',
    kind: 'VAT',
    rate: 1,
    payers: ['WITHHOLDING_AGENT'],
    payees: ['INDIVIDUAL'],
    scope: 'ANY',
    legalBasis: 'Norma General 02-05',
    isActive: true,
    ...overrides,
  });

  const coverage: MarketCoverage = {
    countryCode: 'DO',
    capabilities: [
      { capability: 'accounting', level: 'implemented' },
      {
        capability: 'electronicInvoicing',
        level: 'needs-credentials',
        detail: 'DGII e-CF',
        requires: 'su certificado digital de la DGII',
      },
    ],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WithholdingRegimesPage, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(WithholdingRegimesPage);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  const flush = (rows: WithholdingRegime[] = [regime()], market: MarketCoverage | null = coverage) => {
    httpMock
      .expectOne((r) => r.url === `${base}/withholding-regimes` && r.method === 'GET')
      .flush(rows);
    const coverageRequest = httpMock.expectOne((r) => r.url === `${base}/fiscal-coverage`);
    if (market) coverageRequest.flush(market);
    else coverageRequest.flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
  };

  it('lists the regimes the tenant maintains', () => {
    flush();
    expect(component.regimes()).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('Norma General 02-05');
  });

  it('states what the product covers here, per capability rather than as one status word', () => {
    flush();
    const text = fixture.nativeElement.textContent as string;
    // "preview" told a customer almost nothing. What they need is which capability works and what
    // they have to supply for the one that does not.
    expect(text).toContain('DGII e-CF');
    expect(text).toContain('su certificado digital de la DGII');
  });

  it('sends the rate as a fraction, not as the percentage the operator typed', () => {
    flush([]);

    component.form.patchValue({
      code: 'ISR-10',
      label: 'Retención ISR servicios',
      kind: 'INCOME',
      ratePercent: 10,
      payers: ['COMPANY'],
      scope: 'SERVICES',
      legalBasis: 'Ley 11-92, artículo 309',
    });
    component.save();

    const created = httpMock.expectOne(
      (r) => r.url === `${base}/withholding-regimes` && r.method === 'POST',
    );
    expect(created.request.body.rate).toBeCloseTo(0.1, 10);
    created.flush(regime({ rate: 0.1 }));

    httpMock
      .expectOne((r) => r.url === `${base}/withholding-regimes` && r.method === 'GET')
      .flush([]);
  });

  it('refuses a regime with no legal basis, which is the whole point of the table', () => {
    flush([]);

    component.form.patchValue({
      code: 'X',
      label: 'Algo',
      kind: 'VAT',
      ratePercent: 18,
      payers: ['COMPANY'],
      legalBasis: '',
    });
    component.save();

    httpMock.expectNone((r) => r.method === 'POST');
    expect(component.form.controls.legalBasis.invalid).toBe(true);
  });

  it('refuses a regime that applies to nobody', () => {
    flush([]);

    // A regime with no payer is a rate that never resolves: it would sit in the table looking
    // configured and change no invoice.
    component.form.patchValue({
      code: 'X',
      label: 'Algo',
      kind: 'VAT',
      ratePercent: 18,
      payers: [],
      legalBasis: 'Norma General 02-05',
    });
    component.save();

    httpMock.expectNone((r) => r.method === 'POST');
  });

  it('still lets the tenant configure regimes when the coverage statement fails to load', () => {
    // The coverage is context, not the point of the page. Losing it must not block the work the
    // tenant came here to do.
    flush([regime()], null);
    expect(component.coverage()).toBeNull();
    expect(component.regimes()).toHaveLength(1);
  });
});
