import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Check, X, AlertTriangle } from 'lucide-angular';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import { TransitionPreview, LedgerEffect, StockEffect, SequenceEffect } from './transition-preview.model';

/**
 * What a business transition would do, shown before it does it.
 *
 * ## Why the ledger entry is the centrepiece
 *
 * The person pressing "Emitir" is accountable for the numbers. Showing the debits and credits that
 * the document will post is what lets them accept responsibility for it — and it teaches the
 * accounting of their own business while they work, which no amount of documentation does.
 *
 * ## Why a failed precondition carries a link
 *
 * "The period is closed" without a way to open it is a more detailed way of saying no. Every
 * blocking condition that has an unambiguous destination offers it; the ones that do not say so by
 * offering nothing, rather than by guessing.
 */
@Component({
  selector: 'app-transition-preview',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, LucideAngularModule, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transition-preview.component.html',
  styleUrls: ['./transition-preview.component.scss'],
})
export class TransitionPreviewComponent {
  readonly preview = input.required<TransitionPreview>();
  readonly busy = input(false);
  readonly confirmLabelKey = input('COMMON.CONFIRM');

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  protected readonly PassIcon = Check;
  protected readonly FailIcon = X;
  protected readonly WarnIcon = AlertTriangle;

  protected readonly failed = computed(() =>
    this.preview().preconditions.filter((p) => p.status === 'failed'),
  );
  protected readonly passed = computed(() =>
    this.preview().preconditions.filter((p) => p.status === 'passed'),
  );

  protected readonly ledgers = computed(
    () => this.preview().effects.filter((e): e is LedgerEffect => e.kind === 'ledger'),
  );
  protected readonly stock = computed(
    () => this.preview().effects.filter((e): e is StockEffect => e.kind === 'stock'),
  );
  protected readonly sequences = computed(
    () => this.preview().effects.filter((e): e is SequenceEffect => e.kind === 'sequence'),
  );

  /**
   * An entry whose debits and credits differ is a bug in the posting, and the user is the last
   * person who should discover it after the fact. Shown, not hidden.
   */
  protected readonly unbalanced = computed(() =>
    this.ledgers().filter((l) => Math.abs(l.totalDebit - l.totalCredit) >= 0.005),
  );
}
