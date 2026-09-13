import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TranslateModule } from '@ngx-translate/core';
import { TemplatesPage } from './templates.page';
import { environment } from '../../../../environments/environment';

/**
 * This screen listed three templates written into the component — `Plantilla de Factura Estándar`
 * and two more — which could not be opened, downloaded or replaced, and were the same for every
 * tenant of the product.
 */
describe('TemplatesPage', () => {
  let fixture: ComponentFixture<TemplatesPage>;
  let component: TemplatesPage;
  let httpMock: HttpTestingController;

  const API = environment.apiUrl;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TemplatesPage, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(TemplatesPage);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  it('asks only for the files that are actually tagged as templates', () => {
    const request = httpMock.expectOne(
      (c) => c.url === `${API}/documents` && c.params.get('templatesOnly') === 'true',
    );
    request.flush({
      rows: [
        {
          id: 't1',
          parentId: null,
          kind: 'FILE',
          name: 'Membrete.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          fileSize: 12_345,
          templateType: 'INVOICE',
          description: null,
          createdByUserId: null,
          createdAt: '2026-09-01T10:00:00.000Z',
          updatedAt: '2026-09-01T10:00:00.000Z',
        },
      ],
      page: 1,
      pageSize: 50,
      total: 1,
      hasMore: false,
    });
    fixture.detectChanges();

    expect(component.templates().map((t) => t.name)).toEqual(['Membrete.docx']);
    httpMock.verify();
  });

  it('shows an empty state rather than three templates nobody uploaded', () => {
    httpMock
      .expectOne((c) => c.url === `${API}/documents`)
      .flush({ rows: [], page: 1, pageSize: 50, total: 0, hasMore: false });
    fixture.detectChanges();

    expect(component.isEmpty()).toBe(true);
    httpMock.verify();
  });
});
