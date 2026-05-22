import { Component, EventEmitter, Output, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalOptions } from '../../service/modal.service';
import { UiModalComponent } from '../ui/modal';

@Component({
  selector: 'app-modal',
  standalone: true,
  imports: [CommonModule, UiModalComponent],
  templateUrl: './modal.component.html',
  styleUrls: ['./modal.component.scss']
})
export class ModalComponent {
  @Input() options!: ModalOptions;
  @Output() onConfirm = new EventEmitter<void>();
  @Output() onCancel = new EventEmitter<void>();
  @Output() onCloseModal = new EventEmitter<void>();

  confirm() {
    this.onConfirm.emit();
  }

  cancel() {
    this.onCancel.emit();
  }
  
  close() {
    this.onCloseModal.emit();
  }
}
