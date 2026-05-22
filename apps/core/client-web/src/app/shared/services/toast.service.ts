import { Injectable, signal } from '@angular/core';
import { Toast, ToastType } from '../interfaces/toast.interface';

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  /**
   * List of active toasts managed as an Angular Signal.
   */
  public toasts = signal<Toast[]>([]);

  private readonly defaultDuration = 5000;

  /**
   * Adds a new toast to the list.
   * @param message Message or translation key.
   * @param type Type of the toast.
   * @param duration Optional duration in ms.
   */
  public show(message: string, type: ToastType = 'info', duration?: number): void {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast: Toast = {
      id,
      message,
      type,
      duration: duration ?? this.defaultDuration
    };

    this.toasts.update(currentToasts => [...currentToasts, newToast]);

    if (newToast.duration && newToast.duration > 0) {
      setTimeout(() => this.remove(id), newToast.duration);
    }
  }

  public success(message: string, duration?: number): void {
    this.show(message, 'success', duration);
  }

  public error(message: string, duration?: number): void {
    this.show(message, 'error', duration);
  }

  public info(message: string, duration?: number): void {
    this.show(message, 'info', duration);
  }

  public warning(message: string, duration?: number): void {
    this.show(message, 'warning', duration);
  }

  /**
   * Removes a toast by its ID.
   * @param id The ID of the toast to remove.
   */
  public remove(id: string): void {
    this.toasts.update(currentToasts => currentToasts.filter(t => t.id !== id));
  }
}
