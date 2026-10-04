import { FormsModule } from '@angular/forms';
import { VxBranchLabelComponent, VxBranchPickerComponent } from '../../../shared/components/branch-picker';
import { BranchesService } from '../../../core/tenancy/branches.service';
import { Component, ChangeDetectionStrategy, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle, FileDown } from 'lucide-angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';

import { ListShellComponent } from '../../../shared/components/gestures';
import { PosSale, PosService } from '../pos/pos.service';
import { ErrorHandlerService } from '../../../core/services/error-handler.service';
import { DatasetExportService } from '../../../core/export/dataset-export';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';
import { VxAmountComponent } from '../../../shared/components/amount';
import { CanOpenDirective } from '../../../core/modules/can-open.directive';
import { VX_SORT, sortable } from '../../../shared/components/sort';

/**
 * Till sales, as they were actually rung up.
 *
 * ## What this replaces
 *
 * Four invented sales held in a signal — V-2025-001 to V-2025-004, dated July 2025, to "Cliente
 * Ejemplo S.R.L." and "Ana Pérez" — with no request made. They were still there after the tenant
 * recorded a real sale, so the screen named "Sales history" showed four sales that never happened
 * and omitted the one that did. For a screen whose whole purpose is the record of what was sold,
 * that is the worst possible failure.
 *
 * `GET /pos/sales` answers this, tenant-scoped, and is where the till writes.
 */
@Component({
  selector: 'app-history-page',
  standalone: true,
  imports: [...VX_SORT, CanOpenDirective, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, RouterLink, ListShellComponent, VxBadgeComponent, VxAmountComponent, FormsModule, VxBranchPickerComponent, VxBranchLabelComponent],
  templateUrl: './history.page.html',
  styleUrls: ['./history.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryPage implements OnInit {
  private readonly translate = inject(TranslateService);
  /** Sortable by its headers (QA B-01). */
  readonly table = sortable(() => this.sales(), { status: (sale) => this.translate.instant('pos.sale_status.' + sale.status) });
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly FileDownIcon = FileDown;

  private readonly pos = inject(PosService);
  private readonly errors = inject(ErrorHandlerService);
  /** «Exportar» — every sale, from the server (QA A-13). */
  protected readonly exports = inject(DatasetExportService);

  readonly sales = signal<PosSale[]>([]);
  /** Empty: every branch the person may see. */
  readonly branchFilter = signal<string | null>(null);
  protected readonly branches = inject(BranchesService);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  setBranch(branchId: string | null): void {
    this.branchFilter.set(branchId);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.pos.listSales(undefined, this.branchFilter()).subscribe({
      next: (list) => {
        this.sales.set(list ?? []);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.errors.keyFor(err));
        this.loading.set(false);
      },
    });
  }

  /** The till records a status of its own; unknown values still get a neutral chip. */
  statusTone(status: string): VxTone {
    switch ((status ?? '').toUpperCase()) {
      case 'PAID':
        return 'ok';
      case 'PENDING':
        return 'warning';
      case 'VOID':
      case 'CANCELLED':
        return 'danger';
      default:
        //  Un estado que este cliente no conoce se pinta como lo que es —desconocido— en vez de
        //  quedarse sin insignia, que es como se veía antes: igual que si no tuviera estado.
        return 'neutral';
    }
  }

  isCancelled(status: string): boolean {
    return ['VOID', 'CANCELLED'].includes((status ?? '').toUpperCase());
  }
}
