import { SettingsActionsDirective } from '../shell';
import { RoleNamePipe } from '../../../shared/pipes/role-name.pipe';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, Validators, FormArray, FormControl } from '@angular/forms';
import { DialogService } from '../../../core/services/dialog.service';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
// ✅ CORREGIDO: Se importa el ícono 'X' que se usará como CloseIcon.
import { LucideAngularModule, Plus, Edit, Trash, Copy, X, MoreHorizontal } from 'lucide-angular';

import { TranslateService } from '@ngx-translate/core';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import {
  RolesService,
  Role,
  CreateRoleDto,
  UpdateRoleDto,
  PermissionGroupContract,
} from '../../../core/api/roles.service';
import { NotificationService } from '../../../core/services/notification';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { VxDialogComponent } from '../../../shared/components/dialog';
import { VxBadgeComponent } from '../../../shared/components/badge';
import { VxErrorStateComponent, VxSpinnerComponent } from '../../../shared/components/feedback';
import { ListMenuConfig, VX_CONTEXT_MENU } from '../../../shared/components/context-menu';



@Component({
  selector: 'app-roles-management-page',
  standalone: true,
  imports: [SettingsActionsDirective, RoleNamePipe, 
    CommonModule,
    ReactiveFormsModule,
    LucideAngularModule,
    HasPermissionDirective,
    TranslateModule,
    ...VX_FORM_A11Y, VxDialogComponent, VxBadgeComponent, VxSpinnerComponent, VxErrorStateComponent, ...VX_CONTEXT_MENU],
  templateUrl: './roles.page.html',
  styleUrls: ['./roles.page.scss'],
})
export class RolesManagementPage implements OnInit {
  private readonly dialog = inject(DialogService);
  private readonly fb = inject(FormBuilder);
  private readonly rolesService = inject(RolesService);
  private readonly notificationService = inject(NotificationService);
  private readonly translate = inject(TranslateService);

  /** Iconos */
  protected readonly PlusIcon = Plus;
  protected readonly EditIcon = Edit;
  protected readonly TrashIcon = Trash;
  protected readonly CloneIcon = Copy;
  protected readonly MoreIcon = MoreHorizontal;
  protected readonly CloseIcon = X; // ✅ CORREGIDO: Se define la propiedad para el ícono de cerrar.

  /** Estado */
  readonly roles = signal<Role[]>([]);
  readonly permissionGroups = signal<PermissionGroupContract[]>([]);
  readonly isModalOpen = signal(false);
  readonly editingRole = signal<Role | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  /**
   * Duplicar y eliminar, en el menú compartido de las tablas («Editar» queda a la vista en la fila).
   * Un rol del sistema no se elimina: la opción sigue en el menú, deshabilitada y diciendo por qué.
   */
  readonly rolesMenu: ListMenuConfig<Role> = {
    resource: 'roles',
    row: (ctx) => {
      const role = ctx.entity as Role;
      return [
        {
          id: 'role',
          items: [
            { id: 'clone', label: 'settings.roles.clone_role', icon: Copy, permission: 'roles:create', run: () => this.cloneRole(role) },
            {
              id: 'delete',
              label: role.isSystemRole ? 'settings.roles.delete_role_locked' : 'settings.roles.delete_role',
              icon: Trash,
              danger: true,
              permission: 'roles:delete',
              disabled: () => role.isSystemRole,
              run: () => this.deleteRole(role),
            },
          ],
        },
      ];
    },
  };

  /** Formulario */
  readonly roleForm: FormGroup = this.fb.group({
    name: ['', Validators.required],
    description: [''],
    permissions: this.fb.array([], Validators.required),
  });

  ngOnInit(): void {
    this.loadRoles();
    this.loadPermissions();
  }

  /** Cargar lista de roles */
  loadRoles(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.rolesService.getRoles().subscribe({
      next: (roles: Role[]) => {
        this.roles.set(roles);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loadError.set(this.notificationService.httpErrorMessage(error, 'settings.roles.errors.load_roles'));
        this.loading.set(false);
      },
    });
  }

