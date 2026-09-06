import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { JournalEntryImportPage } from './import.page';
import { ImportPreview } from '../../../../core/services/journal-entries';
import { environment } from '../../../../../environments/environment';

/**
 * Importing a journal from a file.
 *
 * ## What this screen was
 *
 * A file picker, a button, and `<pre>{{ previewData() | json }}</pre>`. `previewImport` posted the
 * file alone, with the comment *"For now, we just send the file"* — and the server requires
 * `columnMapping`, so **every** preview came back 400 and the screen answered with a hardcoded
 * Spanish sentence about the format being wrong. Nothing could be imported, and nothing said why.
 */
describe('JournalEntryImportPage', () => {
  let fixture: ComponentFixture<JournalEntryImportPage>;
  let component: JournalEntryImportPage;
  let httpMock: HttpTestingController;

  const API = `${environment.apiUrl}/journal-entries`;

  const preview: ImportPreview = {
    batchId: 'b-1',
    totalEntries: 2,
    validEntriesCount: 1,
    invalidEntriesCount: 1,
    previews: [
      {
        entryId: 'A1',
        isBalanced: true,
        totalDebit: 58_750,
        totalCredit: 58_750,
        errors: [],
        rows: [
          { lineNumber: 1, isValid: true, data: {} },
          { lineNumber: 2, isValid: true, data: {} },
        ],
      },
      {
        entryId: 'A2',
        isBalanced: false,
        totalDebit: 100,
        totalCredit: 99,
        errors: [
          {
            messageKey: 'JOURNAL_ENTRIES.IMPORT.ASIENTO_NO_CUADRA',
            params: { debit: 100, credit: 99 },
          },
        ],
        rows: [
          { lineNumber: 1, isValid: true, data: {} },
          {
            lineNumber: 2,
            isValid: false,
            error: { messageKey: 'JOURNAL_ENTRIES.IMPORT.CUENTA_NO_EXISTE', params: { code: '9999' } },
            data: {},
          },
        ],
      },
    ],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JournalEntryImportPage, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(JournalEntryImportPage);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  /** A `change` on the hidden file input, with one file on it. */
  function chooseFile(name = 'diario.csv'): void {
    const file = new File(['x'], name, { type: 'text/csv' });
    const input = fixture.nativeElement.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function flushHeaders(headers: string[]): void {
    httpMock.expectOne((request) => request.url === `${API}/import/headers`).flush(headers);
    fixture.detectChanges();
  }

  /**
   * There was no headers call and no mapping step at all, which is why the preview could never
   * succeed.
   */
  it('asks the server for the file’s columns as soon as one is chosen', () => {
    chooseFile();
    const request = httpMock.expectOne((c) => c.url === `${API}/import/headers`);
    expect(request.request.body instanceof FormData).toBe(true);
    request.flush(['Asiento', 'Fecha', 'Concepto', 'Cuenta', 'Debe', 'Haber']);
  });

  it('guesses the mapping from the column names, and offers every column for each field', () => {
    chooseFile();
    flushHeaders(['Asiento', 'Fecha', 'Concepto', 'Cuenta', 'Debe', 'Haber', 'Detalle']);

    expect(component.mapping()).toEqual({
      entryId: 'Asiento',
      date: 'Fecha',
      description: 'Concepto',
      accountCode: 'Cuenta',
      debit: 'Debe',
      credit: 'Haber',
      lineDescription: 'Detalle',
    });
    expect(component.isMappingComplete()).toBe(true);
  });

  it('recognises English column names too', () => {
    chooseFile();
    flushHeaders(['Entry', 'Date', 'Description', 'Account', 'Debit', 'Credit']);
    expect(component.isMappingComplete()).toBe(true);
  });

  it('will not preview until every required field is mapped', () => {
    chooseFile();
    flushHeaders(['Col A', 'Col B']);

    expect(component.isMappingComplete()).toBe(false);
    component.previewImport();
    httpMock.expectNone((c) => c.url === `${API}/import/preview`);
  });

  /**
   * The mapping, the date format and the decimal separator all travel. The server rejects a
   * request without them, and reads `03/04/2026` and `1.234,56` differently depending on the last
   * two.
   */
  it('sends the mapping, the date format and the decimal separator', () => {
    chooseFile();
    flushHeaders(['Asiento', 'Fecha', 'Concepto', 'Cuenta', 'Debe', 'Haber']);

    component.dateFormat.set('MM/dd/yyyy');
    component.decimalSeparator.set('.');
    component.previewImport();

    const request = httpMock.expectOne((c) => c.url === `${API}/import/preview`);
    const body = request.request.body as FormData;
    expect(body.get('dateFormat')).toBe('MM/dd/yyyy');
    expect(body.get('decimalSeparator')).toBe('.');
    expect(JSON.parse(body.get('columnMapping') as string)).toMatchObject({
      entryId: 'Asiento',
      debit: 'Debe',
      credit: 'Haber',
    });
    request.flush(preview);
  });

  /**
   * Every reason, on the row it belongs to. The previous screen printed the whole response as raw
   * JSON.
   */
  it('shows why each entry will not be imported', () => {
    chooseFile();
    flushHeaders(['Asiento', 'Fecha', 'Concepto', 'Cuenta', 'Debe', 'Haber']);
    component.previewImport();
    httpMock.expectOne((c) => c.url === `${API}/import/preview`).flush(preview);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('JOURNAL_ENTRIES.IMPORT.ASIENTO_NO_CUADRA');
    expect(text).toContain('JOURNAL_ENTRIES.IMPORT.CUENTA_NO_EXISTE');
    expect(text).not.toContain('batchId');
  });

  it('confirms the batch the preview named', () => {
    chooseFile();
    flushHeaders(['Asiento', 'Fecha', 'Concepto', 'Cuenta', 'Debe', 'Haber']);
    component.previewImport();
    httpMock.expectOne((c) => c.url === `${API}/import/preview`).flush(preview);

    component.confirmImport();
    const request = httpMock.expectOne((c) => c.url === `${API}/import/confirm`);
    expect(request.request.body).toEqual({ batchId: 'b-1' });
    request.flush({
      messageKey: 'JOURNAL_ENTRIES.IMPORTACION_CONFIRMADA_PROCESADA_EXITOSAMENTE',
      createdEntriesCount: 1,
    });
  });

  it('does not confirm a preview in which nothing is postable', () => {
    chooseFile();
    flushHeaders(['Asiento', 'Fecha', 'Concepto', 'Cuenta', 'Debe', 'Haber']);
    component.previewImport();
    httpMock
      .expectOne((c) => c.url === `${API}/import/preview`)
      .flush({ ...preview, validEntriesCount: 0 });

    component.confirmImport();
    httpMock.expectNone((c) => c.url === `${API}/import/confirm`);
  });
});
