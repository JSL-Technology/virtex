import {
  Component,
  HostListener,
  inject,
  signal,
  Input,
  Output,
  EventEmitter,
  Type,
} from '@angular/core';
import { CommonModule, NgComponentOutlet } from '@angular/common';
import { Router } from '@angular/router';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { from, of } from 'rxjs';
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
  CreditCard,
} from 'lucide-angular';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';

@Component({
  selector: 'app-settings-modal',
  standalone: true,
  imports: [CommonModule, NgComponentOutlet, LucideAngularModule, HasPermissionDirective],
  templateUrl: './settings-modal.component.html',
  styleUrls: ['./settings-modal.component.scss'],
})
export class SettingsModalComponent {
  protected readonly router = inject(Router);

  readonly section = signal<string>('my-profile');

  @Input()
  set sectionName(v: string) {
    this.section.set(v || 'my-profile');
  }

  @Output() closed = new EventEmitter<void>();

  private readonly SECTION_MAP: Record<string, () => Promise<Type<any>>> = {
    'my-profile': () =>
      import('../my-profile/my-profile.page').then((m) => m.MyProfilePage),
    'sessions': () =>
      import('../pages/sessions/sessions.component').then((m) => m.SessionsComponent),
    'profile': () =>
      import('../company-profile/company-profile.page').then((m) => m.CompanyProfilePage),
    'subsidiaries': () =>
      import('../organization/subsidiaries/subsidiaries.page').then((m) => m.SubsidiariesPage),
    'branding': () =>
      import('../branding/branding.page').then((m) => m.BrandingPage),
    'accounting': () =>
      import('../finance/accounting/accounting.page').then((m) => m.AccountingSettingsPage),
    'currencies': () =>
      import('../finance/currencies/currencies.page').then((m) => m.CurrencySettingsPage),
    'taxes': () =>
      import('../finance/taxes/taxes.page').then((m) => m.TaxRulesPage),
    'closing-rules': () =>
      import('../finance/closing-rules/closing-rules.page').then((m) => m.ClosingRulesPage),
    'intercompany': () =>
      import('../finance/intercompany/intercompany.page').then((m) => m.IntercompanyPage),
    'sequences': () =>
      import('../operations/sequences/sequences.page').then((m) => m.SequenceSettingsPage),
    'approvals': () =>
      import('../operations/approvals/approvals.page').then((m) => m.ApprovalPoliciesPage),
    'inventory-policies': () =>
      import('../operations/inventory-policies/inventory-policies.page').then(
        (m) => m.InventoryPoliciesPage
      ),
    'roles': () =>
      import('../roles/roles.page').then((m) => m.RolesManagementPage),
    'users': () =>
      import('../user-management/user-management.page').then((m) => m.UserManagementPage),
    'security': () =>
      import('../system/security/security.page').then((m) => m.SecuritySettingsPage),
    'integrations': () =>
      import('../system/integrations/integrations.page').then((m) => m.IntegrationSettingsPage),
    'smtp': () =>
      import('../system/smtp/smtp.page').then((m) => m.SmtpSettingsPage),
    'sso': () =>
      import('../system/sso/sso.page').then((m) => m.SsoSettingsPage),
    'billing': () =>
      import('../billing/billing.page').then((m) => m.BillingPage),
  };

  readonly currentComponent = toSignal(
    toObservable(this.section).pipe(
      switchMap((sec) => {
        const loader = this.SECTION_MAP[sec];
        if (!loader) {
          const fallback = this.SECTION_MAP['my-profile'];
          return from(fallback());
        }
        return from(loader());
      })
    ),
    { initialValue: null as Type<any> | null }
  );

  navigate(section: string): void {
    this.router.navigate([], { fragment: 'settings/' + section });
  }

  close(): void {
    // Navigate to the current path without any fragment to cleanly close the modal.
    const pathWithoutFragment = this.router.url.split('#')[0];
    this.router.navigateByUrl(pathWithoutFragment);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  // Icons — Mi Cuenta
  protected readonly MyProfileIcon = UserCircle;
  protected readonly BillingIcon = CreditCard;

  // Icons — Organización
  protected readonly OrgProfileIcon = Building;
  protected readonly SubsidiariesIcon = Database;
  protected readonly BrandingIcon = Palette;

  // Icons — Finanzas
  protected readonly AccountingIcon = Calculator;
  protected readonly CurrenciesIcon = ArrowRightLeft;
  protected readonly TaxesIcon = Percent;
  protected readonly ClosingIcon = CalendarClock;
  protected readonly IntercompanyIcon = Globe;

  // Icons — Operaciones
  protected readonly SequencesIcon = FileText;
  protected readonly WorkflowsIcon = Workflow;
  protected readonly InventoryIcon = Briefcase;

  // Icons — Sistema
  protected readonly UsersIcon = Users;
  protected readonly RolesIcon = Shield;
  protected readonly SecurityIcon = Lock;
  protected readonly IntegrationsIcon = Server;
  protected readonly SmtpIcon = Mail;
  protected readonly SsoIcon = Shield;
}
