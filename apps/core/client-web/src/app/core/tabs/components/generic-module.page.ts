import { Component, ChangeDetectionStrategy, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LucideAngularModule, SearchX } from 'lucide-angular';
import { RouterLink } from '@angular/router';
import { TAB_CONTEXT } from '../tab-context';

/**
 * What a tab shows for an address no module declares.
 *
 * Every menu entry is declared in a module manifest with its page, so the only way here is an
 * address that does not exist — typed, mistyped, or kept from an older version. It used to say
 * «este módulo está en construcción», which told someone who typed `/inventory/kardex` that the
 * Kárdex was unfinished when it exists at another address (QA K01). It now says the page does not
 * exist and offers the way back.
 */
@Component({
  selector: 'app-generic-module-page',
  standalone: true,
  imports: [TranslateModule, CommonModule, LucideAngularModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="generic-page">
      <div class="generic-card">
        <div class="generic-icon">
          <lucide-icon [img]="NotFoundIcon" size="34" aria-hidden="true"></lucide-icon>
        </div>
        <h1 class="generic-title">{{ 'tabs.page_not_found' | translate }}</h1>
        <p class="generic-subtitle">{{ 'tabs.page_not_found_hint' | translate }}</p>
        <code class="generic-route">{{ route() }}</code>
        <div class="generic-actions">
          <a class="primary-button" routerLink="/">{{ 'tabs.go_home' | translate }}</a>
        </div>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; height: 100%; width: 100%; }

    .generic-page {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      width: 100%;
      padding: 2rem;
      background:
        radial-gradient(120% 120% at 50% 0%, var(--bg-tertiary) 0%, var(--bg-primary) 60%);
    }

    .generic-card {
      max-width: 460px;
      text-align: center;
      padding: 2.5rem 2rem;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-md);
    }

    .generic-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 76px;
      height: 76px;
      margin-bottom: 1.25rem;
      border-radius: 50%;
      color: var(--accent-primary);
      background: var(--primary-light);
    }

    .generic-title {
      margin: 0 0 0.5rem;
      font-size: 1.4rem;
      font-weight: 700;
      color: var(--text-primary);
      letter-spacing: -0.01em;
    }

    .generic-subtitle {
      margin: 0 0 1.5rem;
      font-size: 0.92rem;
      line-height: 1.55;
      color: var(--text-secondary);
    }

    .generic-actions {
      margin-top: 1.5rem;
    }

    .generic-route {
      display: inline-block;
      padding: 0.4rem 0.75rem;
      font-family: 'Consolas', 'SFMono-Regular', monospace;
      font-size: 0.82rem;
      color: var(--text-secondary);
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
    }
  `],
})
export class GenericModulePage {
  private ctx = inject(TAB_CONTEXT, { optional: true });
  private translate = inject(TranslateService);

  readonly title = computed(() => this.ctx?.title || this.prettify(this.ctx?.route));
  readonly route = computed(() => this.ctx?.route || '/');

  protected readonly NotFoundIcon = SearchX;

  private prettify(route?: string): string {
    const last = route?.split('/').filter(Boolean).pop();
    if (!last) return this.translate.instant('tabs.module');
    return last
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
