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
      class="passkey-card"
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
    .passkey-card {
      width: 100%;
      display: block;
      background: var(--bg-card);
      border: 1.5px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: 0.625rem 0.875rem;
      cursor: pointer;
      position: relative;
      overflow: hidden;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      text-align: left;
      font-family: inherit;

      &:hover:not(:disabled) {
        background: var(--bg-primary);
        border-color: var(--primary);
        box-shadow: 0 2px 10px rgba(var(--primary-rgb), 0.10);
      }

      &:active:not(:disabled) {
        transform: scale(0.99);
      }

      &:focus-visible {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    }

    .passkey-content {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .icon-wrapper {
      width: 32px;
      height: 32px;
      background: var(--primary-light);
      border-radius: 7px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .passkey-icon {
      width: 18px;
      height: 18px;
    }

    .text-wrapper {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .passkey-title {
      font-weight: 600;
      font-size: 0.84rem;
      color: var(--text-primary);
      font-family: inherit;
    }

    .passkey-subtitle {
      font-size: 0.76rem;
      color: var(--text-secondary);
      font-family: inherit;
    }

    .spinner-overlay {
      position: absolute;
      inset: 0;
      background: var(--bg-card);
      opacity: 0.75;
      backdrop-filter: blur(2px);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .spinner {
      width: 18px;
      height: 18px;
      border: 2px solid var(--border-color);
      border-top-color: var(--primary);
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
