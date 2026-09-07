import { Component, ChangeDetectionStrategy, signal, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, Folder, File, Upload } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { ListShellComponent } from '../../../shared/components/gestures';

type FileItemType = 'folder' | 'pdf' | 'spreadsheet' | 'image' | 'document';

interface FileItem {
  id: string;
  name: string;
  type: FileItemType;
  size: string;
  modifiedDate: string;
  icon: any;
}

@Component({
  selector: 'app-repository-page',
  standalone: true,
  imports: [LucideAngularModule, TranslateModule, ListShellComponent],
  templateUrl: './repository.page.html',
  styleUrls: ['./repository.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositoryPage {
  protected readonly FolderIcon = Folder;
  protected readonly FileIcon = File;
  protected readonly UploadIcon = Upload;

  currentPath = signal('Home');

  /**
   * El buscador de la carpeta.
   *
   * Existía como `<input>` sin `[(ngModel)]` ni manejador: se podía escribir en él y no filtraba
   * nada. Un control que no hace nada enseña a desconfiar de los que sí lo hacen.
   */
  readonly search = signal('');

  private readonly allFiles = signal<FileItem[]>([
    { id: 'F01', name: 'Facturas de Proveedores', type: 'folder', size: '15 archivos', modifiedDate: 'Jul 25, 2025', icon: Folder },
    { id: 'F02', name: 'Contratos de Clientes', type: 'folder', size: '8 archivos', modifiedDate: 'Jul 22, 2025', icon: Folder },
    { id: 'D01', name: 'Reporte_Ventas_Q2_2025.pdf', type: 'pdf', size: '2.1 MB', modifiedDate: 'Jul 20, 2025', icon: File },
    { id: 'D02', name: 'Balance_General_2024.xlsx', type: 'spreadsheet', size: '850 KB', modifiedDate: 'Jun 15, 2025', icon: File },
    { id: 'D03', name: 'Logo_Empresa_Vector.svg', type: 'image', size: '120 KB', modifiedDate: 'May 02, 2025', icon: File },
    { id: 'D04', name: 'Políticas Internas.docx', type: 'document', size: '450 KB', modifiedDate: 'Apr 18, 2025', icon: File },
  ]);

  readonly files = computed(() => {
    const term = this.search().trim().toLowerCase();
    if (!term) return this.allFiles();
    return this.allFiles().filter((f) => f.name.toLowerCase().includes(term));
  });

  getIconForFileType(type: FileItemType): any {
    if (type === 'folder') {
      return this.FolderIcon;
    }
    return this.FileIcon;
  }
}