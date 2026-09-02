import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';
import { UserManagementPage } from './user-management.page';
import { UsersService, InviteUserDto, UpdateUserDto } from '../../../core/api/users.service';
import { RolesService, Role } from '../../../core/api/roles.service';
import { NotificationService } from '../../../core/services/notification';
import { WebSocketService } from '../../../core/services/websocket.service';
import { AuthService } from '../../../core/services/auth';
import { TranslateModule } from '@ngx-translate/core';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { LucideAngularModule, UserPlus, Save, X, Send, User, History, Trash2, Key, Search, Filter, ArrowUpDown, ArrowUp, ArrowDown, MoreHorizontal, FilePenLine, Ban, UserCog, Mail, ChevronLeft, ChevronRight, Plus, RefreshCw, Power, PowerOff, Building, Lock, Archive, UserCheck, Zap, FileInput, FileOutput, UserCircle2, LogOut } from 'lucide-angular';
import { User as ApiUser } from '../../../shared/interfaces/user.interface';
import { UserStatus } from '../../../shared/enums/user-status.enum';
import { authServiceMock } from '../../../../testing/service-mocks';
import { StepUpService, StepUpScope } from '../../../core/services/step-up.service';
import { DialogService } from '../../../core/services/dialog.service';

const mockUsers: any[] = [
  { id: '1', firstName: 'John', lastName: 'Doe', email: 'john@doe.com', status: UserStatus.ACTIVE, roles: [{id: '1', name: 'Admin'}], organizationId: '1', isOnline: true, createdAt: new Date() },
  { id: '2', firstName: 'Jane', lastName: 'Doe', email: 'jane@doe.com', status: UserStatus.PENDING, roles: [{id: '2', name: 'User'}], organizationId: '1', isOnline: false, createdAt: new Date() },
];

const mockRoles: any[] = [
    { id: '1', name: 'Admin', permissions: [] },
    { id: '2', name: 'User', permissions: [] },
]

