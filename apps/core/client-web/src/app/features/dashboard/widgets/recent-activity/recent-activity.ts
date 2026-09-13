import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { catchError, of } from 'rxjs';
import { ActivityItem, OverviewService } from '../../../overview/overview.service';
import { FormatService } from '../../../../core/i18n/format.service';

/**
 * What has happened in this tenant lately.
 *
 * ## What this was
 *
 * Four hardcoded lines — "Factura #005 fue enviada a Proyectos Globales S.A., hace 5 minutos" —
 * which stayed five minutes old for ever, in Spanish, for every customer of the product. The
 * relative times were strings, not times, so they never advanced.
 *
 * Now it is the audit trail, through the same endpoint the workspace home page reads, filtered
 * server-side to the document types this seat may see.
 */
@Component({
  selector: 'app-recent-activity',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule],
  templateUrl: './recent-activity.html',
  styleUrls: ['./recent-activity.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecentActivity {
  private readonly overview = inject(OverviewService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);

  readonly activities = toSignal(
    this.overview.getRecentActivity(6).pipe(catchError(() => of([] as ActivityItem[]))),
    { initialValue: [] as ActivityItem[] },
  );

  /** The sentence, in the reader's language. */
  text(item: ActivityItem): string {
    return this.translate.instant(item.titleKey, {
      reference: item.reference ?? this.translate.instant('OVERVIEW.ACTIVITY.NO_REFERENCE'),
    });
  }

  /** A real elapsed time, recomputed on every render rather than frozen at "hace 5 minutos". */
  when(item: ActivityItem): string {
    return this.format.relativeTime(item.timestamp);
  }
}
