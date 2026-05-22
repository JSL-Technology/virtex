import { Component, ChangeDetectionStrategy, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule, UploadCloud, ChevronLeft } from 'lucide-angular';
import { JournalEntries } from '../../../../core/services/journal-entries';
import { NotificationService } from '../../../../core/services/notification';

@Component({
  selector: 'app-journal-entry-import-page',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule],
  templateUrl: './import.page.html',
  styleUrls: ['./import.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JournalEntryImportPage {
  protected readonly BackIcon = ChevronLeft;
  protected readonly UploadIcon = UploadCloud;

  private journalEntriesService = inject(JournalEntries);
  private notificationService = inject(NotificationService);
  private router = inject(Router);

  selectedFile = signal<File | null>(null);
  previewData = signal<any | null>(null);
  batchId = signal<string | null>(null);
  isLoading = signal(false);
  error = signal<string | null>(null);

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFile.set(input.files[0]);
      this.error.set(null);
      this.previewData.set(null);
    }
  }

  previewImport(): void {
    const file = this.selectedFile();
    if (!file) {
      this.notificationService.showError('Por favor, selecciona un fichero para importar.');
      return;
    }

    this.isLoading.set(true);
    this.error.set(null);

    this.journalEntriesService.previewImport(file).subscribe({
      next: (data) => {
        this.previewData.set(data);
        this.batchId.set(data.batchId); // Store the batchId from the response
        this.isLoading.set(false);
      },
      error: (err) => {
        this.error.set('Error al previsualizar el fichero. Asegúrate de que el formato es correcto.');
        this.notificationService.showError(this.error()!);
        this.isLoading.set(false);
      }
    });
  }

  confirmImport(): void {
    const batch = this.batchId();
    if (!batch) {
      this.notificationService.showError('No hay una importación para confirmar.');
      return;
    }

    this.isLoading.set(true);
    this.journalEntriesService.confirmImport(batch).subscribe({
      next: () => {
        this.notificationService.showSuccess('Asientos contables importados con éxito.');
        this.router.navigate(['/accounting/journal-entries']);
      },
      error: (err) => {
        this.error.set('Ocurrió un error al confirmar la importación.');
        this.notificationService.showError(this.error()!);
        this.isLoading.set(false);
      }
    });
  }
}
