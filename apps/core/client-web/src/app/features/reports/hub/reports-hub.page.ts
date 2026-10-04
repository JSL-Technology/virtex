import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { requiredPermissionsFor } from '../../../core/modules/module-manifest';
import { MODULES, buildMenu } from '../../../core/modules/module-registry';
import { AuthService } from '../../../core/services/auth';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';

export interface ReportGroup {
  moduleTitleKey: string;
  reports: { labelKey: string; link: string }[];
}

/**
 * Every report the user may open, grouped by the module that owns it (QA M-09: the home page's
 * «Reportes» opened «módulo en construcción», because `/reports` was nobody's page).
 *
 * Built from the manifests' `analysis` menu entries, so a report added to any module appears here
 * without anyone remembering to list it, and one the user may not open is not offered.
 */
@Component({
  selector: 'app-reports-hub-page',
  standalone: true,
  imports: [RouterLink, TranslateModule],
  templateUrl: './reports-hub.page.html',
  styleUrls: ['./reports-hub.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportsHubPage {
  private readonly auth = inject(AuthService);
  private readonly organization = inject(ActiveOrganizationService);

  readonly groups = computed<ReportGroup[]>(() => {
    // Read the user so the list follows a role change.
    this.auth.currentUser();
    return MODULES.filter((module) => !module.panelOf)
      .map((module) => ({
        moduleTitleKey: module.titleKey,
        reports: buildMenu(module)
          .filter((section) => section.group === 'analysis')
          .flatMap((section) => section.entries)
          .filter((entry) => entry.path !== '/reports')
          .filter((entry) => this.auth.hasPermissions(requiredPermissionsFor(entry.permission)))
          .map((entry) => ({ labelKey: entry.labelKey, link: this.organization.urlFor(entry.path) })),
      }))
      .filter((group) => group.reports.length > 0);
  });
}
