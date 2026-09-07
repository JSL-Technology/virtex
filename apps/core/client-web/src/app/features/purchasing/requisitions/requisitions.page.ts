import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import { ListShellComponent } from '../../../shared/components/gestures';

interface Requisition {
  id: string;
  reqNumber: string;
  requester: string;
  department: string;
  date: string;
  total: number;
  status: 'Draft' | 'Pending Approval' | 'Approved' | 'Rejected';
}

@Component({
  selector: 'app-requisitions-page',
  standalone: true,
  imports: [RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent],
  templateUrl: './requisitions.page.html',
  styleUrls: ['./requisitions.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RequisitionsPage {
  protected readonly PlusCircleIcon = PlusCircle;

  requisitions = signal<Requisition[]>([
    { id: '1', reqNumber: 'REQ-001', requester: 'Ana Pérez', department: 'IT', date: 'Jul 29, 2025', total: 2500.00, status: 'Pending Approval' },
    { id: '2', reqNumber: 'REQ-002', requester: 'Carlos López', department: 'Marketing', date: 'Jul 28, 2025', total: 850.50, status: 'Approved' },
    { id: '3', reqNumber: 'REQ-003', requester: 'Laura Gómez', department: 'Operations', date: 'Jul 27, 2025', total: 300.00, status: 'Rejected' },
  ]);
  
  getStatusClass(status: Requisition['status']): string {
    switch(status) {
      case 'Approved': return 'status-approved';
      case 'Pending Approval': return 'status-pending';
      case 'Rejected': return 'status-rejected';
      default: return 'status-draft';
    }
  }
}