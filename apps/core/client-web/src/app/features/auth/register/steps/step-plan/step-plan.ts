import { Component, Input, effect, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { RouterModule } from '@angular/router';
import { LucideAngularModule, Rocket, Check, AlertCircle } from 'lucide-angular';
import { BillingService } from '../../../../../core/services/billing';
import { formatPlanPrice } from '../../../../../core/models/plan.model';
import { CountryService } from '../../../../../core/services/country.service';
import { LanguageService } from '../../../../../core/services/language';

interface DisplayPlan {
  id: string; // slug
  name: string;
  price: string;
  period: string;
  features: string[];
  recommended: boolean;
}

@Component({
  selector: 'app-step-plan',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    TranslateModule,
    RouterModule,
    LucideAngularModule
  ],
  templateUrl: './step-plan.html',
  styleUrls: ['./step-plan.scss']
})
export class StepPlan {
  @Input() group!: FormGroup;

  readonly RocketIcon = Rocket;
  readonly CheckIcon = Check;
  readonly AlertCircleIcon = AlertCircle;

  private billingService = inject(BillingService);
  private countryService = inject(CountryService);
  private languageService = inject(LanguageService);

  constructor() {
    // Re-quote whenever the market changes. The catalogue is priced per country, so a plan card
    // rendered before the country was chosen is a price for a different market.
    effect(() => {
      const code = this.countryService.currentCountry()?.countryCode;
      if (code) this.billingService.loadPlans(code);
    });
  }

  /** Real plans from the backend so prices/limits stay in sync with billing. */
  plans = computed<DisplayPlan[]>(() => {
    const list = this.billingService.plans();
    // "pro" is highlighted as recommended when present; otherwise the middle one.
    return list.map((p, i) => ({
      id: p.slug,
      name: p.name,
      // Formatted from the currency the server quoted, in the user's locale. It used to be
      // `$` + amount/100 regardless of market, so a Colombian saw "$49" and was billed in pesos,
      // and a Chilean price would have been shown a hundred times too small.
      price: formatPlanPrice(p, this.localeFor(p.currency)),
      period: 'REGISTER.STEPS.PLAN.PER_MONTH',
      features: this.buildFeatures(p),
      recommended: p.slug === 'pro' || (list.length === 3 && i === 1 && !list.some(x => x.slug === 'pro')),
    }));
  });

  plansState = this.billingService.plansState;

  /** BCP 47 tag for formatting: the country's own locale where known, else the UI language. */
  private localeFor(currency: string): string {
    const config = this.countryService.currentCountry();
    if (config?.currency === currency && config.locale) return config.locale;
    return this.languageService.currentLang() ?? 'es';
  }

  private buildFeatures(p: { description?: string; limits?: { resource: string; limit: number; period: string }[] }): string[] {
    const features: string[] = [];
    if (p.description) features.push(p.description);
    for (const limit of p.limits ?? []) {
      const resource = limit.resource.replace('_', ' ');
      if (limit.limit === -1) {
        features.push(`${resource} ilimitad@s`);
      } else {
        features.push(`${limit.limit} ${resource}/${limit.period === 'monthly' ? 'mes' : 'siempre'}`);
      }
    }
    return features;
  }

  retry(): void {
    this.billingService.loadPlans();
  }

  selectPlan(planId: string) {
    this.group.patchValue({ selectedPlanId: planId });
  }

  isSelected(planId: string) {
    return this.group.get('selectedPlanId')?.value === planId;
  }
}
