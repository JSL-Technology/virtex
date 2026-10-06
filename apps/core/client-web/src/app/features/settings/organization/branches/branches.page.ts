import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { LucideAngularModule, MapPin, Plus } from 'lucide-angular';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { Branch, BranchesService, SaveBranch } from '../../../../core/tenancy/branches.service';
import { NotificationService } from '../../../../core/services/notification';
import { DialogService } from '../../../../core/services/dialog.service';
import { HasPermissionDirective } from '../../../../shared/directives/has-permission.directive';
import { VxDialogComponent } from '../../../../shared/components/dialog';
import { VxBadgeComponent } from '../../../../shared/components/badge';
import { VxSpinnerComponent, VxEmptyStateComponent } from '../../../../shared/components/feedback';
import { Warehouse, WarehousesService } from '../../../masters/data/warehouses.service';

/** Letters, digits and dashes, starting with a letter or digit — the same rule the server applies. */
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const FISCAL_CODE_PATTERN = /^[0-9A-Za-z]*$/;

/**
 * Settings › Branches: the places this company operates from.
 *
 * ## Branch, not subsidiary
 *
 * A branch is the SAME legal entity — same tax id, same books — in another place: a store, a
 * warehouse with a counter, a regional office. A subsidiary is ANOTHER legal entity the company
 * owns, with its own books, and lives in «Company structure». The screen that used to be called
 * «Sucursales» listed subsidiaries, so a company with three stores had no way to say so.
 *
 * What a branch carries is what documents need from it: its address (printed on what it issues),
 * the fiscal establishment and emission-point codes some tax authorities number documents by
 * (Ecuador's `001-001`), and the warehouse its sales take stock from. The first branch is the
 * headquarters, there is always exactly one, and it can be moved but not removed.
 *
 * A branch that has issued anything cannot be deleted — the documents would lose where they came
 * from — so the screen offers deactivation, which keeps history and stops new documents.
 */
