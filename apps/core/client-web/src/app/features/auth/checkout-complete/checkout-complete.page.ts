import { Component, ChangeDetectionStrategy, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { LucideAngularModule, CheckCircle, AlertTriangle, Loader } from 'lucide-angular';
import { AuthService } from '../../../core/services/auth';
import { AuthLayoutComponent } from '../components/auth-layout/auth-layout.component';
import { AuthButtonComponent } from '../components/auth-button/auth-button.component';

type CompleteState = 'verifying' | 'success' | 'error';

@Component({
  selector: 'app-checkout-complete',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, AuthLayoutComponent, AuthButtonComponent],
  templateUrl: './checkout-complete.page.html',
  styleUrls: ['./checkout-complete.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CheckoutCompletePage implements OnInit {
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  protected readonly CheckCircleIcon = CheckCircle;
  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly LoaderIcon = Loader;

  state = signal<CompleteState>('verifying');
  errorMessage = signal<string | null>(null);

  private sessionId: string | null = null;
  private attempts = 0;
  private readonly maxAttempts = 5;

  ngOnInit(): void {
    this.sessionId = this.route.snapshot.queryParamMap.get('session_id');
    if (!this.sessionId) {
      this.state.set('error');
      this.errorMessage.set('No se encontró la sesión de pago.');
      return;
    }
    this.confirm();
  }

  confirm(): void {
    if (!this.sessionId) return;
    this.state.set('verifying');
    this.errorMessage.set(null);
    this.attempts++;

    this.authService.confirmRegistration(this.sessionId).subscribe({
      next: () => {
        this.state.set('success');
        // Brief beat so the user sees the confirmation, then enter the app.
        setTimeout(() => this.router.navigate(['/dashboard']), 1500);
      },
      error: (err) => {
        // The webhook may lag a moment; retry a few times before giving up.
        if (this.attempts < this.maxAttempts) {
          setTimeout(() => this.confirm(), 2000);
          return;
        }
        this.state.set('error');
        this.errorMessage.set(
          err?.error?.message || 'No pudimos confirmar tu pago automáticamente. Si el cargo se realizó, inicia sesión en unos minutos.'
        );
      },
    });
  }

  goToLogin(): void {
    this.router.navigate(['/auth/login']);
  }
}