  /**
   * Load the permission catalogue.
   *
   * The grouping and the names come from the server as keys. This used to derive them by
   * splitting the slug on its colon and capitalising the first letter, which is how the screen
   * that governs access to the ledger came to show a group called "Journal_entries" with a
   * checkbox called "view".
   */
  private loadPermissions(): void {
    this.rolesService.getAvailablePermissions().subscribe({
      next: (groups) => this.permissionGroups.set(groups),
      error: () => this.notificationService.showError('settings.roles.errors.load_permissions'),
    });
  }

  /** Abre modal para crear o editar */
  openRoleModal(roleToEdit?: Role): void {
    // A system role is fixed; the button says so and stays focusable, so the click lands here.
    if (roleToEdit?.isSystemRole) return;
    this.editingRole.set(roleToEdit ?? null);
    this.roleForm.reset();
    this.permissionsFormArray.clear();

    if (roleToEdit) {
      this.roleForm.patchValue({
        name: roleToEdit.name,
        description: roleToEdit.description,
      });
      roleToEdit.permissions.forEach((p) =>
        this.permissionsFormArray.push(new FormControl(p)),
      );
    }

    this.isModalOpen.set(true);
  }

  /** Clona un rol existente */
  cloneRole(role: Role): void {
    this.rolesService.cloneRole(role.id).subscribe({
      next: () => {
        this.notificationService.showSuccess('settings.roles.role_name_cloned_successfully', { name: role.name });
        this.loadRoles();
      },
      error: (err: unknown) =>
        this.notificationService.showHttpError(err, 'errors.clone_role'),
    });
  }

  closeModal(): void {
    this.isModalOpen.set(false);
  }

  /** Getter para el form array de permisos */
  get permissionsFormArray(): FormArray {
    return this.roleForm.get('permissions') as FormArray;
  }

  /** Agregar o quitar permisos */
  onPermissionChange(event: Event, permission: string): void {
    const isChecked = (event.target as HTMLInputElement).checked;
    if (isChecked) {
      this.permissionsFormArray.push(new FormControl(permission));
    } else {
      const index = this.permissionsFormArray.controls.findIndex(
        (ctrl) => ctrl.value === permission,
      );
      if (index !== -1) this.permissionsFormArray.removeAt(index);
    }
  }

  /** Verifica si un permiso ya está seleccionado */
  isPermissionSelected(permission: string): boolean {
    return this.permissionsFormArray.value.includes(permission);
  }

  /** Guardar creación o edición */
  saveRole(): void {
    if (this.roleForm.invalid) return;

    const roleData: CreateRoleDto | UpdateRoleDto = this.roleForm.value;
    const editing = this.editingRole();

    const request = editing
      ? this.rolesService.updateRole(editing.id, roleData)
      : this.rolesService.createRole(roleData as CreateRoleDto);

    request.subscribe({
      next: () => {
        this.notificationService.showSuccess(editing ? 'settings.roles.role_updated_successfully' : 'settings.roles.role_created_successfully');
        this.loadRoles();
        this.closeModal();
      },
      error: (err: unknown) =>
        this.notificationService.showHttpError(err, 'errors.save_role'),
    });
  }

  /** Eliminar un rol */
  async deleteRole(role: Role): Promise<void> {
    if (role.isSystemRole) return;
    const confirmed = await this.dialog.confirm({
      title: 'dialog.delete_role.title',
      message: 'dialog.delete_role.message',
      messageParams: { name: role.name },
      confirmText: 'common.delete',
      variant: 'danger',
    });
    if (!confirmed) return;

    this.rolesService.deleteRole(role.id).subscribe({
      next: () => {
        this.notificationService.showSuccess('settings.roles.role_deleted_successfully');
        this.loadRoles();
      },
      // The server's reason — a role still assigned to people says so, and to whom.
      error: (err: unknown) => this.notificationService.showHttpError(err, 'errors.delete_role'),
    });
  }
}