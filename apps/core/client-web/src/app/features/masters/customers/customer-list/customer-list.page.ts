import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle, Filter, MoreHorizontal } from 'lucide-angular';

export interface Customer {
  id: string;
  name: string;
  taxId: string;
  email: string;
  phone: string;
  city: string;
  country: string;
}

@Component({
  selector: 'app-customer-list-page',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule],
  templateUrl: './customer-list.page.html',
  styleUrls: ['./customer-list.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerListPage {
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly FilterIcon = Filter;
  protected readonly MoreHorizontalIcon = MoreHorizontal;

  customers = signal<Customer[]>([
    { id: '1', name: 'Proyectos Globales S.A.', taxId: '130-00000-1', email: 'finanzas@proyectosglobales.com', phone: '809-555-1234', city: 'Santo Domingo', country: 'DO' },
    { id: '2', name: 'Cliente Ejemplo S.R.L.', taxId: '131-11111-2', email: 'contacto@cliente.com', phone: '809-555-5678', city: 'Santiago', country: 'DO' },
    { id: '3', name: 'Servicios Creativos', taxId: '101-22222-3', email: 'info@servicioscreativos.do', phone: '809-555-9012', city: 'Santo Domingo', country: 'DO' },
  ]);
}