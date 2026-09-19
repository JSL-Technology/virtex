import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-password-validator',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  template: `
    <div class="password-validator">
      <div class="strength-bars">
        <div class="strength-bar" [style.background-color]="strength >= 1 ? getBarColor(1) : ''" [class.active]="strength >= 1"></div>
        <div class="strength-bar" [style.background-color]="strength >= 2 ? getBarColor(2) : ''" [class.active]="strength >= 2"></div>
        <div class="strength-bar" [style.background-color]="strength >= 3 ? getBarColor(3) : ''" [class.active]="strength >= 3"></div>
        <div class="strength-bar" [style.background-color]="strength >= 4 ? getBarColor(4) : ''" [class.active]="strength >= 4"></div>
      </div>

      <p class="strength-label" *ngIf="password">
        {{ getStrengthLabel() | translate }}
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
    //  Los cuatro tramos leen tokens semánticos, así que el medidor reacciona al
    //  tema y a la marca igual que el resto de la interfaz. Antes los tramos 2 y 3
    //  llevaban un ámbar y un esmeralda fijos que no se oscurecían en modo claro
    //  ni se aclaraban en oscuro.
    const colors = {
      1: 'var(--error)',
      2: 'var(--warning)',
      3: 'var(--info-text)',
      4: 'var(--success)'
    };

    // All active bars show the same color based on current strength
    if (this.strength === 1) return colors[1];
    if (this.strength === 2) return colors[2];
    if (this.strength === 3) return colors[3];
    if (this.strength === 4) return colors[4];

    return 'var(--bg-tertiary)';
  }

  /**
   * The catalogue key for the current level.
   *
   * It was half migrated: level 1 returned a key and the other three returned Spanish sentences,
   * so the meter showed "Weak" and then "Regular" to the same English reader as the password
   * improved. The template translates whatever comes back, and an empty string translates to
   * itself.
   */
  getStrengthLabel(): string {
      switch(this.strength) {
          case 1: return 'password_strength.weak';
          case 2: return 'password_strength.fair';
          case 3: return 'password_strength.good';
          case 4: return 'password_strength.strong';
          default: return '';
      }
  }
}
