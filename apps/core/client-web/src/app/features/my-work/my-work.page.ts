import { Component, ChangeDetectionStrategy, signal, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, Check, Clock, Bell, Key } from 'lucide-angular';
import { MyWorkService, WorkItem } from './my-work.service';
import { AuthService } from '../../core/services/auth';

type WorkItemStatus = 'pending' | 'in-progress' | 'completed';
type WorkItemType = 'tasks' | 'approvals' | 'notifications' | 'security';

@Component({
  selector: 'app-my-work-page',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule],
  templateUrl: './my-work.page.html',
  styleUrls: ['./my-work.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyWorkPage implements OnInit {
  private myWorkService = inject(MyWorkService);
  private authService = inject(AuthService);

  protected readonly TaskIcon = Check;
  protected readonly ApprovalIcon = Clock;
  protected readonly NotificationIcon = Bell;
  protected readonly SecurityIcon = Key;

  activeTab = signal<WorkItemType>('tasks');

  tasks = signal<WorkItem[]>([]);
  approvals = signal<WorkItem[]>([]);
  notifications = signal<WorkItem[]>([]);

  ngOnInit(): void {
    this.loadWorkItems();
  }

  loadWorkItems(): void {
    this.myWorkService.getWorkItems().subscribe(data => {
      this.tasks.set(data.tasks);
      this.approvals.set(data.approvals);
      this.notifications.set(data.notifications);
    });
  }

  setActiveTab(tab: WorkItemType): void {
    this.activeTab.set(tab);
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'pending': return 'status-pending';
      case 'in-progress': return 'status-in-progress';
      case 'completed': return 'status-completed';
      default: return '';
    }
  }

  async registerPasskey() {
    await this.authService.registerPasskey();
  }
}