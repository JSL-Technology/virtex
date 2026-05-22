import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle, Filter, MoreHorizontal } from 'lucide-angular';

// Interfaz para definir la estructura de una divisa
interface Currency {
  id: string;
  name: string;
  code: string; // ISO 4217 Code
  symbol: string;
  isBase: boolean;
}

@Component({
  selector: 'app-currencies-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './currencies.page.html',
  styleUrls: ['./currencies.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CurrenciesPage {
  // Íconos para la plantilla
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly FilterIcon = Filter;
  protected readonly MoreHorizontalIcon = MoreHorizontal;

  // Datos simulados para la demostración
  currencies = signal<Currency[]>([
    { id: 'curr-01', name: 'Dominican Peso', code: 'DOP', symbol: 'RD$', isBase: true },
    { id: 'curr-02', name: 'United States Dollar', code: 'USD', symbol: '$', isBase: false },
    { id: 'curr-03', name: 'Euro', code: 'EUR', symbol: '€', isBase: false },
  ]);
}