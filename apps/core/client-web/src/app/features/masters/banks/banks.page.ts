import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { LucideAngularModule, PlusCircle } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { ListShellComponent } from '../../../shared/components/gestures';

interface Bank {
  id: string;
  name: string;
  swiftCode: string;
  country: string;
}

@Component({
  selector: 'app-banks-page',
  standalone: true,
  imports: [LucideAngularModule, TranslateModule, ListShellComponent],
  templateUrl: './banks.page.html',
  styleUrls: ['./banks.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BanksPage {
  protected readonly PlusCircleIcon = PlusCircle;

  banks = signal<Bank[]>([
    { id: 'bank-01', name: 'Banco Popular Dominicano', swiftCode: 'BPDODOSX', country: 'Dominican Republic' },
    { id: 'bank-02', name: 'Banreservas', swiftCode: 'BRSDDOSD', country: 'Dominican Republic' },
    { id: 'bank-03', name: 'Scotiabank República Dominicana', swiftCode: 'NOSCDOSD', country: 'Dominican Republic' },
    { id: 'bank-04', name: 'Bank of America', swiftCode: 'BOFAUS3N', country: 'United States' },
  ]);
}