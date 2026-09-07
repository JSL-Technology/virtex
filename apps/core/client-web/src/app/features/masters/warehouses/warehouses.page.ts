import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { LucideAngularModule, PlusCircle } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { ListShellComponent } from '../../../shared/components/gestures';

interface Warehouse {
  id: string;
  name: string;
  location: string;
  manager: string;
  isActive: boolean;
}

@Component({
  selector: 'app-warehouses-page',
  standalone: true,
  imports: [LucideAngularModule, TranslateModule, ListShellComponent],
  templateUrl: './warehouses.page.html',
  styleUrls: ['./warehouses.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WarehousesPage {
  protected readonly PlusCircleIcon = PlusCircle;

  warehouses = signal<Warehouse[]>([
    { id: 'WH-01', name: 'Almacén Principal', location: 'Santo Domingo, DN', manager: 'Carlos Pérez', isActive: true },
    { id: 'WH-02', name: 'Almacén de Santiago', location: 'Santiago de los Caballeros', manager: 'María Rodríguez', isActive: true },
    { id: 'WH-03', name: 'Almacén Zona Franca', location: 'San Pedro de Macorís', manager: 'Ana Gómez', isActive: false },
  ]);
}