describe('UserManagementPage', () => {
  let component: UserManagementPage;
  let fixture: ComponentFixture<UserManagementPage>;
  let usersService: UsersService;
  let notificationService: NotificationService;

  const mockUsersService = {
    getUsers: jest.fn(() => of({ data: mockUsers, total: mockUsers.length })),
    inviteUser: jest.fn(() => of(mockUsers[0])),
    updateUser: jest.fn(() => of(mockUsers[0])),
    deleteUser: jest.fn(() => of(undefined)),
    // The screen exposes these too; the double stopped at the first four, so the tests could not
    // reach the actions that matter most.
    sendPasswordReset: jest.fn(() => of({ message: 'Correo enviado.' })),
    forceLogout: jest.fn(() => of(undefined)),
    blockAndLogout: jest.fn(() => of(undefined)),
  };

  const mockRolesService = {
    getRoles: jest.fn(() => of(mockRoles)),
  };

  const mockNotificationService = {
    showError: jest.fn(),
    showSuccess: jest.fn(),
  };

  const mockWebSocketService = {
    listen: () => of({}),
    disconnect: jest.fn(),
  };

  // The page reads permissions and the current user, and now drives every mutation through the
  // step-up flow, so the double has to be the real shape rather than two methods.
  const mockAuthService = authServiceMock({ permissions: ['*'] });

  /**
   * Every mutation on this screen is guarded server-side by StepUpGuard and therefore goes
   * through `requireStepUp`, which opens a re-authentication prompt before running the action.
   * The double stands in for the prompt and runs the action straight away, so these tests keep
   * asserting what they are about — the request that gets made — rather than the modal.
   *
   * `requireStepUp` is asserted on separately, so a mutation that stopped requiring it would
   * still be caught.
   */
  // The page asks through DialogService, not `window.confirm`; a stub that always confirms keeps
  // these tests about step-up, which is what they are for.
  const mockDialogService = {
    confirm: jest.fn().mockResolvedValue(true),
  };

  const mockStepUpService = {
    requireStepUp: jest.fn((_scope: unknown, _vcr: unknown, action: () => unknown) => action()),
  };

  beforeEach(() => {
    // The doubles are module-level constants shared by every test, so without this the call
    // counts below accumulate across the file and assert nothing about the test that reads them.
    jest.clearAllMocks();
    mockUsersService.getUsers.mockReturnValue(of({ data: mockUsers, total: 2, page: 1, pageSize: 10 }));
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        UserManagementPage,
        ReactiveFormsModule,
        TranslateModule.forRoot(),
        HasPermissionDirective,
        LucideAngularModule.pick({ UserPlus, Save, X, Send, User, History, Trash2, Key, Search, Filter, ArrowUpDown, ArrowUp, ArrowDown, MoreHorizontal, FilePenLine, Ban, UserCog, Mail, ChevronLeft, ChevronRight, Plus, RefreshCw, Power, PowerOff, Building, Lock, Archive, UserCheck, Zap, FileInput, FileOutput, UserCircle2, LogOut })
      ],
      providers: [
        provideZonelessChangeDetection(),
        { provide: UsersService, useValue: mockUsersService },
        { provide: RolesService, useValue: mockRolesService },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: WebSocketService, useValue: mockWebSocketService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: StepUpService, useValue: mockStepUpService },
        { provide: DialogService, useValue: mockDialogService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserManagementPage);
    component = fixture.componentInstance;
    usersService = TestBed.inject(UsersService);
    notificationService = TestBed.inject(NotificationService);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load users on init', () => {
    expect(mockUsersService.getUsers).toHaveBeenCalled();
    expect(component.users().length).toBe(2);
    expect(component.totalUsers()).toBe(2);
  });

  it('should open invite modal', () => {
    component.openInviteModal();
    expect(component.isEditMode()).toBe(false);
    expect(component.userModalOpen()).toBe(true);
    expect(component.userForm.value.id).toBeNull();
  });

  it('should open edit modal and patch form values', () => {
    const userToEdit = mockUsers[0];
    component.openEditModal(userToEdit);
    expect(component.isEditMode()).toBe(true);
    expect(component.userModalOpen()).toBe(true);
    expect(component.selectedUser).toBe(userToEdit);
    expect(component.userForm.value.firstName).toBe(userToEdit.firstName);
  });

  it('should invite a new user', fakeAsync(() => {
    component.openInviteModal();
    component.userForm.patchValue({
        firstName: 'Test',
        lastName: 'User',
        email: 'test@user.com',
        roleId: '1',
    });
    component.save();
    tick();

    const payload: InviteUserDto = {
        firstName: 'Test',
        lastName: 'User',
        email: 'test@user.com',
        roleId: '1',
    };
    expect(mockUsersService.inviteUser).toHaveBeenCalledWith(payload);
    expect(mockNotificationService.showSuccess).toHaveBeenCalledWith('SETTINGS.USER_MANAGEMENT.USUARIO_INVITADO_EXITO');
    // Once when the page loaded, once after saving so the list reflects the change.
    expect(mockUsersService.getUsers).toHaveBeenCalledTimes(2);
  }));

  it('should update an existing user', fakeAsync(() => {
    const userToEdit = mockUsers[0];
    component.openEditModal(userToEdit);
    component.userForm.patchValue({
        firstName: 'John Updated',
        lastName: 'Doe Updated',
        email: 'john.updated@doe.com',
        roleId: '2',
    });
    component.save();
    tick();

    const payload: UpdateUserDto = {
        firstName: 'John Updated',
        lastName: 'Doe Updated',
        email: 'john.updated@doe.com',
        roleId: '2',
    };
    expect(mockUsersService.updateUser).toHaveBeenCalledWith(userToEdit.id, payload);
    expect(mockNotificationService.showSuccess).toHaveBeenCalledWith('SETTINGS.USER_MANAGEMENT.USUARIO_ACTUALIZADO_EXITO');
    expect(mockUsersService.getUsers).toHaveBeenCalledTimes(2);
  }));

  it('should delete a user', fakeAsync(() => {
    const userToDelete = mockUsers[0];
    component.openDeleteModal(userToDelete);
    expect(component.deleteModalOpen()).toBe(true);
    expect(component.selectedUser).toBe(userToDelete);

    component.confirmDelete();
    tick();

    expect(mockUsersService.deleteUser).toHaveBeenCalledWith(userToDelete.id);
    expect(mockNotificationService.showSuccess).toHaveBeenCalledWith('SETTINGS.USER_MANAGEMENT.USUARIO_ELIMINADO_EXITO');
    expect(mockUsersService.getUsers).toHaveBeenCalledTimes(2);
  }));

  /**
   * The guarantee this screen lost and regained.
   *
   * Every mutation here is protected server-side by StepUpGuard, which requires a fresh proof of
   * the operator's identity delivered as a cookie. The previous guard expected that proof in a
   * request header no client ever sent, so each of these actions returned 403 — the screen
   * rendered, the buttons worked, and nothing happened. Asserting the scope, not just that some
   * step-up occurred, means a mutation cannot quietly be re-scoped to something weaker.
   */
  describe('re-authentication', () => {
    it.each([
      ['invite', StepUpScope.MANAGE_USERS, () => {
        component.openInviteModal();
        component.userForm.patchValue({ firstName: 'A', lastName: 'B', email: 'a@b.com', roleId: '1' });
        component.save();
      }],
      ['delete', StepUpScope.DELETE_ACCOUNT, () => {
        component.openDeleteModal(mockUsers[0]);
        component.confirmDelete();
      }],
      ['block', StepUpScope.MANAGE_USER_STATUS, () => {
        component.blockAndLogout(mockUsers[0]);
      }],
      ['force logout', StepUpScope.MANAGE_USER_CREDENTIALS, () => {
        component.forceLogout(mockUsers[0]);
      }],
      ['password reset', StepUpScope.MANAGE_USER_CREDENTIALS, () => {
        component.resetPassword(mockUsers[0]);
      }],
      ['impersonate', StepUpScope.IMPERSONATE, () => {
        component.impersonateUser(mockUsers[0]);
      }],
    ])('requires step-up before %s', fakeAsync((_label: string, scope: StepUpScope, act: () => void) => {
      act();
      tick();

      expect(mockStepUpService.requireStepUp).toHaveBeenCalledWith(
        scope,
        expect.anything(),
        expect.any(Function),
      );
    }));
  });

});
