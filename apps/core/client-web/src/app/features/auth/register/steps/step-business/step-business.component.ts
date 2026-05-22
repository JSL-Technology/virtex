
import { Component, Input, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { LucideAngularModule, Building, Users, Globe, Briefcase } from 'lucide-angular';
// import { ConfigService, RegistrationOptions } from '../../../../../../shared/services/config.service';
import { ConfigService, RegistrationOptions } from '../../../../../shared/services/config.service';

@Component({
  selector: 'app-step-business',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LucideAngularModule],
  template: `
    <div [formGroup]="form" class="space-y-6">
      <div class="text-center mb-8">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
          <lucide-icon [img]="BriefcaseIcon" class="w-8 h-8"></lucide-icon>
        </div>
        <h2 class="text-2xl font-bold text-gray-900 dark:text-white">Perfil de Negocio</h2>
        <p class="mt-2 text-gray-600 dark:text-gray-400">
          Cuéntanos un poco más sobre tu empresa para personalizar tu experiencia.
        </p>
      </div>

      <div class="space-y-4">
        <!-- Company Name -->
        <div class="form-group">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Nombre de la Empresa (Razón Social)
          </label>
          <div class="relative">
            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
              <lucide-icon [img]="BuildingIcon" class="w-5 h-5"></lucide-icon>
            </div>
            <input
              type="text"
              formControlName="companyName"
              placeholder="Ej. Mi Empresa S.R.L."
              [readonly]="isReadOnly()"
              class="pl-10 w-full rounded-lg border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-primary focus:border-primary transition-colors disabled:bg-gray-100 disabled:text-gray-500"
              [class.border-red-500]="form.get('companyName')?.invalid && form.get('companyName')?.touched"
            />
          </div>
          <p *ngIf="isReadOnly()" class="text-xs text-gray-500 mt-1">
             Obtenido automáticamente de registros oficiales.
          </p>
        </div>

        <!-- Industry -->
        <div class="form-group">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Industria
          </label>
          <div class="relative">
            <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
              <lucide-icon [img]="GlobeIcon" class="w-5 h-5"></lucide-icon>
            </div>
            <select
              formControlName="industry"
              class="pl-10 w-full rounded-lg border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-primary focus:border-primary transition-colors"
            >
              <option value="" disabled selected>Selecciona una industria</option>
              <option *ngFor="let industry of industries()" [value]="industry">
                {{ industry }}
              </option>
            </select>
          </div>
        </div>

        <!-- Company Size -->
        <div class="form-group">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Tamaño de la Empresa
          </label>
          <div class="relative">
             <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
              <lucide-icon [img]="UsersIcon" class="w-5 h-5"></lucide-icon>
            </div>
            <select
              formControlName="numberOfEmployees"
              class="pl-10 w-full rounded-lg border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-primary focus:border-primary transition-colors"
            >
              <option value="" disabled selected>Selecciona el tamaño</option>
              <option *ngFor="let size of companySizes()" [value]="size">
                {{ size }}
              </option>
            </select>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
  `]
})
export class StepBusiness implements OnInit {
  @Input() form!: FormGroup;

  protected readonly BuildingIcon = Building;
  protected readonly UsersIcon = Users;
  protected readonly GlobeIcon = Globe;
  protected readonly BriefcaseIcon = Briefcase;

  private configService = inject(ConfigService);

  industries = signal<string[]>([]);
  companySizes = signal<string[]>([]);
  isReadOnly = signal(false);

  constructor() {}

  ngOnInit() {
      // Fetch industries and sizes dynamically
      this.configService.getRegistrationOptions().subscribe({
          next: (options: RegistrationOptions) => {
              this.industries.set(options.industries);
              this.companySizes.set(options.companySizes);
          },
          error: (err) => {
              console.error('Error fetching registration options:', err);
              // Fallback? Ideally retry or show error. For now, empty or basic list is better than crash.
              // We'll rely on the service to handle critical failures or the view to handle empty states.
          }
      });

      // Check if company name was already set (by previous step auto-fill)
      const currentName = this.form.get('companyName')?.value;
      if (currentName && currentName.length > 0) {
          this.isReadOnly.set(true);
      }

      this.form.get('companyName')?.valueChanges.subscribe(val => {
           if (val && val.length > 0 && this.form.pristine) {
               this.isReadOnly.set(true);
           }
      });
  }
}
