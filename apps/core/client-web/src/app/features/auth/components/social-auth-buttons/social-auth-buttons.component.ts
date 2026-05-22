import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-social-auth-buttons',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  templateUrl: './social-auth-buttons.component.html',
  styleUrls: ['./social-auth-buttons.component.scss']
})
export class SocialAuthButtonsComponent {
  @Output() onLogin = new EventEmitter<string>();

  loginWith(provider: string) {
    this.onLogin.emit(provider);
  }
}
