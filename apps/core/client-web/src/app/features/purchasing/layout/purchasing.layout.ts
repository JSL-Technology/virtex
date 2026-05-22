import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { LucideAngularModule, ShoppingCart, FilePlus, Truck } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-purchasing-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, LucideAngularModule, TranslateModule],
  templateUrl: './purchasing.layout.html',
  styleUrls: ['../../documents/layout/documents.layout.scss'] // Reutiliza estilos
})
export class PurchasingLayout {
  protected readonly OrdersIcon = ShoppingCart;
  protected readonly RequisitionsIcon = FilePlus;
  protected readonly ReceiptsIcon = Truck;
}