@Component({
  selector: 'app-branches-settings',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ReactiveFormsModule,
    TranslateModule,
    LucideAngularModule,
    HasPermissionDirective,
    VxDialogComponent,
    VxBadgeComponent,
    VxSpinnerComponent,
    VxEmptyStateComponent,
    ...VX_FORM_A11Y,
  ],
  templateUrl: './branches.page.html',
  styleUrls: ['./branches.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BranchesSettingsPage implements OnInit {
  private readonly api = inject(BranchesService);
  private readonly warehousesApi = inject(WarehousesService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly MapPinIcon = MapPin;
  protected readonly PlusIcon = Plus;

  readonly branches = signal<Branch[]>([]);
  readonly warehouses = signal<Warehouse[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  /** The branch being edited; `null` while creating; `undefined` while the form is closed. */
  readonly editing = signal<Branch | null | undefined>(undefined);
  readonly showInactive = signal(false);

  readonly visible = computed(() =>
    this.showInactive() ? this.branches() : this.branches().filter((branch) => branch.isActive),
  );
  readonly inactiveCount = computed(() => this.branches().filter((branch) => !branch.isActive).length);

  readonly form = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.maxLength(20), Validators.pattern(CODE_PATTERN)]],
    name: ['', [Validators.required, Validators.maxLength(120)]],
    address: ['', Validators.maxLength(255)],
    city: ['', Validators.maxLength(120)],
    state: ['', Validators.maxLength(120)],
    postalCode: ['', Validators.maxLength(20)],
    phone: ['', Validators.maxLength(40)],
    fiscalEstablishmentCode: ['', [Validators.maxLength(10), Validators.pattern(FISCAL_CODE_PATTERN)]],
    emissionPointCode: ['', [Validators.maxLength(10), Validators.pattern(FISCAL_CODE_PATTERN)]],
    defaultWarehouseId: [''],
    isHeadquarters: [false],
  });

  ngOnInit(): void {
    this.load();
    this.warehousesApi
      .list()
      .pipe(
        catchError(() => of([] as Warehouse[])),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((rows) => this.warehouses.set(rows.filter((w) => w.isActive)));

    // `#settings/branches/new`: open the form on arrival, then leave the fragment at the section.
    if (this.router.url.split('#')[1] === 'settings/branches/new') {
      this.openCreate();
      void this.router.navigate([], { fragment: 'settings/branches', replaceUrl: true });
    }
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.api
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.branches.set(rows);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loadError.set(this.notifications.httpErrorMessage(error, 'branches.settings.load_failed'));
          this.loading.set(false);
        },
      });
  }

  openCreate(): void {
    this.form.reset({ isHeadquarters: this.branches().length === 0 });
    this.editing.set(null);
    this.lockHeadquarters();
  }

  openEdit(branch: Branch): void {
    this.form.reset({
      code: branch.code,
      name: branch.name,
      address: branch.address ?? '',
      city: branch.city ?? '',
      state: branch.state ?? '',
      postalCode: branch.postalCode ?? '',
      phone: branch.phone ?? '',
      fiscalEstablishmentCode: branch.fiscalEstablishmentCode ?? '',
      emissionPointCode: branch.emissionPointCode ?? '',
      defaultWarehouseId: branch.defaultWarehouseId ?? '',
      isHeadquarters: branch.isHeadquarters,
    });
    this.editing.set(branch);
    this.lockHeadquarters();
  }

  closeForm(): void {
    this.editing.set(undefined);
  }

  /**
   * The headquarters flag cannot be cleared — it moves by marking ANOTHER branch — and the first
   * branch is the headquarters whatever the box says. Both cases show the box checked and locked.
   */
  private lockHeadquarters(): void {
    const locked = Boolean(this.editing()?.isHeadquarters) || this.branches().length === 0;
    const control = this.form.controls.isHeadquarters;
    if (locked) {
      control.setValue(true);
      control.disable();
    } else {
      control.enable();
    }
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const body: SaveBranch & { code: string; name: string } = {
      code: value.code.trim().toUpperCase(),
      name: value.name.trim(),
      address: value.address.trim() || null,
      city: value.city.trim() || null,
      state: value.state.trim() || null,
      postalCode: value.postalCode.trim() || null,
      phone: value.phone.trim() || null,
      fiscalEstablishmentCode: value.fiscalEstablishmentCode.trim() || null,
      emissionPointCode: value.emissionPointCode.trim() || null,
      defaultWarehouseId: value.defaultWarehouseId || null,
    };
    // Only sent when it changes something: «false» on the headquarters is a refusal, not a no-op.
    if (value.isHeadquarters && !this.editing()?.isHeadquarters) body.isHeadquarters = true;

    const editing = this.editing();
    const request = editing ? this.api.update(editing.id, body) : this.api.create(body);
    this.saving.set(true);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        this.notifications.showSuccess(editing ? 'branches.settings.updated' : 'branches.settings.created');
        this.closeForm();
        // Reloaded rather than patched: marking a headquarters changes another row too.
        this.load();
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.notifications.showHttpError(error, 'branches.settings.save_failed');
      },
    });
  }

  async setActive(branch: Branch, active: boolean): Promise<void> {
    if (!active) {
      const confirmed = await this.dialog.confirm({
        title: 'branches.settings.deactivate_title',
        message: 'branches.settings.deactivate_message',
        messageParams: { name: branch.name },
        confirmText: 'branches.settings.deactivate',
        variant: 'warning',
      });
      if (!confirmed) return;
    }
    this.api
      .update(branch.id, { isActive: active })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (saved) => {
          this.branches.update((rows) => rows.map((row) => (row.id === saved.id ? { ...row, ...saved } : row)));
          this.notifications.showSuccess(active ? 'branches.settings.activated' : 'branches.settings.deactivated');
        },
        error: (error: unknown) => this.notifications.showHttpError(error, 'branches.settings.save_failed'),
      });
  }

  async remove(branch: Branch): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'branches.settings.delete_title',
      message: 'branches.settings.delete_message',
      messageParams: { name: branch.name },
      confirmText: 'branches.settings.delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    this.api
      .remove(branch.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.branches.update((rows) => rows.filter((row) => row.id !== branch.id));
          this.notifications.showSuccess('branches.settings.deleted');
        },
        // `in_use` explains that it issued documents and that deactivating is the way.
        error: (error: unknown) => this.notifications.showHttpError(error, 'branches.settings.delete_failed'),
      });
  }

  protected warehouseName(id: string | null): string | null {
    if (!id) return null;
    return this.warehouses().find((w) => w.id === id)?.name ?? null;
  }

  protected location(branch: Branch): string {
    return [branch.address, branch.city, branch.state].filter(Boolean).join(', ');
  }

  protected fieldInvalid(name: keyof typeof this.form.controls): boolean {
    const control = this.form.controls[name];
    return control.invalid && (control.touched || control.dirty);
  }
}
