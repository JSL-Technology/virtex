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
import { StepUpService } from './core/services/step-up.service';
import { NotificationService } from './core/services/notification';
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
  private stepUpService = inject(StepUpService);
  private notificationService = inject(NotificationService);

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

      if (event instanceof NavigationEnd) {
        this.reportFederatedStepUpReturn(event.urlAfterRedirects);
      }
    });
  }

  /**
   * Report the outcome of an identity-provider re-authentication.
   *
   * Re-authenticating against an IdP is a full page navigation, so whatever the user was about
   * to do does not survive it — the proof does, as an httpOnly cookie. Handled here rather than
   * on the security page because the server returns the user to wherever they started, which is
   * just as often billing or user administration.
   *
   * Without this the user came back to a silently ordinary page and had no way to tell whether
   * the verification had worked.
   */
  private reportFederatedStepUpReturn(url: string): void {
    const query = url.split('?')[1];
    if (!query) return;
    const outcome = new URLSearchParams(query).get('step_up');
    if (outcome !== 'ok' && outcome !== 'failed') return;

    // Consumed either way, so a reload does not repeat the message.
    this.stepUpService.consumePendingScope();

    if (outcome === 'ok') {
      this.notificationService.showSuccess('AUTH.STEP_UP.FEDERATED_OK');
    } else {
      this.notificationService.showError('AUTH.STEP_UP.FEDERATED_FAILED');
    }

    // Strip the marker so it does not survive a refresh or get shared in a copied URL.
    const [path] = url.split('?');
    const params = new URLSearchParams(query);
    params.delete('step_up');
    params.delete('scope');
    const rest = params.toString();
    void this.router.navigateByUrl(rest ? `${path}?${rest}` : path, { replaceUrl: true });
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
