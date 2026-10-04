import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { RoleNamePipe, roleLabel } from '../../../shared/pipes/role-name.pipe';
import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  OnDestroy,
  ViewContainerRef,
  effect,
  untracked,
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { DialogService } from '../../../core/services/dialog.service';
import {
  LucideAngularModule,
  UserPlus,
  Save,
  X,
  Send,
  User,
  History,
  Trash2,
  Key,
  Search,
  Filter,
  MoreHorizontal,
  FilePenLine,
  Ban,
  UserCog,
  Mail,
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  Power,
  PowerOff,
  Building,
  Lock,
  Archive,
  UserCheck,
  Zap,
  FileInput,
  FileOutput,
  UserCircle2,
  LogOut,
  MapPin,
} from 'lucide-angular';
import { NotificationService } from '../../../core/services/notification';
import { UserBranchAccessDialogComponent } from './branch-access/branch-access.dialog';
import {
  InviteUserDto,
  UpdateUserDto,
  UsersService,
  SentInvitation,
} from '../../../core/api/users.service';
import { Role, RolesService } from '../../../core/api/roles.service';
import { AuthService } from '../../../core/services/auth';
import { User as ApiUser } from '../../../shared/interfaces/user.interface';
import { UserStatus } from '../../../shared/enums/user-status.enum';
import { WebSocketService } from '../../../core/services/websocket.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { debounceTime, distinctUntilChanged, Subject, Subscription } from 'rxjs';
import { StepUpService, StepUpScope } from '../../../core/services/step-up.service';
import { composeKey } from '@virteex/shared/types';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { VxSpinnerComponent } from '../../../shared/components/feedback';
import { VxPagerComponent } from '../../../shared/components/pager';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';
import { VX_SELECT } from '../../../shared/components/select';
import { TableSort, VX_SORT, sortable } from '../../../shared/components/sort';

@Component({
  selector: 'app-user-management-page',
  standalone: true,
  imports: [...VX_SORT, ...FORMAT_PIPES, RoleNamePipe, 
    CommonModule,
    ReactiveFormsModule,
    LucideAngularModule,
    TranslateModule,
    HasPermissionDirective,
    ...VX_FORM_A11Y, ...VX_SELECT, VxSpinnerComponent, VxPagerComponent, VxBadgeComponent,
    UserBranchAccessDialogComponent],
  templateUrl: './user-management.page.html',
  styleUrls: ['./user-management.page.scss'],
})
export class UserManagementPage implements OnInit, OnDestroy {
  /** Sortable by its headers (QA B-01). */
  readonly invitationsTable = sortable(() => this.sentInvitations(), { name: (invitation) => `${invitation.firstName} ${invitation.lastName}`, role: (invitation) => roleLabel(this.translate, invitation.roleName) });
  private readonly translate = inject(TranslateService);
  private readonly dialog = inject(DialogService);
  // Servicios
  private fb = inject(FormBuilder);
  private usersService = inject(UsersService);
  private rolesService = inject(RolesService);
  private notificationService = inject(NotificationService);
  private webSocketService = inject(WebSocketService);
  public authService = inject(AuthService);
  // Every mutation below is guarded server-side by StepUpGuard: the request must carry a fresh
  // proof of the operator's own identity. Nothing on this screen worked before, because the
  // previous guard expected that proof in a request header no client ever sent.
  private stepUp = inject(StepUpService);
  private viewContainerRef = inject(ViewContainerRef);

