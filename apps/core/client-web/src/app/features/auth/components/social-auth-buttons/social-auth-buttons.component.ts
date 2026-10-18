import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-social-auth-buttons',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './social-auth-buttons.component.html',
  styleUrls: ['./social-auth-buttons.component.scss']
})
export class SocialAuthButtonsComponent {
  @Output() login = new EventEmitter<string>();

  loginWith(provider: string) {
    this.login.emit(provider);
  }
}
