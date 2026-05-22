import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-password-validator',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="mt-2 space-y-1">
      <div class="flex h-1 gap-1 w-full mb-2">
        <div class="h-full flex-1 rounded-full transition-colors duration-300" [ngClass]="strength >= 1 ? getColor(1) : 'bg-bg-tertiary'"></div>
        <div class="h-full flex-1 rounded-full transition-colors duration-300" [ngClass]="strength >= 2 ? getColor(2) : 'bg-bg-tertiary'"></div>
        <div class="h-full flex-1 rounded-full transition-colors duration-300" [ngClass]="strength >= 3 ? getColor(3) : 'bg-bg-tertiary'"></div>
        <div class="h-full flex-1 rounded-full transition-colors duration-300" [ngClass]="strength >= 4 ? getColor(4) : 'bg-bg-tertiary'"></div>
      </div>

      <p class="text-xs text-text-tertiary text-right" *ngIf="password">
        {{ getStrengthLabel() }}
      </p>
    </div>
  `
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

  getColor(level: number): string {
    if (this.strength === 1) return 'bg-error';
    if (this.strength === 2) return 'bg-orange-500'; // Warning
    if (this.strength === 3) return 'bg-yellow-400'; // Good
    if (this.strength === 4) return 'bg-success';
    return 'bg-bg-tertiary';
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
