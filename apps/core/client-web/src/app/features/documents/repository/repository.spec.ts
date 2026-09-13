import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TranslateModule } from '@ngx-translate/core';
import { RepositoryPage } from './repository.page';
import { environment } from '../../../../environments/environment';

/**
 * This screen listed two folders and four files written into the component — the same six rows for
 * every tenant of the product — with an upload button that uploaded nothing and a search box that
 * filtered a list nobody could add to.
 */
describe('RepositoryPage', () => {
  let fixture: ComponentFixture<RepositoryPage>;
  let component: RepositoryPage;
  let httpMock: HttpTestingController;

  const API = environment.apiUrl;

  const node = (over: Record<string, unknown> = {}) => ({
    id: 'n1',
    parentId: null,
    kind: 'FILE',
    name: 'Contrato.pdf',
    mimeType: 'application/pdf',
    fileSize: 2_202_009,
    templateType: 'NONE',
    description: null,
    createdByUserId: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...over,
  });

  const page = (rows: unknown[]) => ({ rows, page: 1, pageSize: 50, total: rows.length, hasMore: false });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RepositoryPage, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(RepositoryPage);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  it('lists the root of the tenant’s own tree', () => {
    httpMock.expectOne((c) => c.url === `${API}/documents`).flush(page([node()]));
    fixture.detectChanges();

    expect(component.files().map((item) => item.name)).toEqual(['Contrato.pdf']);
    expect(component.atRoot()).toBe(true);
    httpMock.verify();
  });

  it('opens a folder and asks for its contents', () => {
    httpMock
      .expectOne((c) => c.url === `${API}/documents`)
      .flush(page([node({ id: 'f1', kind: 'FOLDER', name: 'Legal', mimeType: null, fileSize: 0 })]));
    fixture.detectChanges();

    component.open(component.files()[0]);

    const listing = httpMock.expectOne(
      (c) => c.url === `${API}/documents` && c.params.get('parentId') === 'f1',
    );
    listing.flush(page([node()]));
    httpMock.expectOne((c) => c.url === `${API}/documents/f1/breadcrumb`).flush([
      { ...node({ id: 'f1', kind: 'FOLDER', name: 'Legal' }) },
    ]);
    fixture.detectChanges();

    expect(component.atRoot()).toBe(false);
    expect(component.breadcrumb().map((c) => c.name)).toEqual(['Legal']);
    httpMock.verify();
  });

  it('searches the whole tree rather than filtering what is on screen', () => {
    httpMock.expectOne((c) => c.url === `${API}/documents`).flush(page([]));
    fixture.detectChanges();

    component.onSearch('arrendamiento');

    const search = httpMock.expectOne(
      (c) => c.url === `${API}/documents` && c.params.get('search') === 'arrendamiento',
    );
    search.flush(page([node({ name: 'Arrendamiento-2019.pdf' })]));
    fixture.detectChanges();

    expect(component.files().map((f) => f.name)).toEqual(['Arrendamiento-2019.pdf']);
    httpMock.verify();
  });

  it('reports a size a human can read, and does not claim a folder has one', () => {
    httpMock.expectOne((c) => c.url === `${API}/documents`).flush(page([]));

    expect(component.sizeOf(node() as never)).toBe('2.1 MB');
    expect(component.sizeOf(node({ kind: 'FOLDER', fileSize: 0 }) as never)).toBe('—');
    httpMock.verify();
  });
});
