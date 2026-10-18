import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { DialogService } from './dialog.service';
import { NotificationService } from './notification';

/** What the server says still uses a record: catalogue keys and counts. */
export interface RecordDependents {
  dependents: { label: string; count: number }[];
}

export interface SafeDeleteOptions {
  /** The record's own name, shown in every message. */
  name: string;
  /** Asks the server what still uses the record. */
  check: () => Observable<RecordDependents>;
  remove: () => Observable<unknown>;
  /** Present when the record can be deactivated instead; absent hides that offer. */
  deactivate?: () => Observable<unknown>;
  keys: {
    /** Confirmation for a record nothing uses. */
    confirmTitle: string;
    confirmMessage: string;
    deleted: string;
    deleteFailed: string;
    /** Shown when documents use the record; receives `{{name}}` and `{{summary}}`. */
    blockedTitle: string;
    blockedMessage: string;
    deactivated?: string;
  };
}

export type SafeDeleteOutcome = 'deleted' | 'deactivated' | 'cancelled';

/**
 * Deleting a master record, asked the honest way (QA A-08).
 *
 * The lists confirmed a delete, sent it, and on refusal showed «No se pudo eliminar el cliente» —
 * the server had said exactly why (2 invoices, 1 receipt, 1 quote) and the screen dropped it. Now
 * the dependents are asked for FIRST: a record nothing uses gets the ordinary confirmation; one
 * that documents name is never offered a delete that will fail, but is told what uses it and, where
 * the record has an active state, offered to deactivate it instead.
 */
@Injectable({ providedIn: 'root' })
export class SafeDeleteService {
  private readonly dialog = inject(DialogService);
  private readonly notifications = inject(NotificationService);
  private readonly translate = inject(TranslateService);

  async run(options: SafeDeleteOptions): Promise<SafeDeleteOutcome> {
    const { keys, name } = options;

    let usage: RecordDependents;
    try {
      usage = await firstValueFrom(options.check());
    } catch (error) {
      // Not knowing is not a reason to guess: the delete itself still refuses with the detail.
      usage = { dependents: [] };
    }

    if (usage.dependents.length > 0) {
      const summary = this.summary(usage.dependents);
      if (!options.deactivate) {
        // Nothing to decide: an alert, not a confirmation with a «Cancel» that calls off nothing.
        await this.dialog.alert({
          title: keys.blockedTitle,
          message: this.translate.instant(keys.blockedMessage, { name, summary }),
          variant: 'warning',
        });
        return 'cancelled';
      }
      const deactivate = await this.dialog.confirm({
        title: keys.blockedTitle,
        message: keys.blockedMessage,
        messageParams: { name, summary },
        confirmText: 'common.deactivate',
        variant: 'warning',
      });
      if (!deactivate) return 'cancelled';
      try {
        await firstValueFrom(options.deactivate());
        this.notifications.showSuccess(keys.deactivated ?? 'common.record_deactivated', { name });
        return 'deactivated';
      } catch (error) {
        this.notifications.showHttpError(error, keys.deleteFailed, { name });
        return 'cancelled';
      }
    }

    const confirmed = await this.dialog.confirm({
      title: keys.confirmTitle,
      message: keys.confirmMessage,
      messageParams: { name },
      confirmText: 'common.delete',
      variant: 'danger',
    });
    if (!confirmed) return 'cancelled';
    try {
      await firstValueFrom(options.remove());
      this.notifications.showSuccess(keys.deleted, { name });
      return 'deleted';
    } catch (error) {
      // The server's own sentence — it names what blocks the delete — not a generic failure.
      this.notifications.showHttpError(error, keys.deleteFailed, { name });
      return 'cancelled';
    }
  }

  /** «2 facturas, 1 cobro y 1 cotización», in the reader's language and list style. */
  private summary(dependents: { label: string; count: number }[]): string {
    // «1 factura», not «1 facturas»: the singular lives beside each plural label as `<label>_one`.
    const parts = dependents.map((d) => {
      const one = `${d.label}_one`;
      const word = d.count === 1 && this.translate.instant(one) !== one ? this.translate.instant(one) : this.translate.instant(d.label);
      return `${d.count} ${word}`;
    });
    const lang = this.translate.currentLang || this.translate.getDefaultLang() || 'es';
    try {
      return new Intl.ListFormat(lang, { style: 'long', type: 'conjunction' }).format(parts);
    } catch {
      return parts.join(', ');
    }
  }
}
