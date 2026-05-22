import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-auth-button',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './auth-button.component.html',
  styleUrls: ['./auth-button.component.scss']
})
export class AuthButtonComponent {
  @Input() type: 'button' | 'submit' | 'reset' = 'button';
  @Input() variant: 'primary' | 'secondary' | 'outline' | 'ghost' = 'primary'; // Kept for API compatibility, though CSS currently overrides to one style
  @Input() disabled = false;
  @Input() loading = false;
  @Output() onClick = new EventEmitter<Event>();
}
