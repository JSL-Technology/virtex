import { Component, ChangeDetectionStrategy, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { LucideAngularModule, PlusCircle } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';

import { ListShellComponent } from '../../../shared/components/gestures';
import { Subsidiary, SubsidiariesService } from '../../../core/api/subsidiaries.service';
import { ErrorHandlerService } from '../../../core/services/error-handler.service';
import { Router } from '@angular/router';

/**
 * The branches and subsidiaries that make up the organisation.
 *
 * ## What this replaces
 *
 * Two invented offices — Oficina Principal on Av. Winston Churchill, Sucursal Santiago on Av. Juan
 * Pablo Duarte — with invented telephone numbers, held in a signal and never fetched. The same
 * product already showed the real structure under Settings › Company Structure, from
 * `/organizations/subsidiaries`, so it reported two branches in one screen and none in the other.
 *
 * Creating one stays where it already lived, in Company Structure: a subsidiary carries legal
 * identity — tax id, country, functional currency, consolidation mapping — and a second, thinner
 * create form here would be a second answer to the same question.
 */
@Component({
  selector: 'app-branches-page',
  standalone: true,
  imports: [LucideAngularModule, TranslateModule, ListShellComponent],
  templateUrl: './branches.page.html',
  styleUrls: ['./branches.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BranchesPage implements OnInit {
  protected readonly PlusCircleIcon = PlusCircle;

  private readonly api = inject(SubsidiariesService);
  private readonly errors = inject(ErrorHandlerService);
  private readonly router = inject(Router);

  readonly branches = signal<Subsidiary[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.list().subscribe({
      next: (list) => {
        this.branches.set(list ?? []);
        this.loading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.errors.keyFor(err));
        this.loading.set(false);
      },
    });
  }

  /**
   * Opens the screen that owns creating one, rather than offering a second, thinner form.
   *
   * Settings is a fragment on whatever URL is open — the same route the shell's own menu uses — so
   * this works from inside a window as well as from the router.
   */
  openCompanyStructure(): void {
    void this.router.navigate([], { fragment: 'settings/subsidiaries' });
  }
}
