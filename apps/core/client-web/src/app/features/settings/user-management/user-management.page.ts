import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  OnDestroy,
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { CommonModule } from '@angular/common';
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
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
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
} from 'lucide-angular';
import { NotificationService } from '../../../core/services/notification';
import {
  InviteUserDto,
  UpdateUserDto,
  UsersService,
} from '../../../core/api/users.service';
import { Role, RolesService } from '../../../core/api/roles.service';
import { AuthService } from '../../../core/services/auth';
import { TranslateModule } from '@ngx-translate/core';
import { User as ApiUser } from '../../../shared/interfaces/user.interface';
import { UserStatus } from '../../../shared/enums/user-status.enum';
import { WebSocketService } from '../../../core/services/websocket.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { debounceTime, distinctUntilChanged, Subject, Subscription } from 'rxjs';

@Component({
  selector: 'app-user-management-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    LucideAngularModule,
    TranslateModule,
    HasPermissionDirective,
  ],
  templateUrl: './user-management.page.html',
  styleUrls: ['./user-management.page.scss'],
})
export class UserManagementPage implements OnInit, OnDestroy {
  // Servicios
  private fb = inject(FormBuilder);
  private usersService = inject(UsersService);
  private rolesService = inject(RolesService);
  private notificationService = inject(NotificationService);
  private webSocketService = inject(WebSocketService);
  public authService = inject(AuthService);

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
  protected readonly SortIcon = ArrowUpDown;
  protected readonly SortUpIcon = ArrowUp;
  protected readonly SortDownIcon = ArrowDown;
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
  pageSize = 8;
  totalUsers = signal(0);
  statusFilter = signal<string>('all');
  searchTerm = signal<string>('');
  sortColumn = signal<string>('createdAt');
  sortDirection = signal<'ASC' | 'DESC'>('DESC');

  private searchSubject = new Subject<string>();
  private subscriptions = new Subscription();

  totalPages = computed(() => Math.ceil(this.totalUsers() / this.pageSize));

  readonly statusClassMap: Record<UserStatus, string> = {
    [UserStatus.ACTIVE]: 'status-active',
    [UserStatus.PENDING]: 'status-pending',
    [UserStatus.BLOCKED]: 'status-blocked',
    [UserStatus.ARCHIVED]: 'status-archived',
    [UserStatus.INACTIVE]: 'status-inactive',
  };

  ngOnInit(): void {
    this.buildForm();
    this.loadRoles();
    this.loadUsers();

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
      pageSize: this.pageSize,
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
        this.notificationService.showError('No se pudieron cargar los usuarios.');
        this.loading.set(false);
      },
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
      this.usersService.updateUser(formValue.id, payload).subscribe({
        next: () => {
          this.notificationService.showSuccess('Usuario actualizado con éxito.');
          this.closeUserModal();
          this.loadUsers();
        },
        error: (err) => {
          this.notificationService.showError('Error al actualizar el usuario.');
          this.loading.set(false);
        },
      });
    } else {
      const payload: InviteUserDto = {
        firstName: formValue.firstName,
        lastName: formValue.lastName,
        email: formValue.email,
        roleId: formValue.roleId,
      };
      this.usersService.inviteUser(payload).subscribe({
        next: () => {
          this.notificationService.showSuccess('Usuario invitado con éxito.');
          this.closeUserModal();
          this.loadUsers();
        },
        error: (err) => {
          this.notificationService.showError('Error al invitar al usuario.');
          this.loading.set(false);
        },
      });
    }
  }

  confirmDelete(): void {
    if (!this.selectedUser) return;
    this.loading.set(true);
    this.usersService.deleteUser(this.selectedUser.id).subscribe({
      next: () => {
        this.notificationService.showSuccess('Usuario eliminado con éxito.');
        this.closeDeleteModal();
        this.loadUsers();
      },
      error: (err) => {
        this.notificationService.showError(err.error?.message || 'Error al eliminar el usuario.');
        this.loading.set(false);
        this.closeDeleteModal();
      },
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
    }
  }

  resetPassword(user: ApiUser): void {
    if (confirm(`¿Enviar un correo para resetear la contraseña de ${user.firstName}?`)) {
      this.usersService.sendPasswordReset(user.id).subscribe({
        next: (res) => this.notificationService.showSuccess(res.message),
        error: (err) => this.notificationService.showError(err.error?.message || 'Error al enviar el correo.'),
      });
    }
  }

  forceLogout(user: ApiUser): void {
    if (confirm(`¿Estás seguro que quieres cerrar la sesión de ${user.firstName}?`)) {
      this.usersService.forceLogout(user.id).subscribe({
        next: () => this.notificationService.showSuccess('La sesión del usuario ha sido cerrada.'),
        error: (err) => this.notificationService.showError(err.message || 'Error al cerrar la sesión.'),
      });
    }
  }

  blockAndLogout(user: ApiUser): void {
    if (confirm(`¿Estás seguro que quieres BLOQUEAR y cerrar la sesión de ${user.firstName}?`)) {
      this.usersService.blockAndLogout(user.id).subscribe({
        next: () => {
          this.notificationService.showSuccess('El usuario ha sido bloqueado y su sesión cerrada.');
          this.loadUsers();
        },
        error: (err) => this.notificationService.showError(err.message || 'Error al bloquear al usuario.'),
      });
    }
  }

  impersonateUser(user: ApiUser): void {
    if (confirm(`¿Estás seguro que quieres suplantar a ${user.firstName}?`)) {
        this.authService.impersonate(user.id).subscribe();
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

  sortTable(column: string): void {
    if (this.sortColumn() === column) {
      this.sortDirection.update((dir) => (dir === 'ASC' ? 'ASC' : 'DESC'));
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('ASC');
    }
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

  getStatusClass(status: UserStatus): string {
    return this.statusClassMap[status] || 'status-inactive';
  }

  getPageNumbers(): number[] {
    const total = this.totalPages();
    const current = this.currentPage();
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    if (current < 5) {
      return [1, 2, 3, 4, 5, -1, total];
    }
    if (current > total - 4) {
      return [1, -1, total - 4, total - 3, total - 2, total - 1, total];
    }
    return [1, -1, current - 1, current, current + 1, -1, total];
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
