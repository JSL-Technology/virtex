import { Injectable, NgZone, inject, effect } from '@angular/core';
import { Router } from '@angular/router';
import { fromEvent, merge, Subscription, timer } from 'rxjs';
import { switchMap, take } from 'rxjs/operators';
import { AuthService } from './auth';
import { ModalService } from '../../shared/service/modal.service';

@Injectable({
  providedIn: 'root'
})
export class IdleService {
  private readonly IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
  private idleSubscription?: Subscription;
  private authService = inject(AuthService);
  private modalService = inject(ModalService);
  private ngZone = inject(NgZone);

  constructor() {
    // React to authentication state changes
    effect(() => {
      if (this.authService.isAuthenticated()) {
        this.startIdleTimer();
      } else {
        this.stopIdleTimer();
      }
    });
  }

  private startIdleTimer() {
    if (this.idleSubscription) {
      this.idleSubscription.unsubscribe();
    }

    this.ngZone.runOutsideAngular(() => {
        const events$ = merge(
            fromEvent(document, 'mousemove'),
            fromEvent(document, 'keydown'),
            fromEvent(document, 'click'),
            fromEvent(document, 'scroll')
        );

        this.idleSubscription = events$.pipe(
            switchMap(() => timer(this.IDLE_TIMEOUT_MS))
        ).subscribe(() => {
            this.ngZone.run(() => {
                this.handleIdleTimeout();
            });
        });
    });
  }

  private stopIdleTimer() {
    if (this.idleSubscription) {
      this.idleSubscription.unsubscribe();
      this.idleSubscription = undefined;
    }
  }

  private handleIdleTimeout() {
    // Only act if still authenticated (double check)
    if (this.authService.isAuthenticated()) {
      this.stopIdleTimer(); // Prevent multiple triggers
      this.authService.logout();
      this.modalService.open({
          title: 'Sesión Expirada',
          message: 'Tu sesión ha expirado por inactividad.',
          confirmText: 'Aceptar'
      });
    }
  }
}
