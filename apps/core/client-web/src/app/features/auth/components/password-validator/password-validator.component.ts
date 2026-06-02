import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-password-validator',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="password-validator">
      <div class="strength-bars">
        <div class="strength-bar" [style.background-color]="strength >= 1 ? getBarColor(1) : ''" [class.active]="strength >= 1"></div>
        <div class="strength-bar" [style.background-color]="strength >= 2 ? getBarColor(2) : ''" [class.active]="strength >= 2"></div>
        <div class="strength-bar" [style.background-color]="strength >= 3 ? getBarColor(3) : ''" [class.active]="strength >= 3"></div>
        <div class="strength-bar" [style.background-color]="strength >= 4 ? getBarColor(4) : ''" [class.active]="strength >= 4"></div>
      </div>

      <p class="strength-label" *ngIf="password">
        {{ getStrengthLabel() }}
      </p>
    </div>
  `,
  styles: [`
    .password-validator {
      margin-top: 0.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }

    .strength-bars {
      display: flex;
      height: 4px;
      gap: 0.25rem;
      width: 100%;
    }

    .strength-bar {
      flex: 1;
      height: 100%;
      background-color: var(--bg-tertiary);
      border-radius: 2px;
      transition: background-color 0.3s ease;

      &.active {
        // Background color is handled by [style.background-color]
      }
    }

    .strength-label {
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--text-tertiary);
      text-align: right;
    }
  `]
})
export class PasswordValidatorComponent {
  @Input() password = '';

  get strength(): number {
    if (!this.password) return 0;
    let s = 0;
    if (this.password.length >= 8) s++;
    if (/[A-Z]/.test(this.password)) s++;
    if (/[0-9]/.test(this.password)) s++;
    if (/[^A-Za-z0-9]/.test(this.password)) s++;
    return s;
  }

  getBarColor(level: number): string {
    const colors = {
      1: 'var(--error)',
      2: '#f59e0b', // Amber-500 for regular
      3: '#10b981', // Emerald-500 for good
      4: 'var(--success)'
    };

    // All active bars show the same color based on current strength
    if (this.strength === 1) return colors[1];
    if (this.strength === 2) return colors[2];
    if (this.strength === 3) return colors[3];
    if (this.strength === 4) return colors[4];

    return 'var(--bg-tertiary)';
  }

  getStrengthLabel(): string {
      switch(this.strength) {
          case 0: return '';
          case 1: return 'Débil';
          case 2: return 'Regular';
          case 3: return 'Buena';
          case 4: return 'Fuerte';
          default: return '';
      }
  }
}
