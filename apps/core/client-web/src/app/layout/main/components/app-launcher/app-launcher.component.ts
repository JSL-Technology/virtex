import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Grid2X2, ShoppingCart, HardHat, Store, Box, Utensils, Users, UserCircle } from 'lucide-angular';
import { ClickOutsideDirective } from '../../../../shared/directives/click-outside.directive';

interface VirtexApp {
  id: string;
  nameKey: string;
  icon: any;
  color: string;
  url: string;
}

@Component({
  selector: 'app-launcher',
  standalone: true,
  imports: [CommonModule, TranslateModule, LucideAngularModule, ClickOutsideDirective],
  template: `
    <div class="app-launcher-container" appClickOutside (clickOutside)="closeMenu()">
      <button
        class="icon-button launcher-trigger"
        [title]="'APPS.TITLE' | translate"
        (click)="toggleMenu()"
        [class.active]="isOpen()"
      >
        <lucide-icon [img]="GridIcon" size="20"></lucide-icon>
      </button>

      @if (isOpen()) {
        <div class="launcher-dropdown">
          <div class="launcher-header">
            <h3>{{ 'APPS.TITLE' | translate }}</h3>
          </div>
          <div class="launcher-grid">
            @for (app of apps; track app.id) {
              <a [href]="app.url" class="app-item" target="_blank">
                <div class="app-icon-wrapper" [style.background-color]="app.color + '15'">
                  <lucide-icon [img]="app.icon" [style.color]="app.color" size="24"></lucide-icon>
                </div>
                <span class="app-name">{{ app.nameKey | translate }}</span>
              </a>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .app-launcher-container {
      position: relative;
    }

    .launcher-trigger.active {
      background: var(--bg-hover);
      color: var(--primary-color);
    }

    .launcher-dropdown {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      width: 320px;
      background: var(--bg-card);
      backdrop-filter: blur(20px);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      padding: 1.25rem;
      z-index: 1000;
      animation: fadeInScale 0.2s ease-out;
    }

    .launcher-header {
      margin-bottom: 1rem;
      h3 {
        margin: 0;
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
    }

    .launcher-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.75rem;
    }

    .app-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem;
      border-radius: var(--radius-md);
      text-decoration: none;
      transition: all 0.2s ease;
      cursor: pointer;

      &:hover {
        background: var(--bg-hover);
        transform: translateY(-2px);

        .app-icon-wrapper {
          transform: scale(1.1);
        }
      }
    }

    .app-icon-wrapper {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s ease;
    }

    .app-name {
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--text-primary);
      text-align: center;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    @keyframes fadeInScale {
      from {
        opacity: 0;
        transform: scale(0.95) translateY(-10px);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }
  `]
})
export class AppLauncherComponent {
  isOpen = signal(false);
  protected readonly GridIcon = Grid2X2;

  apps: VirtexApp[] = [
    { id: 'pos', nameKey: 'APPS.POS', icon: ShoppingCart, color: '#3b82f6', url: 'https://pos.virteex.com' },
    { id: 'shopfloor', nameKey: 'APPS.SHOPFLOOR', icon: HardHat, color: '#f59e0b', url: 'https://shopfloor.virteex.com' },
    { id: 'store', nameKey: 'APPS.STORE', icon: Store, color: '#10b981', url: 'https://store.virteex.com' },
    { id: 'wms', nameKey: 'APPS.WMS', icon: Box, color: '#8b5cf6', url: 'https://wms.virteex.com' },
    { id: 'lunch', nameKey: 'APPS.LUNCH', icon: Utensils, color: '#ef4444', url: 'https://lunch.virteex.com' },
    { id: 'hr', nameKey: 'APPS.HR', icon: UserCircle, color: '#ec4899', url: 'https://hr.virteex.com' },
    { id: 'crm', nameKey: 'APPS.CRM', icon: Users, color: '#06b6d4', url: 'https://crm.virteex.com' },
  ];

  toggleMenu() {
    this.isOpen.update(v => !v);
  }

  closeMenu() {
    this.isOpen.set(false);
  }
}
