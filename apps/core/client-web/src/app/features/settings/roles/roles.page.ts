import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, Validators, FormArray, FormControl } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
// ✅ CORREGIDO: Se importa el ícono 'X' que se usará como CloseIcon.
import { LucideAngularModule, Plus, Edit, Trash, Copy, X } from 'lucide-angular';

import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  RolesService,
  Role,
  CreateRoleDto,
  UpdateRoleDto,
  PermissionGroupContract,
} from '../../../core/api/roles.service';
import { NotificationService } from '../../../core/services/notification';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';



@Component({
  selector: 'app-roles-management-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    LucideAngularModule,
    HasPermissionDirective,
    TranslateModule,
  ],
  templateUrl: './roles.page.html',
  styleUrls: ['./roles.page.scss'],
})
export class RolesManagementPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly rolesService = inject(RolesService);
  private readonly notificationService = inject(NotificationService);
  private readonly translate = inject(TranslateService);

  /** Iconos */
  protected readonly PlusIcon = Plus;
  protected readonly EditIcon = Edit;
  protected readonly TrashIcon = Trash;
  protected readonly CloneIcon = Copy;
  protected readonly CloseIcon = X; // ✅ CORREGIDO: Se define la propiedad para el ícono de cerrar.

  /** Estado */
  readonly roles = signal<Role[]>([]);
  readonly permissionGroups = signal<PermissionGroupContract[]>([]);
  readonly isModalOpen = signal(false);
  readonly editingRole = signal<Role | null>(null);

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
  private loadRoles(): void {
    this.rolesService.getRoles().subscribe({
      next: (roles: Role[]) => this.roles.set(roles),
      error: () =>
        this.notificationService.showError('SETTINGS.ROLES.ERRORS.LOAD_ROLES'),
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
      error: () => this.notificationService.showError('SETTINGS.ROLES.ERRORS.LOAD_PERMISSIONS'),
    });
  }

  /** Abre modal para crear o editar */
  openRoleModal(roleToEdit?: Role): void {
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
        this.notificationService.showSuccess('SETTINGS.ROLES.ROL_CLONADO_EXITOSAMENTE', { name: role.name });
        this.loadRoles();
      },
      error: (err: unknown) =>
        this.notificationService.showError(
          (err as any)?.error?.message || 'Error al clonar el rol.',
        ),
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
        this.notificationService.showSuccess(editing ? 'SETTINGS.ROLES.ROL_ACTUALIZADO_EXITOSAMENTE' : 'SETTINGS.ROLES.ROL_CREADO_EXITOSAMENTE');
        this.loadRoles();
        this.closeModal();
      },
      error: (err: unknown) =>
        this.notificationService.showError(
          (err as any)?.error?.message || 'Error al guardar el rol.',
        ),
    });
  }

  /** Eliminar un rol */
  deleteRole(role: Role): void {
    if (!confirm(`¿Seguro que quieres eliminar el rol "${role.name}"?`)) return;

    this.rolesService.deleteRole(role.id).subscribe({
      next: () => {
        this.notificationService.showSuccess('SETTINGS.ROLES.ROL_ELIMINADO_EXITOSAMENTE');
        this.loadRoles();
      },
      error: (err: unknown) =>
        this.notificationService.showError(
          (err as any)?.error?.message || 'Error al eliminar el rol.',
        ),
    });
  }
}