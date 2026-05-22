import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { LucideAngularModule, ShieldAlert, Mail } from 'lucide-angular';
import { AuthService } from '../../core/services/auth';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Component({
  selector: 'app-unauthorized-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, RouterLink],
  templateUrl: './unauthorized.page.html',
  styleUrls: ['./unauthorized.page.scss']
})
export class UnauthorizedPage {
  protected readonly ShieldAlertIcon = ShieldAlert;
  protected readonly MailIcon = Mail;

  private route = inject(ActivatedRoute);
  private authService = inject(AuthService);

  public attemptedUrl$: Observable<string | null> = this.route.queryParamMap.pipe(
    map(params => params.get('url'))
  );

  currentUser = this.authService.currentUser;

  constructMailtoLink(attemptedUrl: string | null): string {
    const user = this.currentUser();
    const subject = `Solicitud de Permiso para: ${attemptedUrl || 'ruta protegida'}`;
    const body = `Hola,

Mi nombre es ${user?.firstName} ${user?.lastName} (email: ${user?.email}).

Me gustaría solicitar acceso a la siguiente ruta a la que actualmente no tengo permiso:
${window.location.origin}${attemptedUrl || '/'}

Gracias,
${user?.firstName}`;

    return `mailto:admin@example.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }
}