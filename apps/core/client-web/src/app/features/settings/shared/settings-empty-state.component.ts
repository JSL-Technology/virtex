import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-settings-empty-state',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="ses">
      <div class="ses__icon-wrap">
        <ng-content select="[slot=icon]"></ng-content>
      </div>

      <div class="ses__badge">En desarrollo</div>

      <h2 class="ses__title">{{ title }}</h2>
      <p class="ses__desc">{{ description }}</p>

      @if (features.length > 0) {
        <ul class="ses__features">
          @for (f of features; track f) {
            <li class="ses__feature-item">
              <span class="ses__feature-dot"></span>
              {{ f }}
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }

    .ses {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 3.5rem 2rem;
      max-width: 480px;
      margin: 0 auto;
    }

    .ses__icon-wrap {
      width: 4.5rem;
      height: 4.5rem;
      border-radius: var(--radius-lg);
      background: var(--primary-light);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--primary);
      margin-bottom: 1.5rem;
      box-shadow: 0 0 0 8px rgba(var(--primary-rgb), 0.06);

      ::ng-deep lucide-icon {
        color: var(--primary);
      }
    }

    .ses__badge {
      display: inline-flex;
      align-items: center;
      padding: 0.1875rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.6875rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      background-color: rgba(217, 119, 6, 0.12);
      color: #b45309;
      border: 1px solid rgba(217, 119, 6, 0.2);
      margin-bottom: 1rem;
    }

    .ses__title {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: 0.625rem;
      line-height: 1.3;
    }

    .ses__desc {
      font-size: 0.9rem;
      color: var(--text-secondary);
      line-height: 1.65;
      margin-bottom: 1.75rem;
    }

    .ses__features {
      list-style: none;
      padding: 0;
      margin: 0;
      width: 100%;
      max-width: 360px;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .ses__feature-item {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      font-size: 0.875rem;
      color: var(--text-secondary);
      background-color: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 0.5rem 0.875rem;
      text-align: left;
    }

    .ses__feature-dot {
      width: 6px;
      height: 6px;
      border-radius: 9999px;
      background-color: var(--primary);
      flex-shrink: 0;
      opacity: 0.6;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsEmptyStateComponent {
  @Input() title = '';
  @Input() description = '';
  @Input() features: string[] = [];
}
