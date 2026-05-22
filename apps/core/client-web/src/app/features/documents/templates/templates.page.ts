import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, PlusCircle, FileText } from 'lucide-angular';

interface Template {
  id: string;
  name: string;
  type: 'Invoice' | 'Quote' | 'Email';
  lastModified: string;
}

@Component({
  selector: 'app-templates-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './templates.page.html',
  styleUrls: ['./templates.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemplatesPage {
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly FileIcon = FileText;

  templates = signal<Template[]>([
    { id: 'TPL-01', name: 'Plantilla de Factura Estándar', type: 'Invoice', lastModified: 'Jun 10, 2025' },
    { id: 'TPL-02', name: 'Plantilla de Cotización de Servicios', type: 'Quote', lastModified: 'May 28, 2025' },
    { id: 'TPL-03', name: 'Email de Recordatorio de Pago', type: 'Email', lastModified: 'Jul 15, 2025' },
  ]);
}