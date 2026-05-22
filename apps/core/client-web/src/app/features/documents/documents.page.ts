// import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
// import { CommonModule } from '@angular/common';
// import { LucideAngularModule, Folder, File, Upload, Search, MoreHorizontal } from 'lucide-angular';

// // Tipos de datos para la página
// type FileItemType = 'folder' | 'pdf' | 'image' | 'spreadsheet' | 'document';

// interface FileItem {
//   id: string;
//   name: string;
//   type: FileItemType;
//   size: string;
//   modifiedDate: string;
//   icon: any;
// }

// @Component({
//   selector: 'app-documents-page',
//   standalone: true,
//   imports: [CommonModule, LucideAngularModule],
//   templateUrl: './documents.page.html',
//   styleUrls: ['./documents.page.scss'],
//   changeDetection: ChangeDetectionStrategy.OnPush,
// })
// export class DocumentsPage {
//   // Íconos
//   protected readonly FolderIcon = Folder;
//   protected readonly FileIcon = File;
//   protected readonly UploadIcon = Upload;
//   protected readonly SearchIcon = Search;
//   protected readonly MoreIcon = MoreHorizontal;

//   // Estado
//   currentPath = signal('Raíz');

//   // Datos simulados
//   files = signal<FileItem[]>([
//     { id: 'F01', name: 'Facturas de Proveedores', type: 'folder', size: '15 archivos', modifiedDate: 'Jul 25, 2025', icon: Folder },
//     { id: 'F02', name: 'Contratos de Clientes', type: 'folder', size: '8 archivos', modifiedDate: 'Jul 22, 2025', icon: Folder },
//     { id: 'D01', name: 'Reporte_Ventas_Q2_2025.pdf', type: 'pdf', size: '2.1 MB', modifiedDate: 'Jul 20, 2025', icon: File },
//     { id: 'D02', name: 'Balance_General_2024.xlsx', type: 'spreadsheet', size: '850 KB', modifiedDate: 'Jun 15, 2025', icon: File },
//     { id: 'D03', name: 'Logo_Empresa_Vector.svg', type: 'image', size: '120 KB', modifiedDate: 'May 02, 2025', icon: File },
//   ]);

//   getIconForFileType(type: FileItemType): any {
//     // En una app real, aquí podrías tener íconos diferentes para cada tipo de archivo
//     return type === 'folder' ? this.FolderIcon : this.FileIcon;
//   }
// }