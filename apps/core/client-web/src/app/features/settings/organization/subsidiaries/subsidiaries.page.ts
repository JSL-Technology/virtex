import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Building, Plus, MoreVertical, X } from 'lucide-angular';
import { SubsidiariesService, Subsidiary, CreateSubsidiaryDto } from './subsidiaries.service';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

@Component({
  selector: 'app-subsidiaries',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, ReactiveFormsModule],
  templateUrl: './subsidiaries.page.html',
  styleUrls: ['./subsidiaries.page.scss']
})
export class SubsidiariesPage implements OnInit {
  // Icons
  protected readonly BuildingIcon = Building;
  protected readonly PlusIcon = Plus;
  protected readonly MoreVerticalIcon = MoreVertical;
  protected readonly XIcon = X;

  subsidiaries: Subsidiary[] = [];
  loading = true;
  showModal = false;
  submitting = false;
  createForm: FormGroup;

  constructor(
    private subsidiariesService: SubsidiariesService,
    private fb: FormBuilder
  ) {
    this.createForm = this.fb.group({
      legalName: ['', [Validators.required]],
      taxId: ['', [Validators.required]],
      country: ['', [Validators.required]],
      ownership: [100, [Validators.required, Validators.min(0), Validators.max(100)]]
    });
  }

  ngOnInit() {
    this.loadSubsidiaries();
  }

  loadSubsidiaries() {
    this.loading = true;
    this.subsidiariesService.getSubsidiaries().subscribe({
      next: (data) => {
        this.subsidiaries = data;
        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading subsidiaries:', err);
        this.loading = false;
      }
    });
  }

  openCreateModal() {
    this.showModal = true;
    this.createForm.reset({ ownership: 100 });
  }

  closeModal() {
    this.showModal = false;
  }

  onSubmit() {
    if (this.createForm.valid) {
      this.submitting = true;
      const data: CreateSubsidiaryDto = this.createForm.value;

      this.subsidiariesService.createSubsidiary(data).subscribe({
        next: (newSub) => {
          this.subsidiaries.push(newSub);
          this.closeModal();
          this.submitting = false;
        },
        error: (err) => {
          console.error('Error creating subsidiary:', err);
          this.submitting = false;
          // Handle error (show toast, etc.)
        }
      });
    }
  }
}
