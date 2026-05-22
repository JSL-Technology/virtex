import { Component, Input, ChangeDetectionStrategy, signal } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, User, Phone, CaseSensitive, Image } from 'lucide-angular';
@Component({
  selector: 'app-step-account', standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LucideAngularModule],
  templateUrl: './step-account.html', styleUrls: ['./step-account.scss']
})
export class StepAccount {
  @Input() parentForm!: FormGroup;
  protected readonly UserIcon = User;
  protected readonly PhoneIcon = Phone;
  protected readonly JobIcon = CaseSensitive;
  protected readonly AvatarIcon = Image;
  avatarPreview = signal<string | ArrayBuffer | null>(null);

  onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      this.parentForm.patchValue({ avatarUrl: file });
      const reader = new FileReader();
      reader.onload = () => this.avatarPreview.set(reader.result);
      reader.readAsDataURL(file);
    }
  }
}