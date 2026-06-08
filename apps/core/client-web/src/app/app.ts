import { Component, inject, OnInit } from '@angular/core';
import { Router, RouterOutlet, NavigationStart, NavigationEnd, NavigationCancel, NavigationError } from '@angular/router';
import { ThemeService } from './core/services/theme';
import { LanguageService } from './core/services/language';
import { AuthService } from './core/services/auth';
import { ModalService } from './shared/service/modal.service';
import { LoaderService } from './shared/service/loader.service';
import { ModalComponent } from './shared/components/modal/modal.component';
import { CommonModule } from '@angular/common';
import { LoaderComponent } from './shared/components/loader/loader.component';
import { GeoMismatchModalComponent } from './shared/components/geo-mismatch-modal/geo-mismatch-modal.component';
import { IdleService } from './core/services/idle.service';
import { ToastContainerComponent } from './shared/components/ui/toast/toast-container.component';
import { OfflineBannerComponent } from './shared/components/offline-banner/offline-banner.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ModalComponent, CommonModule, GeoMismatchModalComponent, ToastContainerComponent, OfflineBannerComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  public themeService = inject(ThemeService);
  private languageService = inject(LanguageService);
  private authService = inject(AuthService);
  public modalService = inject(ModalService);
  public loaderService = inject(LoaderService);
  private router = inject(Router);
  private idleService = inject(IdleService); // Initialize Idle Service

  ngOnInit(): void {
    this.router.events.subscribe(event => {
      if (event instanceof NavigationStart) {
        // If we are navigating to settings and we are already in settings, let the settings loader handle it.
        // Actually, the simpler rule is: If the target URL belongs to a module with its own loader,
        // AND we are arguably 'inside' that module context (or will be), we might want to suppress global.

        // However, robust logic suggests:
        // 1. If I am in `/settings/general` and go to `/settings/profile`, suppress global loader.
        // 2. If I am in `/dashboard` and go to `/settings/profile`, global loader is fine (transitioning contexts).

        const currentUrl = this.router.url;
        const targetUrl = event.url;

        const isInternalSettingsNav = currentUrl.includes('/settings') && targetUrl.includes('/settings');

        if (!isInternalSettingsNav) {
            this.loaderService.show('global');
        }
      } else if (
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel ||
        event instanceof NavigationError
      ) {
        this.loaderService.hide('global');
      }
    });
  }

  openTestModal(): void {
    this.modalService.open({
      title: 'Modal de Prueba',
      message: '¡El servicio de modales está funcionando correctamente!',
      confirmText: 'Aceptar',
      cancelText: 'Cancelar'
    })?.onClose$.subscribe(result => {
      console.log('Modal cerrado con resultado:', result);
    });
  }
}
