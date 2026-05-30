import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-passkey-button',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  template: `
    <button
      type="button"
      (click)="onClick.emit()"
      [disabled]="loading"
      class="passkey-button"
      [class.loading]="loading">
      <div class="passkey-content">
        <div class="icon-wrapper">
          <img src="assets/icons/passkey.svg" alt="" class="passkey-icon">
        </div>
        <div class="text-wrapper">
          <span class="passkey-title">{{ 'LOGIN.PASSKEY_BUTTON_SHORT' | translate }}</span>
          <span class="passkey-subtitle">{{ 'LOGIN.PASSKEY_SUBTITLE' | translate }}</span>
        </div>
      </div>
      <div *ngIf="loading" class="spinner-overlay">
        <div class="spinner"></div>
      </div>
    </button>
  `,
  styles: [`
    .passkey-button {
      width: 100%;
      display: block;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      padding: 1rem;
      cursor: pointer;
      position: relative;
      overflow: hidden;
      transition: var(--transition);
      text-align: left;

      &:hover:not(:disabled) {
        background: var(--bg-hover);
        border-color: var(--text-tertiary);
        transform: translateY(-1px);
        box-shadow: var(--shadow-md);
      }

      &:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      &:active:not(:disabled) {
        transform: translateY(0);
      }

      &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    }

    .passkey-content {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .icon-wrapper {
      width: 2.5rem;
      height: 2.5rem;
      background: var(--bg-tertiary);
      border-radius: var(--radius-md);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: var(--transition);
    }

    .passkey-button:hover .icon-wrapper {
      background: var(--primary-light);
    }

    .passkey-icon {
      width: 1.5rem;
      height: 1.5rem;
    }

    .text-wrapper {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
    }

    .passkey-title {
      font-weight: 600;
      font-size: 0.9375rem;
      color: var(--text-primary);
    }

    .passkey-subtitle {
      font-size: 0.8125rem;
      color: var(--text-secondary);
    }

    .spinner-overlay {
      position: absolute;
      inset: 0;
      background: rgba(var(--bg-card-rgb, 255, 255, 255), 0.5);
      backdrop-filter: blur(2px);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .spinner {
      width: 1.25rem;
      height: 1.25rem;
      border: 2px solid var(--primary);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `]
})
export class PasskeyButtonComponent {
    @Input() loading = false;
    @Output() onClick = new EventEmitter<void>();
}