  // Iconos
  protected readonly UserPlusIcon = UserPlus;
  protected readonly SaveIcon = Save;
  protected readonly CloseIcon = X;
  protected readonly ActivateIcon = Power;
  protected readonly DeactivateIcon = PowerOff;
  protected readonly ResetPasswordIcon = Send;
  protected readonly HistoryIcon = History;
  protected readonly BuildingIcon = Building;
  protected readonly LockIcon = Lock;
  protected readonly ArchiveIcon = Archive;
  protected readonly TrashIcon = Trash2;
  protected readonly KeyIcon = Key;
  protected readonly BranchIcon = MapPin;
  /** The person whose branches are being edited, while that dialog is open. */
  readonly branchAccessUser = signal<{ id: string; name: string } | null>(null);
  protected readonly UserIcon = User;
  protected readonly UserCheckIcon = UserCheck;
  protected readonly ZapIcon = Zap;
  protected readonly FileInputIcon = FileInput;
  protected readonly RefreshCwIcon = RefreshCw;
  protected readonly FileOutputIcon = FileOutput;
  protected readonly UserCircleIcon = UserCircle2;
  protected readonly LogOutIcon = LogOut;
  protected readonly SearchIcon = Search;
  protected readonly FilterIcon = Filter;
  protected readonly MoreHorizontalIcon = MoreHorizontal;
  protected readonly EditIcon = FilePenLine;
  protected readonly BanIcon = Ban;
  protected readonly UserCogIcon = UserCog;
  protected readonly MailIcon = Mail;
  protected readonly ChevronLeftIcon = ChevronLeft;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly PlusIcon = Plus;
  protected readonly PowerOff = PowerOff;

  // Formulario
  userForm!: FormGroup;

  // Estado
  users = signal<ApiUser[]>([]);
  roles = signal<Role[]>([]);

  protected readonly roleName = (role: Role): string => roleLabel(this.translate, role.name);
  protected readonly roleId = (role: Role): string => role.id;
  loading = signal(true);
  isEditMode = signal(false);
  userModalOpen = signal(false);
  deleteModalOpen = signal(false);
  selectedUser: ApiUser | null = null;
  contextMenuUser: ApiUser | null = null;
  showContextMenu = false;
  contextMenuPosition = { x: 0, y: 0 };
  activeTab: 'general' | 'permissions' | 'advanced' = 'general';

  // Paginación y Filtros
  currentPage = signal(1);
  /**
   * Cuántas filas por página, ahora elegible.
   *
   * Era la constante `8`, decidida aquí y distinta de las otras dos del producto (50 en asientos,
   * 50 en nómina). El paginador ofrece 25/50/100 y esta señal recuerda lo elegido.
   */
  pageSize = signal(25);
  totalUsers = signal(0);
  statusFilter = signal<string>('all');
  searchTerm = signal<string>('');
  /**
   * The order the server applies (QA B-01). The headers had their own handler, whose second click
   * set the direction it already had, and icons bound by `[name]` to objects, so nothing showed.
   * With no column chosen the server's default stands: newest member first.
   */
  readonly sort = new TableSort<unknown, 'firstName' | 'email' | 'status'>();
  readonly sortColumn = computed(() => this.sort.state().key ?? 'createdAt');
  readonly sortDirection = computed<'ASC' | 'DESC'>(() =>
    this.sort.state().key ? (this.sort.state().direction === 'asc' ? 'ASC' : 'DESC') : 'DESC',
  );
  /** A new order is a new result set, from its first page. The initial state is `ngOnInit`'s load. */
  private readonly reloadOnSort = (() => {
    let initial = true;
    return effect(() => {
      this.sort.state();
      if (initial) {
        initial = false;
        return;
      }
      untracked(() => {
        this.currentPage.set(1);
        this.loadUsers();
      });
    });
  })();

  private searchSubject = new Subject<string>();
  private subscriptions = new Subscription();

  totalPages = computed(() => Math.ceil(this.totalUsers() / this.pageSize()));

  /**
   * Invitations sent to people who already have an account. They are not members yet — they have
   * been ASKED — so they are listed apart from the table of members, and can be withdrawn.
   */
  sentInvitations = signal<SentInvitation[]>([]);

