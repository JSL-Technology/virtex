import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { LucideAngularModule, Users, Package, Tag, Banknote, Warehouse, Building, Landmark, Landmark as BranchesIcon, CreditCard, Clock } from 'lucide-angular';

@Component({
  selector: 'app-masters-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, LucideAngularModule],
  templateUrl: './masters.layout.html',
  styleUrls: ['./masters.layout.scss']
})
export class MastersLayout {
  protected readonly CustomersIcon = Users;
  protected readonly ProductsIcon = Package;
  protected readonly PriceListsIcon = Tag;
  protected readonly TaxesIcon = Banknote;
  protected readonly WarehousesIcon = Warehouse;
  protected readonly SuppliersIcon = Building;
  protected readonly UnitsIcon = Landmark; // Usando un ícono genérico
  protected readonly CurrenciesIcon = Banknote;
  protected readonly BanksIcon = Landmark;
  protected readonly BranchesIcon = BranchesIcon;
  protected readonly PaymentMethodsIcon = CreditCard;
  protected readonly PaymentTermsIcon = Clock;
}