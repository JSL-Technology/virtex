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
}
