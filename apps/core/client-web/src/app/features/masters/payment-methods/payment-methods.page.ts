import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, PlusCircle, Filter, MoreHorizontal } from 'lucide-angular';

interface PaymentMethod {
  id: string;
  name: string;
  type: 'Cash' | 'Bank Transfer' | 'Credit Card' | 'Check';
  isDefault: boolean;
}

@Component({
  selector: 'app-payment-methods-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './payment-methods.page.html',
  styleUrls: ['./payment-methods.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaymentMethodsPage {
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly FilterIcon = Filter;
  protected readonly MoreHorizontalIcon = MoreHorizontal;

  methods = signal<PaymentMethod[]>([
    { id: 'pm-01', name: 'Efectivo', type: 'Cash', isDefault: false },
    { id: 'pm-02', name: 'Transferencia Bancaria (USD)', type: 'Bank Transfer', isDefault: true },
    { id: 'pm-03', name: 'Tarjeta de Crédito / Débito', type: 'Credit Card', isDefault: false },
  ]);
}