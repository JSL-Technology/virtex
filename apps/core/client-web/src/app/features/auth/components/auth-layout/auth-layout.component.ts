import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthFooterComponent } from '../auth-footer/auth-footer.component';

@Component({
  selector: 'app-auth-layout',
  standalone: true,
  imports: [CommonModule, AuthFooterComponent],
  templateUrl: './auth-layout.component.html',
  styleUrls: ['./auth-layout.component.scss']
})
export class AuthLayoutComponent {
  // Logic moved to AuthFooterComponent
}
