import { Injectable, inject } from '@angular/core';
import { ToastService } from '../../shared/services/toast.service';

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private toastService = inject(ToastService);

  showSuccess(message: string): void {
    this.toastService.success(message);
  }

  showError(message: string): void {
    this.toastService.error(message);
  }

  showInfo(message: string): void {
    this.toastService.info(message);
  }

  showWarning(message: string): void {
    this.toastService.warning(message);
  }
}
