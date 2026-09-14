import { Component, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { AuthInputComponent } from '../../../components/auth-input/auth-input.component';
import { LucideAngularModule, Building, Briefcase, Users, Globe, Camera } from 'lucide-angular';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';

@Component({
  selector: 'app-step-business',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    TranslateModule,
    AuthInputComponent,
    LucideAngularModule,
    ...VX_FORM_A11Y,
  ],
  templateUrl: './step-business.html',
  styleUrls: ['./step-business.scss']
})
export class StepBusiness {
  @Input() group!: FormGroup;

  readonly BuildingIcon = Building;
  readonly BriefcaseIcon = Briefcase;
  readonly UsersIcon = Users;
  readonly GlobeIcon = Globe;

  industries = [
    { id: 'TECHNOLOGY', label: 'register.industries.technology' },
    { id: 'RETAIL', label: 'register.industries.retail' },
    { id: 'MANUFACTURING', label: 'register.industries.manufacturing' },
    { id: 'SERVICES', label: 'register.industries.services' },
    { id: 'HEALTHCARE', label: 'register.industries.healthcare' },
    { id: 'CONSTRUCTION', label: 'register.industries.construction' },
    { id: 'OTHER', label: 'register.industries.other' }
  ];

  companySizes = [
    { id: '1-10', label: '1-10' },
    { id: '11-50', label: '11-50' },
    { id: '51-200', label: '51-200' },
    { id: '201+', label: '201+' }
  ];


  getErrorMessage(controlName: string): string {
    const control = this.group.get(controlName);
    if (control?.touched && control?.errors) {
      if (control.errors['required']) return 'register.errors.required';
    }
    return '';
  }
}
