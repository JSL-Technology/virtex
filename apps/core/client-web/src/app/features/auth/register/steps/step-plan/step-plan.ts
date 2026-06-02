import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { RouterModule } from '@angular/router';
import { LucideAngularModule, Rocket, Check, AlertCircle } from 'lucide-angular';

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

  plans = [
    {
      id: 'starter',
      name: 'Starter',
      price: '$19',
      period: '/mes',
      features: ['Hasta 10 facturas/mes', '2 usuarios', 'Soporte básico', 'Reportes estándar'],
      recommended: false
    },
    {
      id: 'pro',
      name: 'Professional',
      price: '$49',
      period: '/mes',
      features: ['Hasta 100 facturas/mes', '10 usuarios', 'Soporte prioritario', 'Reportes avanzados', 'Multi-moneda'],
      recommended: true
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      price: '$99',
      period: '/mes',
      features: ['Facturas ilimitadas', 'Usuarios ilimitados', 'Soporte 24/7', 'API access', 'Personalización'],
      recommended: false
    }
  ];

  selectPlan(planId: string) {
    this.group.patchValue({ selectedPlanId: planId });
  }

  isSelected(planId: string) {
    return this.group.get('selectedPlanId')?.value === planId;
  }
}
