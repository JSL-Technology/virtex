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
      background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.05) 0%, rgba(var(--primary-rgb), 0.1) 100%);
      border: 1px solid rgba(var(--primary-rgb), 0.2);
      border-radius: var(--radius-xl);
      padding: 1rem;
      cursor: pointer;
      position: relative;
      overflow: hidden;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      text-align: left;

      &:hover:not(:disabled) {
        background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.1) 0%, rgba(var(--primary-rgb), 0.15) 100%);
        border-color: var(--primary);
        transform: translateY(-2px);
        box-shadow: 0 8px 20px rgba(var(--primary-rgb), 0.15);
      }

      &:active:not(:disabled) {
        transform: translateY(0);
      }

      &:disabled {
        opacity: 0.7;
        cursor: not-allowed;
      }
    }

    .passkey-content {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .icon-wrapper {
      width: 40px;
      height: 40px;
      background: var(--bg-card);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }

    .passkey-icon {
      width: 24px;
      height: 24px;
    }

    .text-wrapper {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .passkey-title {
      font-weight: 600;
      font-size: 0.95rem;
      color: var(--text-primary);
    }

    .passkey-subtitle {
      font-size: 0.8rem;
      color: var(--text-secondary);
    }

    .spinner-overlay {
      position: absolute;
      inset: 0;
      background: rgba(var(--bg-card-rgb), 0.5);
      backdrop-filter: blur(2px);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .spinner {
      width: 20px;
      height: 20px;
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
