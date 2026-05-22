import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthButtonComponent } from '../auth-button/auth-button.component';

@Component({
  selector: 'app-passkey-button',
  standalone: true,
  imports: [CommonModule, AuthButtonComponent],
  template: `
    <app-auth-button
        variant="secondary"
        (onClick)="onClick.emit()"
        [loading]="loading"
        class="w-full passkey-btn-wrapper">
      <img src="assets/icons/passkey.svg" alt="Passkey" class="passkey-icon">
      <ng-content></ng-content>
    </app-auth-button>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
    }
    .passkey-icon {
      width: 20px;
      height: 20px;
      margin-right: 0.5rem;
      /* Invert color for dark mode if SVG is black, or assume SVG handles it.
         If SVG is monochrome, we might need a filter.
         Assuming SVG is colored or suitable for dark theme since user provided it. */
    }
    /* Enhance the button wrapper style if needed via ::ng-deep or by relying on AuthButtonComponent's variant */
  `]
})
export class PasskeyButtonComponent {
    @Input() loading = false;
    @Output() onClick = new EventEmitter<void>();
}
