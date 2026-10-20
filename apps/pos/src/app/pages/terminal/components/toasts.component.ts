import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LucideAngularModule, CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-angular';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { ToastService } from '../../../core/toast.service';

@Component({
  selector: 'pos-toasts',
  standalone: true,
  imports: [LucideAngularModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toasts" aria-live="polite" aria-atomic="false">
      @for (toast of toasts.toasts(); track toast.id) {
        <div class="toast toast--{{ toast.kind }}" [attr.role]="toast.kind === 'error' ? 'alert' : 'status'">
          <lucide-icon [img]="icons[toast.kind]" size="18" aria-hidden="true" />
          <span>{{ toast.key | translate: toast.params }}</span>
          <button type="button" class="icon-btn" (click)="toasts.dismiss(toast.id)" [attr.aria-label]="'pos.close' | translate">
            <lucide-icon [img]="XIcon" size="14" aria-hidden="true" />
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .toasts { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 80; display: flex; flex-direction: column; gap: 8px; width: min(520px, calc(100vw - 32px)); pointer-events: none; }
      .toast { pointer-events: auto; display: flex; align-items: center; gap: 10px; padding: 10px 12px 10px 14px; border-radius: 12px; background: var(--pos-surface-2); border: 1px solid var(--pos-border); box-shadow: var(--pos-shadow-lg); font-size: 0.92rem; animation: in 0.16s ease-out; }
      .toast span { flex: 1; }
      .toast--success lucide-icon { color: var(--pos-success); }
      .toast--error { border-color: color-mix(in srgb, var(--pos-danger) 55%, var(--pos-border)); }
      .toast--error lucide-icon { color: var(--pos-danger); }
      .toast--warning lucide-icon { color: var(--pos-warning); }
      .toast--info lucide-icon { color: var(--pos-primary); }
      @keyframes in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    `,
  ],
})
export class ToastsComponent {
  protected readonly toasts = inject(ToastService);
  protected readonly icons = { success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info };
  protected readonly XIcon = X;
}
