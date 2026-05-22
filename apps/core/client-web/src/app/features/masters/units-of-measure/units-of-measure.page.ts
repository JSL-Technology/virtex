import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle, Filter, MoreHorizontal } from 'lucide-angular';

// Interfaz para definir la estructura de una unidad de medida
interface UnitOfMeasure {
  id: string;
  name: string;
  symbol: string;
  type: 'Weight' | 'Quantity' | 'Volume' | 'Length';
}

@Component({
  selector: 'app-units-of-measure-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './units-of-measure.page.html',
  styleUrls: ['./units-of-measure.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnitsOfMeasurePage {
  // Íconos para la plantilla
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly FilterIcon = Filter;
  protected readonly MoreHorizontalIcon = MoreHorizontal;

  // Datos simulados para la demostración
  units = signal<UnitOfMeasure[]>([
    { id: 'uom-01', name: 'Kilogram', symbol: 'kg', type: 'Weight' },
    { id: 'uom-02', name: 'Gram', symbol: 'g', type: 'Weight' },
    { id: 'uom-03', name: 'Piece', symbol: 'pc', type: 'Quantity' },
    { id: 'uom-04', name: 'Unit', symbol: 'un', type: 'Quantity' },
    { id: 'uom-05', name: 'Liter', symbol: 'L', type: 'Volume' },
    { id: 'uom-06', name: 'Meter', symbol: 'm', type: 'Length' },
  ]);
}