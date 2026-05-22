import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, PlusCircle, MoreHorizontal } from 'lucide-angular';

interface PaymentTerm {
  id: string;
  name: string;
  days: number;
}

@Component({
  selector: 'app-payment-terms-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './payment-terms.page.html',
  styleUrls: ['./payment-terms.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaymentTermsPage {
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly MoreHorizontalIcon = MoreHorizontal;

  terms = signal<PaymentTerm[]>([
    { id: 'pt-01', name: 'Net 15', days: 15 },
    { id: 'pt-02', name: 'Net 30', days: 30 },
    { id: 'pt-03', name: 'Due on receipt', days: 0 },
    { id: 'pt-04', name: '50% Upfront, 50% on Delivery', days: 0 },
  ]);
}