import { Component, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { AuthInputComponent } from '../../../components/auth-input/auth-input.component';
import { LucideAngularModule, Building, Briefcase, Users, Globe, Camera } from 'lucide-angular';

@Component({
  selector: 'app-step-business',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    TranslateModule,
    AuthInputComponent,
    LucideAngularModule
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
  readonly CameraIcon = Camera;

  logoPreview = signal<string | null>(null);

  industries = [
    { id: 'TECHNOLOGY', label: 'REGISTER.INDUSTRIES.TECHNOLOGY' },
    { id: 'RETAIL', label: 'REGISTER.INDUSTRIES.RETAIL' },
    { id: 'MANUFACTURING', label: 'REGISTER.INDUSTRIES.MANUFACTURING' },
    { id: 'SERVICES', label: 'REGISTER.INDUSTRIES.SERVICES' },
    { id: 'HEALTHCARE', label: 'REGISTER.INDUSTRIES.HEALTHCARE' },
    { id: 'CONSTRUCTION', label: 'REGISTER.INDUSTRIES.CONSTRUCTION' },
    { id: 'OTHER', label: 'REGISTER.INDUSTRIES.OTHER' }
  ];

  companySizes = [
    { id: '1-10', label: '1-10' },
    { id: '11-50', label: '11-50' },
    { id: '51-200', label: '51-200' },
    { id: '201+', label: '201+' }
  ];

  onFileSelected(event: any) {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        this.logoPreview.set(reader.result as string);
        this.group.patchValue({ logoFile: file });
      };
      reader.readAsDataURL(file);
    }
  }

  getErrorMessage(controlName: string): string {
    const control = this.group.get(controlName);
    if (control?.touched && control?.errors) {
      if (control.errors['required']) return 'REGISTER.ERRORS.REQUIRED';
    }
    return '';
  }
}
