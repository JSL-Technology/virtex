import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Save } from 'lucide-angular';
import { OrganizationService } from '../../../shared/service/organization.service';
import { NotificationService } from '../../../core/services/notification';

@Component({
  selector: 'app-company-profile-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LucideAngularModule],
  templateUrl: './company-profile.page.html',
  styleUrls: ['./company-profile.page.scss']
})
export class CompanyProfilePage implements OnInit {
  private fb = inject(FormBuilder);
  private organizationService = inject(OrganizationService);
  private notificationService = inject(NotificationService);

  protected readonly SaveIcon = Save;
  profileForm!: FormGroup;
  isLoading = false;

  ngOnInit(): void {
    this.profileForm = this.fb.group({
      legalName: ['', Validators.required],
      industry: [''],
      taxId: ['', Validators.required],
      address: [''],
      city: [''],
      country: ['', Validators.required],
      phone: ['', Validators.required],
      website: [''],
    });

    this.loadCompanyData();
  }

  loadCompanyData(): void {
    this.isLoading = true;
    this.organizationService.getProfile().subscribe({
      next: (data) => {
        this.profileForm.patchValue(data);
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error loading company profile', error);
        this.notificationService.showError('Error cargando el perfil de la empresa');
        this.isLoading = false;
      }
    });
  }

  saveProfile(): void {
    if (this.profileForm.valid) {
      this.isLoading = true;
      this.organizationService.updateProfile(this.profileForm.value).subscribe({
        next: (data) => {
          this.notificationService.showSuccess('Perfil actualizado correctamente');
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Error updating profile', error);
          this.notificationService.showError('Error actualizando el perfil');
          this.isLoading = false;
        }
      });
    }
  }
}