  /** Lo que significa cada situación de una cuenta. El color lo pone `vx-badge`, una vez. */
  private readonly statusToneMap: Record<UserStatus, VxTone> = {
    [UserStatus.ACTIVE]: 'ok',
    [UserStatus.PENDING]: 'warning',
    [UserStatus.BLOCKED]: 'danger',
    [UserStatus.ARCHIVED]: 'neutral',
    [UserStatus.INACTIVE]: 'neutral',
  };

  ngOnInit(): void {
    this.buildForm();
    this.loadRoles();
    this.loadUsers();
    this.loadSentInvitations();

    const searchSubscription = this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged())
      .subscribe((term) => {
        this.searchTerm.set(term);
        this.currentPage.set(1);
        this.loadUsers();
      });

    const wsSubscription = this.webSocketService
      .listen<{ userId: string; isOnline: boolean }>('user-status-update')
      .subscribe((data) => {
        this.users.update((currentUsers) =>
          currentUsers.map((user) =>
            user.id === data.userId ? { ...user, isOnline: data.isOnline } : user
          )
        );
      });

    this.subscriptions.add(searchSubscription);
    this.subscriptions.add(wsSubscription);
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  buildForm(): void {
    this.userForm = this.fb.group({
      id: [null],
      firstName: ['', Validators.required],
      lastName: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      roleId: [null, Validators.required],
      department: [''],
      invitationMessage: [''],
    });
  }

  loadUsers(): void {
    this.loading.set(true);
    const options = {
      page: this.currentPage(),
      pageSize: this.pageSize(),
      searchTerm: this.searchTerm(),
      statusFilter: this.statusFilter(),
      sortColumn: this.sortColumn(),
      sortDirection: this.sortDirection(),
    };

    this.usersService.getUsers(options).subscribe({
      next: (response) => {
        this.users.set(response.data);
        this.totalUsers.set(response.total);
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.showError('settings.user_management.users_could_not_loaded');
        this.loading.set(false);
      },
    });
  }

  loadSentInvitations(): void {
    this.usersService.getSentInvitations().subscribe({
      next: (list) => this.sentInvitations.set(list ?? []),
      // The member list is what matters on this page; a missing side panel must not block it.
      error: () => this.sentInvitations.set([]),
    });
  }

  revokeInvitation(invitation: SentInvitation): void {
    this.usersService.revokeInvitation(invitation.id).subscribe({
      next: () => {
        this.sentInvitations.update((list) => list.filter((item) => item.id !== invitation.id));
        this.notificationService.showSuccess('settings.user_management.invitation_revoked');
      },
      error: () => this.notificationService.showError('settings.user_management.invitation_revoke_failed'),
    });
  }

  loadRoles(): void {
    this.rolesService
      .getRoles()
      .subscribe({ next: (roles) => this.roles.set(roles) });
  }

  openInviteModal(): void {
    this.isEditMode.set(false);
    this.userForm.reset({ roleId: null });
    this.userModalOpen.set(true);
  }

  openEditModal(user: ApiUser): void {
    this.isEditMode.set(true);
    this.selectedUser = user;
    this.userForm.patchValue({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      roleId: user.roles?.[0]?.id || null,
    });
    this.userModalOpen.set(true);
  }

  closeUserModal(): void {
    this.userModalOpen.set(false);
    this.selectedUser = null;
  }

  openDeleteModal(user: ApiUser): void {
    this.selectedUser = user;
    this.deleteModalOpen.set(true);
  }

  closeDeleteModal(): void {
    this.deleteModalOpen.set(false);
    this.selectedUser = null;
  }

  /** Whether a field should show its error: only after the user touched it or tried to save. */
  invalid(name: string): boolean {
    const control = this.userForm.get(name);
    return !!control && control.invalid && (control.touched || control.dirty);
  }

  fieldError(name: string): string {
    const control = this.userForm.get(name);
    return control?.hasError('email') ? 'settings.user_management.errors.email_invalid' : 'settings.user_management.errors.required';
  }

