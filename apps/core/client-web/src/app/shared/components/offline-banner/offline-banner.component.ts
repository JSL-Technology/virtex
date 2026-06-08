import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, WifiOff } from 'lucide-angular';
import { PwaService } from '../../../core/services/pwa.service';

@Component({
  selector: 'app-offline-banner',
  standalone: true,
  imports: [CommonModule, TranslateModule, LucideAngularModule],
  template: `
    @if (!pwaService.isOnline()) {
      <div class="offline-banner">
        <div class="banner-content">
          <div class="icon-container">
            <lucide-icon [img]="WifiOffIcon" size="24"></lucide-icon>
          </div>
          <div class="text-container">
            <h4 class="title">{{ 'PWA.OFFLINE_TITLE' | translate }}</h4>
            <p class="message">{{ 'PWA.OFFLINE_MESSAGE' | translate }}</p>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .offline-banner {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 9999;
      background: var(--bg-card);
      backdrop-filter: blur(20px);
      border-bottom: 1px solid var(--border-color);
      padding: 1rem;
      display: flex;
      justify-content: center;
      animation: slideDown 0.3s ease-out;
    }

    .banner-content {
      display: flex;
      align-items: center;
      gap: 1rem;
      max-width: 600px;
      width: 100%;
    }

    .icon-container {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      background: rgba(239, 68, 68, 0.1);
      color: #ef4444;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .text-container {
      display: flex;
      flex-direction: column;
    }

    .title {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    .message {
      margin: 0;
      font-size: 0.875rem;
      color: var(--text-secondary);
      line-height: 1.4;
    }

    @keyframes slideDown {
      from { transform: translateY(-100%); }
      to { transform: translateY(0); }
    }
  `]
})
export class OfflineBannerComponent {
  pwaService = inject(PwaService);
  protected readonly WifiOffIcon = WifiOff;
}
