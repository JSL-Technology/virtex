import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../../../services/toast.service';
import { ToastComponent } from './toast.component';

@Component({
  selector: 'app-toast-container',
  imports: [CommonModule, ToastComponent],
  templateUrl: './toast-container.component.html',
  styleUrl: './toast-container.component.scss'
})
export class ToastContainerComponent {
  public toastService = inject(ToastService);

  trackByFn(index: number, toast: any) {
    return toast.id;
  }
}
