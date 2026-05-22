import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, PlusCircle, Filter, MoreHorizontal, User, Calendar } from 'lucide-angular';

type TaskStatus = 'Pending' | 'In Progress' | 'Completed';

interface ClosingTask {
  id: string;
  name: string;
  checklist: string;
  assignedTo: string;
  dueDate: string;
  status: TaskStatus;
}

@Component({
  selector: 'app-tasks-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './tasks.page.html',
  styleUrls: ['./tasks.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TasksPage {
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly FilterIcon = Filter;
  protected readonly MoreHorizontalIcon = MoreHorizontal;
  protected readonly UserIcon = User;
  protected readonly CalendarIcon = Calendar;

  tasks = signal<ClosingTask[]>([
    { id: 'TSK-01', name: 'Reconcile Main Bank Account', checklist: 'Cierre Mensual Estándar', assignedTo: 'Carlos López', dueDate: 'Jul 28, 2025', status: 'In Progress' },
    { id: 'TSK-02', name: 'Post All Pending Journal Entries', checklist: 'Cierre Mensual Estándar', assignedTo: 'Ana Pérez', dueDate: 'Jul 29, 2025', status: 'Pending' },
    { id: 'TSK-03', name: 'Review Fixed Assets Depreciation', checklist: 'Cierre Mensual Estándar', assignedTo: 'Admin Principal', dueDate: 'Jul 30, 2025', status: 'Pending' },
    { id: 'TSK-04', name: 'Final Inventory Count', checklist: 'Cierre Anual 2025', assignedTo: 'Inventory Team', dueDate: 'Dec 15, 2025', status: 'Pending' },
  ]);

  getStatusClass(status: TaskStatus): string {
    if (status === 'Completed') return 'status-completed';
    if (status === 'In Progress') return 'status-in-progress';
    return 'status-pending';
  }
}