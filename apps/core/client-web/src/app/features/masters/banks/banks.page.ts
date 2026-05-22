import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle, Filter, MoreHorizontal } from 'lucide-angular';

interface Bank {
  id: string;
  name: string;
  swiftCode: string;
  country: string;
}

@Component({
  selector: 'app-banks-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './banks.page.html',
  styleUrls: ['./banks.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BanksPage {
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly FilterIcon = Filter;
  protected readonly MoreHorizontalIcon = MoreHorizontal;

  banks = signal<Bank[]>([
    { id: 'bank-01', name: 'Banco Popular Dominicano', swiftCode: 'BPDODOSX', country: 'Dominican Republic' },
    { id: 'bank-02', name: 'Banreservas', swiftCode: 'BRSDDOSD', country: 'Dominican Republic' },
    { id: 'bank-03', name: 'Scotiabank República Dominicana', swiftCode: 'NOSCDOSD', country: 'Dominican Republic' },
    { id: 'bank-04', name: 'Bank of America', swiftCode: 'BOFAUS3N', country: 'United States' },
  ]);
}