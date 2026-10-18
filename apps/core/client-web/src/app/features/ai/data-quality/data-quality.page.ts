import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { LucideAngularModule, ScanSearch } from 'lucide-angular';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { composeKey } from '@virteex/shared/types';
import { NotificationService } from '../../../core/services/notification';
import { ListShellComponent } from '../../../shared/components/gestures';
import { DataQualityApiService, DuplicateEntityType, DuplicateList, DuplicateStatus, DuplicateSuggestion } from './data-quality.service';

/**
 * Master data › Data quality: customers, suppliers and products that are probably entered twice.
 *
 * Each pair says why it was proposed (the same tax id, e-mail, phone, barcode or code, or a very
 * similar name) and is decided by a person: the same record, or two different ones. A decision is
 * kept, so a pair once dismissed is never proposed again. Nothing is merged from here — the two
 * records are opened side by side and merged, if at all, by whoever owns them.
 *
 * Only the record types the person may read appear; deciding needs their edit permission.
 */
@Component({
  selector: 'app-data-quality-page',
  standalone: true,
  imports: [RouterLink, TranslatePipe, LucideAngularModule, ...FORMAT_PIPES, ListShellComponent],
  templateUrl: './data-quality.page.html',
  styleUrl: './data-quality.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataQualityPage implements OnInit {
  private readonly api = inject(DataQualityApiService);
  private readonly notifications = inject(NotificationService);

  protected readonly ScanIcon = ScanSearch;
  protected readonly k = composeKey;
  protected readonly statuses: DuplicateStatus[] = ['OPEN', 'SAME', 'NOT_DUPLICATE', 'STALE'];

  readonly data = signal<DuplicateList | null>(null);
  readonly loading = signal(true);
  readonly scanning = signal(false);
  readonly type = signal<DuplicateEntityType | null>(null);
  readonly status = signal<DuplicateStatus>('OPEN');

  /** The types this person may read, as the server counted them. */
  readonly types = computed(() => Object.keys(this.data()?.counts ?? {}) as DuplicateEntityType[]);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.list({ type: this.type(), status: this.status(), limit: 100 }).subscribe({
      next: (data) => {
        this.data.set(data);
        this.loading.set(false);
      },
      error: (error) => {
        this.loading.set(false);
        this.notifications.showHttpError(error, 'ai.data_quality.load_failed');
      },
    });
  }

  setType(type: DuplicateEntityType | null): void {
    this.type.set(type);
    this.load();
  }

  setStatus(status: DuplicateStatus): void {
    this.status.set(status);
    this.load();
  }

  scan(): void {
    this.scanning.set(true);
    this.api.scan().subscribe({
      next: (summary) => {
        this.scanning.set(false);
        const added = Object.values(summary).reduce((sum, row) => sum + row.added, 0);
        this.notifications.showSuccess('ai.data_quality.scanned', { count: added });
        this.load();
      },
      error: (error) => {
        this.scanning.set(false);
        this.notifications.showHttpError(error, 'ai.data_quality.scan_failed');
      },
    });
  }

  decide(item: DuplicateSuggestion, decision: 'SAME' | 'NOT_DUPLICATE' | 'OPEN'): void {
    this.api.decide(item.id, decision).subscribe({
      next: () => this.load(),
      error: (error) => this.notifications.showHttpError(error, 'ai.data_quality.decide_failed'),
    });
  }
}
