import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Building2, CalendarCheck, CalendarX, Coins, Wifi, WifiOff } from 'lucide-angular';
import { AuthService } from '../../core/services/auth';
import { StatusBarService } from './status-bar.service';

/**
 * The state of the world, always visible.
 *
 * ## Why this earns a permanent strip
 *
 * The most common frustration in an ERP is attempting work the system will reject using a fact it
 * already had. Someone who can see "period 2026-08 closed" does not try to post into August; today
 * they find out by filling in a form and pressing a button.
 *
 * It shows what changes the answer to "can I do this right now": the company being acted for, the
 * accounting period and whether it is open, the base currency, and the connection. None of it is
 * decoration — each line is a precondition of ordinary work, surfaced before the work rather than
 * after it fails.
 */
@Component({
  selector: 'app-status-bar',
  standalone: true,
  imports: [CommonModule, TranslateModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './status-bar.component.html',
  styleUrls: ['./status-bar.component.scss'],
})
export class StatusBarComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly status = inject(StatusBarService);

  protected readonly CompanyIcon = Building2;
  protected readonly OpenIcon = CalendarCheck;
  protected readonly ClosedIcon = CalendarX;
  protected readonly CurrencyIcon = Coins;
  protected readonly OnlineIcon = Wifi;
  protected readonly OfflineIcon = WifiOff;

  protected readonly organization = computed(() => this.auth.currentUser()?.organization ?? null);
  protected readonly period = this.status.period;

  protected readonly periodOpen = computed(() => this.period()?.status === 'OPEN');

  /** `2026-09` — the month, not a formatted date: the reader's locale spells it, not the server. */
  protected readonly periodLabel = computed(() => this.period()?.startDate?.slice(0, 7) ?? null);

  protected readonly online = computed(() => navigator.onLine);

  ngOnInit(): void {
    this.status.refresh();
  }
}
