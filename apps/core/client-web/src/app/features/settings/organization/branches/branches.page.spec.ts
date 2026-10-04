import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { BranchesSettingsPage } from './branches.page';
import { DialogService } from '../../../../core/services/dialog.service';
import { NotificationService } from '../../../../core/services/notification';
import { of } from 'rxjs';
import { AuthService } from '../../../../core/services/auth';

/**
 * Settings › Branches. A branch carries what documents need from it, the first one is the
 * headquarters, the headquarters moves rather than disappears, and a branch with documents is
 * deactivated rather than deleted.
 */
describe('BranchesSettingsPage', () => {
  let http: HttpTestingController;
  const API = /\/organizations\/branches$/;
  const list = (r: { url: string; method: string }) => API.test(r.url) && r.method === 'GET';
  const confirm = jest.fn().mockResolvedValue(true);

  function create() {
    TestBed.configureTestingModule({
      imports: [BranchesSettingsPage, TranslateModule.forRoot()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: DialogService, useValue: { confirm } },
        {
          provide: NotificationService,
          useValue: { showSuccess: jest.fn(), showHttpError: jest.fn(), httpErrorMessage: () => 'error' },
        },
        {
          provide: AuthService,
          useValue: { isAuthenticated$: of(true), getPermissions$: () => of(['branches:manage']), hasPermissions: () => true },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(BranchesSettingsPage);
    fixture.detectChanges();
    http.match((r) => r.url.includes('/wms/warehouses')).forEach((r) => r.flush([]));
    return fixture;
  }

  const hq = {
    id: 'hq', code: 'MATRIZ', name: 'Casa matriz', address: null, city: 'Santo Domingo', state: null,
    postalCode: null, phone: null, fiscalEstablishmentCode: null, emissionPointCode: null,
    defaultWarehouseId: null, isHeadquarters: true, isActive: true, restrictedUserCount: 0,
  };

  afterEach(() => http.verify());

  it('makes the first branch the headquarters, locked, and sends the code in capitals', () => {
    const fixture = create();
    http.expectOne(list).flush([]);
    const page = fixture.componentInstance;

    page.openCreate();
    expect(page.form.controls.isHeadquarters.value).toBe(true);
    expect(page.form.controls.isHeadquarters.disabled).toBe(true);

    page.form.patchValue({ code: 'matriz', name: ' Casa matriz ', fiscalEstablishmentCode: '001', emissionPointCode: '001' });
    page.save();

    const post = http.expectOne((r) => API.test(r.url) && r.method === 'POST');
    expect(post.request.body).toMatchObject({
      code: 'MATRIZ',
      name: 'Casa matriz',
      fiscalEstablishmentCode: '001',
      emissionPointCode: '001',
      address: null,
      defaultWarehouseId: null,
    });
    // The box is checked and locked: the first branch is the headquarters.
    expect(post.request.body.isHeadquarters).toBe(true);
    post.flush(hq);
    http.expectOne(list).flush([hq]);
  });

  it('refuses a code the server would refuse, before sending it', () => {
    const fixture = create();
    http.expectOne(list).flush([hq]);
    const page = fixture.componentInstance;

    page.openCreate();
    page.form.patchValue({ code: 'con espacio', name: 'Tienda' });
    page.save();
    http.expectNone((r) => r.method === 'POST');
    expect(page.form.controls.code.invalid).toBe(true);
  });

  it('deactivates after confirmation, and keeps the row', async () => {
    const fixture = create();
    const store = { ...hq, id: 'st', code: 'STI', name: 'Santiago', isHeadquarters: false };
    http.expectOne(list).flush([hq, store]);
    const page = fixture.componentInstance;

    await page.setActive(store, false);
    expect(confirm).toHaveBeenCalled();
    const patch = http.expectOne((r) => r.url.endsWith('/organizations/branches/st') && r.method === 'PATCH');
    expect(patch.request.body).toEqual({ isActive: false });
    patch.flush({ ...store, isActive: false });

    expect(page.branches().find((b) => b.id === 'st')?.isActive).toBe(false);
    // Hidden by default, counted, and shown on request.
    expect(page.visible().map((b) => b.id)).toEqual(['hq']);
    expect(page.inactiveCount()).toBe(1);
  });
});
