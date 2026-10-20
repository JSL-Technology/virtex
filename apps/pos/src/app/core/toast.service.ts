import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  /** A catalogue key, so the message follows a language switch. */
  key: string;
  params?: Record<string, unknown>;
  kind: 'success' | 'error' | 'warning' | 'info';
}

/** Short, announced messages (`aria-live`), each dismissing itself. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private seq = 0;
  readonly toasts = signal<Toast[]>([]);

  success(key: string, params?: Record<string, unknown>): void {
    this.push({ key, params, kind: 'success' }, 3500);
  }

  error(key: string, params?: Record<string, unknown>): void {
    this.push({ key, params, kind: 'error' }, 7000);
  }

  warning(key: string, params?: Record<string, unknown>): void {
    this.push({ key, params, kind: 'warning' }, 6000);
  }

  info(key: string, params?: Record<string, unknown>): void {
    this.push({ key, params, kind: 'info' }, 3500);
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((toast) => toast.id !== id));
  }

  private push(toast: Omit<Toast, 'id'>, ttl: number): void {
    const id = ++this.seq;
    // At most four on screen: the newest matter, and a stack of stale ones hides the till.
    this.toasts.update((list) => [...list.slice(-3), { ...toast, id }]);
    setTimeout(() => this.dismiss(id), ttl);
  }
}