  save(): void {
    if (this.userForm.invalid) {
      this.userForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    const formValue = this.userForm.value;

    if (this.isEditMode()) {
      const payload: UpdateUserDto = {
        firstName: formValue.firstName,
        lastName: formValue.lastName,
        email: formValue.email,
        roleId: formValue.roleId,
      };
      this.stepUp
        .requireStepUp(StepUpScope.MANAGE_USERS, this.viewContainerRef, () =>
          this.usersService.updateUser(formValue.id, payload),
        )
        .subscribe({
          next: () => {
            this.notificationService.showSuccess('settings.user_management.user_updated_successfully');
            this.closeUserModal();
            this.loadUsers();
          },
          error: (err) => {
            this.notificationService.showHttpError(err, 'errors.update_user');
            this.loading.set(false);
          },
          complete: () => this.loading.set(false),
        });
    } else {
      const payload: InviteUserDto = {
        firstName: formValue.firstName,
        lastName: formValue.lastName,
        email: formValue.email,
        roleId: formValue.roleId,
      };
      this.stepUp
        .requireStepUp(StepUpScope.MANAGE_USERS, this.viewContainerRef, () =>
          this.usersService.inviteUser(payload),
        )
        .subscribe({
          next: () => {
            this.notificationService.showSuccess('settings.user_management.user_invited_successfully');
            this.closeUserModal();
            this.loadUsers();
            this.loadSentInvitations();
          },
          error: (err) => {
            this.notificationService.showHttpError(err, 'errors.invite_user');
            this.loading.set(false);
          },
          complete: () => this.loading.set(false),
        });
    }
  }

  confirmDelete(): void {
    if (!this.selectedUser) return;
    this.loading.set(true);
    const userId = this.selectedUser.id;
    this.stepUp
      .requireStepUp(StepUpScope.DELETE_ACCOUNT, this.viewContainerRef, () =>
        this.usersService.deleteUser(userId),
      )
      .subscribe({
        next: () => {
          this.notificationService.showSuccess('settings.user_management.user_deleted_successfully');
          this.closeDeleteModal();
          this.loadUsers();
        },
        error: (err) => {
          this.notificationService.showHttpError(err, 'errors.delete_user');
          this.loading.set(false);
          this.closeDeleteModal();
        },
        complete: () => this.loading.set(false),
      });
  }

  handleAction(action: string, user: ApiUser): void {
    this.closeContextMenu();
    this.selectedUser = user;
    switch (action) {
      case 'edit':
        this.openEditModal(user);
        break;
      case 'resetPassword':
        this.resetPassword(user);
        break;
      case 'delete':
        this.openDeleteModal(user);
        break;
      case 'force-logout':
        this.forceLogout(user);
        break;
      case 'block-and-logout':
        this.blockAndLogout(user);
        break;
      case 'impersonate':
        this.impersonateUser(user);
        break;
      case 'branches':
        this.branchAccessUser.set({ id: user.id, name: `${user.firstName} ${user.lastName}`.trim() || user.email });
        break;
      case 'resend-invitation':
        this.resendInvitation(user);
        break;
    }
  }

  /** A pending member gets a new link; the previous one stops working (QA B-02). */
  resendInvitation(user: ApiUser): void {
    this.stepUp
      .requireStepUp(StepUpScope.MANAGE_USERS, this.viewContainerRef, () => this.usersService.resendInvitation(user.id))
      .subscribe({
        next: ({ email }) => this.notificationService.showSuccess('settings.user_management.invitation_resent', { email }),
        error: (err) => this.notificationService.showHttpError(err, 'errors.send_mail'),
      });
  }

  /**
   * Ask before an action that affects somebody else's account.
   *
   * These four were `window.confirm` with the sentence written in Spanish in the call, so an
   * English-speaking administrator was asked, in Spanish, whether to block a user. The dialog is
   * the product's own, and the sentence names the person it concerns.
   */
  private ask(section: string, user: ApiUser, variant: 'primary' | 'warning' | 'danger'): Promise<boolean> {
    return this.dialog.confirm({
      title: composeKey('dialog', section, 'title'),
      message: composeKey('dialog', section, 'message'),
      messageParams: { name: `${user.firstName} ${user.lastName ?? ''}`.trim() },
      variant,
    });
  }

  async resetPassword(user: ApiUser): Promise<void> {
    if (await this.ask('RESET_PASSWORD', user, 'primary')) {
      this.stepUp
        .requireStepUp(StepUpScope.MANAGE_USER_CREDENTIALS, this.viewContainerRef, () =>
          this.usersService.sendPasswordReset(user.id),
        )
        .subscribe({
          next: (res) => this.notificationService.showSuccess(res.message),
          error: (err) =>
            this.notificationService.showHttpError(err, 'errors.send_mail'),
        });
    }
  }

  async forceLogout(user: ApiUser): Promise<void> {
    if (await this.ask('REVOKE_SESSION', user, 'warning')) {
      this.stepUp
        .requireStepUp(StepUpScope.MANAGE_USER_CREDENTIALS, this.viewContainerRef, () =>
          this.usersService.forceLogout(user.id),
        )
        .subscribe({
          next: () => this.notificationService.showSuccess('settings.user_management.user_session_has_closed'),
          error: (err) =>
            this.notificationService.showHttpError(err, 'errors.revoke_session'),
        });
    }
  }

  async blockAndLogout(user: ApiUser): Promise<void> {
    if (await this.ask('BLOCK_USER', user, 'danger')) {
      this.stepUp
        .requireStepUp(StepUpScope.MANAGE_USER_STATUS, this.viewContainerRef, () =>
          this.usersService.blockAndLogout(user.id),
        )
        .subscribe({
          next: () => {
            this.notificationService.showSuccess('settings.user_management.user_has_blocked_their_session_closed');
            this.loadUsers();
          },
          error: (err) =>
            this.notificationService.showHttpError(err, 'errors.block_user'),
        });
    }
  }

  async impersonateUser(user: ApiUser): Promise<void> {
    if (await this.ask('IMPERSONATE_USER', user, 'warning')) {
      this.stepUp
        .requireStepUp(StepUpScope.IMPERSONATE, this.viewContainerRef, () =>
          this.authService.impersonate(user.id),
        )
        .subscribe({
          error: (err) =>
            this.notificationService.showHttpError(err, 'errors.impersonate'),
        });
    }
  }

  onSearch(event: Event): void {
    const term = (event.target as HTMLInputElement).value;
    this.searchSubject.next(term);
  }

  applyStatusFilter(status: string): void {
    this.statusFilter.set(status);
    this.currentPage.set(1);
    this.loadUsers();
  }

  sortTable(column: 'firstName' | 'email' | 'status'): void {
    this.sort.toggle(column);
  }

  changePageSize(size: number): void {
    this.pageSize.set(size);
    this.currentPage.set(1);
    this.loadUsers();
  }

  changePage(page: number): void {
    if (page > 0 && page <= this.totalPages()) {
      this.currentPage.set(page);
      this.loadUsers();
    }
  }

  getRoleNames(user: ApiUser): string {
    if (!user.roles || user.roles.length === 0) return 'Sin rol';
    return user.roles.map((r) => r.name).join(', ');
  }

  statusTone(status: UserStatus): VxTone {
    return this.statusToneMap[status] ?? 'neutral';
  }

  openUserActions(event: MouseEvent, user: ApiUser): void {
    event.stopPropagation();
    this.contextMenuUser = user;
    this.showContextMenu = true;
    this.contextMenuPosition = { x: event.clientX, y: event.clientY };
  }

  closeContextMenu(): void {
    this.showContextMenu = false;
    this.contextMenuUser = null;
  }
}
