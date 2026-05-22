import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, PlusCircle, Filter, MoreHorizontal, FileText, CheckSquare } from 'lucide-angular';

interface Checklist {
  id: string;
  name: string;
  type: 'Monthly' | 'Quarterly' | 'Annual';
  taskCount: number;
  assignedTo: string;
}

@Component({
  selector: 'app-checklist-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './checklist.page.html',
  styleUrls: ['./checklist.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChecklistPage {
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly FilterIcon = Filter;
  protected readonly MoreHorizontalIcon = MoreHorizontal;
  protected readonly ChecklistIcon = CheckSquare;

  checklists = signal<Checklist[]>([
    { id: 'CHK-01', name: 'Checklist de Cierre Mensual Estándar', type: 'Monthly', taskCount: 15, assignedTo: 'Equipo de Contabilidad' },
    { id: 'CHK-02', name: 'Checklist de Cierre Trimestral (Q3)', type: 'Quarterly', taskCount: 25, assignedTo: 'Carlos López' },
    { id: 'CHK-03', name: 'Checklist de Auditoría Anual 2025', type: 'Annual', taskCount: 42, assignedTo: 'Admin Principal' },
  ]);

  getTypeClass(type: Checklist['type']): string {
    if (type === 'Monthly') return 'type-monthly';
    if (type === 'Quarterly') return 'type-quarterly';
    return 'type-annual';
  }
}