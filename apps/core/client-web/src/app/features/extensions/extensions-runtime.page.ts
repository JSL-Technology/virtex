import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Puzzle, RefreshCw } from 'lucide-angular';
import { ExtensionsService, RuntimeExtension } from './extensions.service';
import { ExtensionHostComponent } from './extension-host.component';

/**
 * Where installed UI extensions actually run in the app. It asks the API which extensions this
 * tenant has enabled with a UI, then mounts each one in its own sandboxed {@link ExtensionHostComponent}.
 * This is the client-side runtime — the counterpart to the server-side isolate.
 */
@Component({
  selector: 'app-extensions-runtime-page',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslateModule, LucideAngularModule, ExtensionHostComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="run">
      <header class="run__header">
        <div class="run__title">
          <lucide-icon [img]="PuzzleIcon" [size]="22"></lucide-icon>
          <h1>{{ 'PAGE_TITLES.EXTENSIONS_RUNTIME' | translate }}</h1>
        </div>
        <button type="button" class="run__btn" (click)="refresh()" [disabled]="loading()">
          <lucide-icon [img]="RefreshIcon" [size]="16"></lucide-icon>
          <span>Refresh</span>
        </button>
      </header>

      @if (loading()) {
        <p class="run__muted">Loading extensions…</p>
      } @else if (extensions().length === 0) {
        <div class="run__empty">
          <p>No UI extensions are enabled for this tenant.</p>
          <a routerLink="/masters/extensions">Go to the extensions manager →</a>
        </div>
      } @else {
        <div class="run__grid">
          @for (ext of extensions(); track ext.name) {
            <section class="run__card">
              <div class="run__card-head">
                <span class="run__name">{{ ext.name }}</span>
                <span class="run__ver">v{{ ext.version }}</span>
              </div>
              <app-extension-host [extension]="ext" [context]="baseContext" />
            </section>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      .run {
        padding: var(--space-6, 24px);
        color: var(--text-primary);
        height: 100%;
        overflow: auto;
      }
      .run__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--space-5, 20px);
      }
      .run__title {
        display: flex;
        align-items: center;
        gap: var(--space-3, 12px);
      }
      .run__title h1 {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 700;
      }
      .run__grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
        gap: var(--space-4, 16px);
      }
      .run__card {
        border: 1px solid var(--border-color);
        border-radius: var(--radius-lg, 12px);
        background: var(--bg-card);
        padding: var(--space-4, 16px);
      }
      .run__card-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        margin-bottom: var(--space-3, 12px);
      }
      .run__name {
        font-weight: 600;
      }
      .run__ver {
        color: var(--text-tertiary);
        font-size: 0.75rem;
      }
      .run__btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: 1px solid var(--border-color);
        background: var(--bg-card);
        color: var(--text-primary);
        border-radius: var(--radius-md, 8px);
        padding: 6px 12px;
        font-size: 0.85rem;
      }
      .run__muted {
        color: var(--text-secondary);
      }
      .run__empty {
        border: 1px dashed var(--border-color);
        border-radius: var(--radius-lg, 12px);
        padding: var(--space-6, 24px);
        text-align: center;
        color: var(--text-secondary);
      }
      .run__empty a {
        color: var(--primary);
      }
    `,
  ],
})
export class ExtensionsRuntimePage {
  private readonly service = inject(ExtensionsService);

  protected readonly PuzzleIcon = Puzzle;
  protected readonly RefreshIcon = RefreshCw;

  readonly extensions = signal<RuntimeExtension[]>([]);
  readonly loading = signal(true);

  /** Context handed to every extension. The API proxy authenticates via the session, not this. */
  readonly baseContext: Record<string, unknown> = { host: 'virtex-web' };

  constructor() {
    this.refresh();
  }

  refresh(): void {
    this.loading.set(true);
    this.service.runtime().subscribe({
      next: (list) => {
        this.extensions.set(list);
        this.loading.set(false);
      },
      error: () => {
        this.extensions.set([]);
        this.loading.set(false);
      },
    });
  }
}
