import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/** Whether the device thinks it is online — shown on the till so a failed sale is not a mystery. */
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  readonly online = signal(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  constructor() {
    if (typeof window === 'undefined') return;
    const up = () => this.online.set(true);
    const down = () => this.online.set(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    });
  }
}
