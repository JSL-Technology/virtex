import { Component, Input, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { RouterModule } from '@angular/router';
import { LucideAngularModule, Rocket, Check, AlertCircle } from 'lucide-angular';
import { BillingService } from '../../../../../core/services/billing';

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

  /** Real plans from the backend so prices/limits stay in sync with billing. */
  plans = computed<DisplayPlan[]>(() => {
    const list = this.billingService.plans();
    // "pro" is highlighted as recommended when present; otherwise the middle one.
    return list.map((p, i) => ({
      id: p.slug,
      name: p.name,
      price: `$${((p.monthlyPrice ?? 0) / 100).toFixed(0)}`,
      period: '/mes',
      features: this.buildFeatures(p),
      recommended: p.slug === 'pro' || (list.length === 3 && i === 1 && !list.some(x => x.slug === 'pro')),
    }));
  });

  plansState = this.billingService.plansState;

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
