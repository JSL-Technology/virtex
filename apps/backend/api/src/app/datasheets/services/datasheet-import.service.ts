
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../../inventory/entities/product.entity';
import { Invoice } from '../../invoices/entities/invoice.entity';
import { User } from '../../users/entities/user.entity/user.entity';

@Injectable()
export class DatasheetImportService {
  constructor(
    @InjectRepository(Product) private productRepo: Repository<Product>,
    @InjectRepository(Invoice) private invoiceRepo: Repository<Invoice>
  ) {}

  getAvailableModules() {
    return [
      { id: 'inventory', nameEn: 'Inventory', nameEs: 'Inventario', sets: ['products', 'movements'] },
      { id: 'sales', nameEn: 'Sales', nameEs: 'Ventas', sets: ['invoices', 'quotes'] },
      { id: 'customers', nameEn: 'Customers', nameEs: 'Clientes', sets: ['list'] }
    ];
  }

  async importData(module: string, set: string, columns: string[], filters: any, user: User) {
    let data: any[] = [];
    const orgId = user.organizationId;

    switch (`${module}:${set}`) {
      case 'inventory:products':
        data = await this.productRepo.find({ where: { organizationId: orgId } });
        break;
      case 'sales:invoices':
        data = await this.invoiceRepo.find({ where: { organizationId: orgId } });
        break;
      default:
        // Mocking for sets not yet fully integrated with entities in this service
        data = [
           { name: 'Item 1', reference: 'REF001', price: 100, stock: 10 },
           { name: 'Item 2', reference: 'REF002', price: 200, stock: 5 },
        ];
    }

    // Dynamic column filtering
    return data.map(item => {
      const row: any = {};
      columns.forEach(col => {
        // Map common property names if they differ in the entity
        const val = item[col] || item[col.toLowerCase()] || item[this.mapAlias(col)];
        row[col] = val !== undefined ? val : '';
      });
      return row;
    });
  }

  private mapAlias(col: string): string {
    const aliases: Record<string, string> = {
      'Nombre': 'name',
      'Referencia': 'reference',
      'Precio': 'price',
      'Stock': 'stock'
    };
    return aliases[col] || col;
  }
}
