import { Component, ChangeDetectionStrategy, inject, OnInit, OnDestroy } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet, Router, NavigationStart, NavigationEnd, NavigationCancel, NavigationError } from '@angular/router';
import {
  LucideAngularModule,
  Building,
  Users,
  Palette,
  UserCircle,
  Briefcase,
  Shield,
  Server,
  FileText,
  Lock,
  Workflow,
  Globe,
  Mail,
  Database,
  Calculator,
  Percent,
  CalendarClock,
  ArrowRightLeft,
  Bell
} from 'lucide-angular';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { CommonModule } from '@angular/common';
import { LoaderService } from '../../../shared/service/loader.service';
import { LoaderComponent } from '../../../shared/components/loader/loader.component';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-settings-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    LucideAngularModule,
    HasPermissionDirective,
    LoaderComponent
  ],
  templateUrl: './settings.layout.html',
  styleUrls: ['./settings.layout.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SettingsLayout implements OnInit, OnDestroy {
  public loaderService = inject(LoaderService);
  private router = inject(Router);
  private routerSub: Subscription | undefined;

  // Categoría: Mi Cuenta
  protected readonly MyProfileIcon = UserCircle;
  protected readonly NotificationsIcon = Bell;

  // Categoría: Organización
  protected readonly OrgProfileIcon = Building;
  protected readonly SubsidiariesIcon = Database; // O Building2 si existe
  protected readonly BrandingIcon = Palette;

  // Categoría: Finanzas
  protected readonly AccountingIcon = Calculator;
  protected readonly CurrenciesIcon = ArrowRightLeft; // Cambio
  protected readonly TaxesIcon = Percent;
  protected readonly ClosingIcon = CalendarClock;
  protected readonly IntercompanyIcon = Globe;

  // Categoría: Operaciones
  protected readonly SequencesIcon = FileText;
  protected readonly WorkflowsIcon = Workflow; // O GitBranch
  protected readonly InventoryIcon = Briefcase; // O Package

  // Categoría: Sistema
  protected readonly UsersIcon = Users;
  protected readonly RolesIcon = Shield;
  protected readonly SecurityIcon = Lock;
  protected readonly IntegrationsIcon = Server;
  protected readonly SmtpIcon = Mail;

  ngOnInit() {
    this.routerSub = this.router.events.subscribe(event => {
      // Logic: If we are navigating WITHIN settings, show local loader.
      // Note: App component suppresses global loader if current & target are settings.

      if (event instanceof NavigationStart) {
        if (event.url.includes('/settings')) {
          this.loaderService.show('settings');
        }
      } else if (
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel ||
        event instanceof NavigationError
      ) {
        this.loaderService.hide('settings');
      }
    });
  }

  ngOnDestroy() {
    if (this.routerSub) {
      this.routerSub.unsubscribe();
    }
  }
}
