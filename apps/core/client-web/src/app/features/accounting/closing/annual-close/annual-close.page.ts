import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, CheckCircle, Circle, AlertCircle } from 'lucide-angular';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

/** One step of the year-end close. Every field the reader sees is a catalogue key. */
export interface AnnualClosingTask {
  id: string;
  descriptionKey: string;
  params?: Record<string, unknown>;
  isCompleted: boolean;
  noteKey?: string;
  resolutionLink?: string;
}

/**
 * The year-end close.
 *
 * ## Why this page shows nothing
 *
 * It used to show five hardcoded tasks in English — "Year-End Inventory Count Adjustment", "Close
 * Fiscal Year 2025" — attributed to invented people, under a heading that named 2025 whatever the
 * year, with a progress bar fixed at 40 %. In a closing screen a bar that does not move is worse
 * than no bar: it is read as a measurement.
 *
 * The month-end equivalent is now computed by `ClosingChecklistService` from the tenant's own
 * data. The annual close needs the same treatment against a fiscal year — `POST
 * /accounting/year-end-close` exists to RUN it, nothing reports on it. Until that exists the list
 * is empty and says so; the presentation is finished and takes the response unchanged.
 */
@Component({
  selector: 'app-annual-close-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, RouterLink, TranslateModule],
  templateUrl: './annual-close.page.html',
  styleUrls: ['./annual-close.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnnualClosePage {
  protected readonly CompletedIcon = CheckCircle;
  protected readonly PendingIcon = Circle;
  protected readonly ErrorIcon = AlertCircle;

  readonly tasks = signal<AnnualClosingTask[]>([]);
  readonly isEmpty = computed(() => this.tasks().length === 0);

  readonly progress = computed(() => {
    const tasks = this.tasks();
    if (tasks.length === 0) return 0;
    return Math.round((tasks.filter((task) => task.isCompleted).length / tasks.length) * 100);
  });

  iconFor(task: AnnualClosingTask) {
    if (task.isCompleted) return this.CompletedIcon;
    return task.noteKey ? this.PendingIcon : this.ErrorIcon;
  }

  statusClass(task: AnnualClosingTask): string {
    if (task.isCompleted) return 'completed';
    return task.noteKey ? 'pending' : 'error';
  }
}
