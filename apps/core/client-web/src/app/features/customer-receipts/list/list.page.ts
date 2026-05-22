import { Component, ChangeDetectionStrategy, signal, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle } from 'lucide-angular';
import { CustomerReceipt, CustomerReceiptsService } from '../../../core/services/customer-receipts';
import { NotificationService } from '../../../core/services/notification';
// import { CustomerReceipt, CustomerReceiptsService } from '../../../../core/services/customer-receipts';
// import { NotificationService } from '../../../../core/services/notification';
// import { CustomerReceiptsService, CustomerReceipt } from '../../../core/services/customer-receipts';
// import { NotificationService } from '../../../core/services/notification';

@Component({
  selector: 'app-customer-receipts-list-page',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule],
  templateUrl: './list.page.html',
  styleUrls: ['./list.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerReceiptsListPage implements OnInit {
  protected readonly PlusCircleIcon = PlusCircle;

  private receiptsService = inject(CustomerReceiptsService);
  private notificationService = inject(NotificationService);

  receipts = signal<CustomerReceipt[]>([]);
  isLoading = signal(true);

  ngOnInit(): void {
    this.loadReceipts();
  }

  loadReceipts(): void {
    this.isLoading.set(true);
    this.receiptsService.getReceipts().subscribe({
      next: (data) => {
        this.receipts.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.notificationService.showError('Could not load customer receipts.');
        this.isLoading.set(false);
      },
    });
  }
}
