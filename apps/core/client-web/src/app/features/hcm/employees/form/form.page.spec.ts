import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { EmployeeFormPage } from './form.page';
import { TAB_CONTEXT, TabContext } from '../../../../core/tabs/tab-context';
import { environment } from '../../../../../environments/environment';

/**
 * What the header says about unsaved work, and what the address bar says about the record.
 *
 * Observed on the running app: filling in a new employee and saving showed "Saved", and the header
 * beside it went on reading "Unsaved" while the URL stayed `/hcm/employees/new`. Two separate
 * defects wearing one symptom.
 *
 * The first teaches the user to ignore the indicator — and what gets ignored next time is a true
 * warning about work that really is unsaved. The second is worse than cosmetic: reload that URL,
 * or share it, and an empty form comes back. It looks exactly like the record failed to save, so
 * the reasonable thing to do is fill it in and save it again, which is how you get two people in
 * the payroll for one hire.
 */
describe('Employee form', () => {
  let component: EmployeeFormPage;
  let fixture: ComponentFixture<EmployeeFormPage>;
  let http: HttpTestingController;

  const API = `${environment.apiUrl}/hcm`;

  /** What the catalogue answers for a Dominican tenant. Two documents and the passport. */
  const documentTypes = [
    {
      code: 'CEDULA',
      countryCode: 'DO',
      labelKey: 'identity_document.do.cedula',
      labelVerbatim: 'Cédula',
      example: '001-1234567-8',
      pattern: '^\\d{11}$',
      requirement: 'required',
      isDefault: true,
    },
    {
      code: 'PASSPORT',
      countryCode: 'XX',
      labelKey: 'identity_document.passport',
      labelVerbatim: null,
      example: null,
      pattern: '^[A-Za-z0-9]{5,20}$',
      requirement: 'optional',
      isDefault: false,
    },
  ];

  /** What a Dominican tenant's payroll strategy declares: the worker's NSS, AFP and SFS. */
  const statutoryTypes = [
    { field: 'socialSecurityNumber', labelKey: 'hcm.employees.form.social_security_number', pattern: '^\\d{7,11}$', required: false },
    { field: 'pensionFundCode', labelKey: 'hcm.employees.form.pension_fund_code', pattern: '^[A-Za-z0-9-]{1,32}$', required: false },
    { field: 'healthFundCode', labelKey: 'hcm.employees.form.health_fund_code', pattern: '^[A-Za-z0-9-]{1,32}$', required: false },
  ];

  const saved = {
    id: 'emp-1',
    firstName: 'Ana',
    lastName: 'Reyes',
    email: 'qa.ana@test.local',
    identityDocumentTypeCode: 'CEDULA',
    identityDocumentCountry: 'DO',
    employmentStatus: 'ACTIVE',
    contractType: 'INDEFINITE',
  };

  const tab: TabContext & { replaceRoute: jest.Mock; markClean: jest.Mock } = {
    tabId: 'tab-1',
    type: 'WIZARD',
    route: '/hcm/employees/new',
    title: 'New employee',
    icon: 'UserPlus',
    params: {},
    query: {},
    data: {},
    setTitle: jest.fn(),
    markDirty: jest.fn(),
    markClean: jest.fn(),
    replaceRoute: jest.fn(),
    registerSaveHandler: jest.fn(),
    emit: jest.fn(),
  } as unknown as TabContext & { replaceRoute: jest.Mock; markClean: jest.Mock };

  const build = (id?: string) => {
    fixture = TestBed.createComponent(EmployeeFormPage);
    component = fixture.componentInstance;
    if (id) fixture.componentRef.setInput('id', id);
    fixture.detectChanges();
    // Departments load on init in every case; it is not what these tests are about.
    http.expectOne(`${API}/departments`).flush([]);
    // So does the identity-document catalogue: the document `<select>` is filled from the server
    // for the tenant's country rather than from three options written into the template.
    http.expectOne(`${API}/identity-document-types`).flush(documentTypes);
    // The statutory identifiers the country asks for, filled from the server just like the documents.
    http.expectOne(`${API}/statutory-identifier-types`).flush(statutoryTypes);
  };

  /** Answers the record read and its compensation history, as opening an employee does. */
  const flushEmployee = (id = 'emp-1') => {
    http.expectOne(`${API}/employees/${id}`).flush({ ...saved, id });
    http.expectOne(`${API}/employees/${id}/compensation`).flush([]);
    fixture.detectChanges();
  };

  const fillIn = () => {
    component.form.patchValue({
      firstName: 'Ana',
      lastName: 'Reyes',
      email: 'qa.ana@test.local',
      // The type preselects to the country's default (CEDULA); a new employee now requires the
      // document itself, so the form is only valid once it carries one (A-06).
      identityDocument: '00113918204',
    });
    // What typing does, and what the header reads to decide whether work is pending.
    component.form.markAsDirty();
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [EmployeeFormPage],
      providers: [{ provide: TAB_CONTEXT, useValue: tab }],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('hands the new record its own window and URL instead of staying on /new', () => {
    build();
    fillIn();

    component.save();
    http.expectOne((r) => r.url === `${API}/employees` && r.method === 'POST').flush(saved);
    fixture.detectChanges();

    expect(tab.replaceRoute).toHaveBeenCalledWith('/hcm/employees/emp-1/edit', {
      title: 'Ana Reyes',
    });
    // The window is remounted on the record's route, so this page must NOT also refetch: doing
    // both would load the employee twice and leave this instance running after its replacement.
    http.expectNone(`${API}/employees/emp-1`);
  });

  it('stops reporting unsaved changes once the save has come back', () => {
    build('emp-1');
    flushEmployee();

    component.form.patchValue({ jobTitle: 'Analista' });
    component.form.markAsDirty();
    expect(component.form.dirty).toBe(true);

    component.save();
    http.expectOne((r) => r.url === `${API}/employees/emp-1` && r.method === 'PATCH').flush(saved);
    flushEmployee();

    expect(component.form.dirty).toBe(false);
    expect(tab.markClean).toHaveBeenCalled();
  });

  it('opens an existing record clean, having asked nobody to save anything', () => {
    build('emp-1');
    flushEmployee();

    expect(component.form.dirty).toBe(false);
    expect(component.form.get('firstName')?.value).toBe('Ana');
  });

});

/**
 * The same page mounted by the ROUTER, with no window around it.
 *
 * `TAB_CONTEXT` is injected `{ optional: true }` precisely so these pages keep working outside the
 * workspace. Without this case the hand-over above could be written as though the window always
 * exists, and the router-mounted form would save and then sit there showing nothing.
 */
describe('Employee form — outside the workspace', () => {
  let component: EmployeeFormPage;
  let fixture: ComponentFixture<EmployeeFormPage>;
  let http: HttpTestingController;

  const API = `${environment.apiUrl}/hcm`;

  /** What the catalogue answers for a Dominican tenant. Two documents and the passport. */
  const documentTypes = [
    {
      code: 'CEDULA',
      countryCode: 'DO',
      labelKey: 'identity_document.do.cedula',
      labelVerbatim: 'Cédula',
      example: '001-1234567-8',
      pattern: '^\\d{11}$',
      requirement: 'required',
      isDefault: true,
    },
    {
      code: 'PASSPORT',
      countryCode: 'XX',
      labelKey: 'identity_document.passport',
      labelVerbatim: null,
      example: null,
      pattern: '^[A-Za-z0-9]{5,20}$',
      requirement: 'optional',
      isDefault: false,
    },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [EmployeeFormPage] }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(EmployeeFormPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
    http.expectOne(`${API}/departments`).flush([]);
    http.expectOne(`${API}/identity-document-types`).flush(documentTypes);
    // A market with no modelled payroll rules answers with no specs; the form falls back to the
    // three neutral fields, and this router-mounted case only needs the request satisfied.
    http.expectOne(`${API}/statutory-identifier-types`).flush([]);
  });

  afterEach(() => http.verify());

  it('falls back to reloading the record in place', () => {
    component.form.patchValue({
      firstName: 'Ana',
      lastName: 'Reyes',
      email: 'qa.ana@test.local',
      identityDocument: '00113918204',
    });
    component.form.markAsDirty();

    component.save();
    http.expectOne((r) => r.url === `${API}/employees` && r.method === 'POST').flush({
      id: 'emp-1',
      firstName: 'Ana',
      lastName: 'Reyes',
      email: 'qa.ana@test.local',
      identityDocumentType: 'CEDULA',
      employmentStatus: 'ACTIVE',
      contractType: 'INDEFINITE',
    });
    fixture.detectChanges();

    http.expectOne(`${API}/employees/emp-1`).flush({
      id: 'emp-1',
      firstName: 'Ana',
      lastName: 'Reyes',
      email: 'qa.ana@test.local',
      identityDocumentType: 'CEDULA',
      employmentStatus: 'ACTIVE',
      contractType: 'INDEFINITE',
    });
    http.expectOne(`${API}/employees/emp-1/compensation`).flush([]);
    fixture.detectChanges();

    expect(component.current()?.id).toBe('emp-1');
    expect(component.form.dirty).toBe(false);
  });
});
