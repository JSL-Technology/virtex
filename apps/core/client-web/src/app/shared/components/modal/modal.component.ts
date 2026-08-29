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
  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  confirm() {
    this.confirmed.emit();
  }

  cancel() {
    this.cancelled.emit();
  }
  
  close() {
    this.closed.emit();
  }
}
