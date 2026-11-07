import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { authServiceMock } from '../../../../testing/service-mocks';
import { PermissionGroupContract, Role, RolesService } from '../../../core/api/roles.service';
import { AuthService } from '../../../core/services/auth';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { SettingsShellService } from '../shell';
import { RolesManagementPage } from './roles.page';

const groups: PermissionGroupContract[] = [
  {
    key: 'sales',
    labelKey: 'permissions.groups.sales',
    permissions: [
      { value: 'sales:view', actionKey: 'permissions.actions.view' },
      { value: 'sales:create', actionKey: 'permissions.actions.create' },
    ],
  },
  {
    key: 'users',
    labelKey: 'permissions.groups.users',
    permissions: [{ value: 'users:view', actionKey: 'permissions.actions.view' }],
  },
];

const seller: Role = { id: 'r1', name: 'SELLER', description: null, permissions: ['sales:*'], isSystemRole: true };
const cashier: Role = { id: 'r2', name: 'Caja', description: 'Cobra en tienda', permissions: ['sales:view'], isSystemRole: false };

/**
 * A system role used to show «Editar» greyed out in every row, its reason only in a tooltip a
 * phone does not have: tapping it did nothing. It now opens the role read-only, and Save says what
 * is missing instead of staying grey.
 */
describe('RolesManagementPage', () => {
  const roles = {
    getRoles: jest.fn(() => of([seller, cashier])),
    getAvailablePermissions: jest.fn(() => of(groups)),
    createRole: jest.fn(() => of(cashier)),
    updateRole: jest.fn(() => of(cashier)),
    cloneRole: jest.fn(() => of(cashier)),
    deleteRole: jest.fn(() => of(undefined)),
  };
  const notifications = { showSuccess: jest.fn(), showError: jest.fn(), showHttpError: jest.fn(), httpErrorMessage: jest.fn(() => 'x') };

  function create(canEdit = true) {
    TestBed.configureTestingModule({
      imports: [RolesManagementPage],
      providers: [
        provideZonelessChangeDetection(),
        SettingsShellService,
        { provide: RolesService, useValue: roles },
        { provide: NotificationService, useValue: notifications },
        { provide: DialogService, useValue: { confirm: jest.fn().mockResolvedValue(true) } },
        { provide: AuthService, useValue: authServiceMock({ permissions: ['*'] }) },
      ],
    });
    TestBed.inject(SettingsShellService).canEdit.set(canEdit);
    const fixture = TestBed.createComponent(RolesManagementPage);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => jest.clearAllMocks());

  it('reads the roles and the permission catalogue as one load: one error, one retry, no toast', () => {
    roles.getAvailablePermissions.mockReturnValueOnce(throwError(() => new Error('down')) as never);
    const page = create().componentInstance;

    expect(page.loadError()).toBe('x');
    expect(notifications.showError).not.toHaveBeenCalled();

    page.load();
    expect(roles.getRoles).toHaveBeenCalledTimes(2);
    expect(roles.getAvailablePermissions).toHaveBeenCalledTimes(2);
    expect(page.loadError()).toBeNull();
    expect(page.permissionGroups()).toEqual(groups);
  });

  it('opens a system role read-only, listing what its wildcard grants', () => {
    const page = create().componentInstance;
    page.openRoleModal(seller);

    expect(page.isModalOpen()).toBe(true);
    expect(page.viewing()).toBe(seller);
    expect(page.editingRole()).toBeNull();
    // `sales:*` grants both sales actions; nothing in users.
    expect(page.grantedGroups().map((g) => [g.key, g.permissions.map((p) => p.value)])).toEqual([
      ['sales', ['sales:view', 'sales:create']],
    ]);
  });

  it('offers «Ver», not a greyed-out «Editar», on a system role', () => {
    const fixture = create();
    const rows = [...(fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr')];
    const firstAction = rows[0].querySelector('.row-actions .link-button') as HTMLButtonElement;
    const secondAction = rows[1].querySelector('.row-actions .link-button') as HTMLButtonElement;

    expect(firstAction.getAttribute('aria-disabled')).toBeNull();
    expect(firstAction.textContent).toContain('settings.roles.view');
    expect(secondAction.textContent).toContain('common.edit');
  });

  it('opens every role read-only for someone who may not edit roles', () => {
    const page = create(false).componentInstance;
    page.openRoleModal(cashier);

    expect(page.viewing()).toBe(cashier);
    expect(page.editingRole()).toBeNull();
  });

  it('opens a custom role for editing with its permissions ticked', () => {
    const page = create().componentInstance;
    page.openRoleModal(cashier);

    expect(page.viewing()).toBeNull();
    expect(page.editingRole()).toBe(cashier);
    expect(page.isPermissionSelected('sales:view')).toBe(true);
    expect(page.isPermissionSelected('sales:create')).toBe(false);
  });

  it('says what is missing when Save is pressed on an empty role, and sends nothing', () => {
    const page = create().componentInstance;
    page.openRoleModal();
    expect(page.permissionsMissing()).toBe(false);

    page.saveRole();

    expect(roles.createRole).not.toHaveBeenCalled();
    expect(page.attempted()).toBe(true);
    expect(page.roleForm.get('name')?.touched).toBe(true);
    expect(page.permissionsMissing()).toBe(true);
  });

  it('duplicates a system role from its read-only view', () => {
    const page = create().componentInstance;
    page.openRoleModal(seller);

    page.cloneFromView(seller);

    expect(roles.cloneRole).toHaveBeenCalledWith('r1');
    expect(page.isModalOpen()).toBe(false);
    expect(page.viewing()).toBeNull();
  });
});
