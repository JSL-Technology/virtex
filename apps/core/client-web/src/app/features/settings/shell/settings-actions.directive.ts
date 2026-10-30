import { Directive, OnDestroy, OnInit, TemplateRef, inject } from '@angular/core';
import { SettingsShellService } from './settings-shell.service';

/**
 * `<ng-template vxSettingsActions>…</ng-template>`: the section's own actions — «New branch»,
 * «Invite user» — drawn by the shell beside the section's title, where every section's actions
 * now are. They used to sit in five different places depending on who built the section.
 */
@Directive({ selector: 'ng-template[vxSettingsActions]', standalone: true })
export class SettingsActionsDirective implements OnInit, OnDestroy {
  private readonly template = inject(TemplateRef);
  private readonly shell = inject(SettingsShellService, { optional: true });

  ngOnInit(): void {
    this.shell?.actions.set(this.template);
  }

  ngOnDestroy(): void {
    if (this.shell?.actions() === this.template) this.shell.actions.set(null);
  }
}
