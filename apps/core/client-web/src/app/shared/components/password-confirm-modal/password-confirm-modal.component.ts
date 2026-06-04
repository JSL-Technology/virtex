
import { Component, signal, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Shield, X, AlertCircle, Loader2 } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-password-confirm-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, TranslateModule],
  templateUrl: './password-confirm-modal.component.html',
  styleUrls: ['./password-confirm-modal.component.scss']
})
export class PasswordConfirmModalComponent {
  @Input() isLoading = false;
  @Input() error: string | null = null;
  @Input() remainingAttempts: number | null = null;

  @Output() confirmed = new EventEmitter<string>();
  @Output() cancelled = new EventEmitter<void>();

  protected readonly ShieldIcon = Shield;
  protected readonly XIcon = X;
  protected readonly AlertIcon = AlertCircle;
  protected readonly LoaderIcon = Loader2;

  password = signal('');

  onConfirm() {
    if (this.password() && !this.isLoading) {
      this.confirmed.emit(this.password());
    }
  }

  onCancel() {
    this.password.set('');
    this.cancelled.emit();
  }
}
