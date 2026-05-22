import { Component, ChangeDetectionStrategy, signal, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, Package, AlertCircle } from 'lucide-angular';

// Se puede mover a un archivo de modelos si se usa en más sitios
export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  stock: number;
  status: 'En Stock' | 'Bajo Stock' | 'Agotado';
  imageUrl: string;
}

@Component({
  selector: 'app-low-stock-products',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule],
  templateUrl: './low-stock-products.html',
  styleUrls: ['./low-stock-products.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LowStockProducts {
  // En una aplicación real, este @Input recibiría los datos desde un servicio
  // @Input() data: Partial<Product>[] = [];

  // Íconos para la plantilla
  protected readonly PackageIcon = Package;
  protected readonly AlertIcon = AlertCircle;

  // Usamos datos simulados para la demostración
  lowStockProducts = signal<Partial<Product>[]>([
    { id: '2', name: 'Mouse Inalámbrico Ergonómico', stock: 8 },
    { id: 'P005', name: 'Webcam HD 1080p', stock: 5 },
    { id: 'P007', name: 'Filtro de Privacidad 24"', stock: 3 },
    { id: 'P009', name: 'Hub USB-C 7-en-1', stock: 2 },
    { id: 'P011', name: 'Base para Laptop Ajustable', stock: 1 },
    { id: 'P003', name: 'Teclado Mecánico RGB', stock: 0 },
  ]);

  /**
   * Determina la clase CSS de severidad basada en la cantidad de stock.
   * @param stock - La cantidad actual en inventario.
   * @returns Una clase de CSS: 'critical', 'warning', o 'low'.
   */
  getStockSeverityClass(stock: number | undefined): string {
    if (stock === undefined) return 'low';
    if (stock === 0) return 'critical';
    if (stock <= 5) return 'warning';
    return 'low';
  }
}