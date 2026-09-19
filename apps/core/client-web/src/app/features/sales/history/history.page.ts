import { Component, ChangeDetectionStrategy, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle, FileDown } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';

import { ListShellComponent } from '../../../shared/components/gestures';
import { PosSale, PosService } from '../pos/pos.service';
import { ErrorHandlerService } from '../../../core/services/error-handler.service';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';

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
  imports: [LucideAngularModule, TranslateModule, ...FORMAT_PIPES, RouterLink, ListShellComponent, VxBadgeComponent],
  templateUrl: './history.page.html',
  styleUrls: ['./history.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryPage implements OnInit {
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly FileDownIcon = FileDown;

  private readonly pos = inject(PosService);
  private readonly errors = inject(ErrorHandlerService);

  readonly sales = signal<PosSale[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.pos.listSales().subscribe({
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
