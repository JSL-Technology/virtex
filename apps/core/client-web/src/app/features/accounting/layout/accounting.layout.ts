import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, BookCopy, BookOpenCheck, CalendarDays, BookText, Library, FileCheck2, ShieldCheck, Users, BarChart3 } from 'lucide-angular';

@Component({
  selector: 'app-accounting-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, LucideAngularModule, TranslateModule],
  templateUrl: './accounting.layout.html',
  styleUrls: ['../../documents/layout/documents.layout.scss', './accounting.layout.scss'] // Reutiliza estilos
})
export class AccountingLayout {
  protected readonly ChartOfAccountsIcon = BookCopy;
  protected readonly JournalEntriesIcon = BookOpenCheck;
  protected readonly PeriodsIcon = CalendarDays;
  protected readonly DailyJournalIcon = BookText; // ✅ Nuevo ícono
  protected readonly GeneralLedgerIcon = Library; // ✅ Nuevo ícono
  protected readonly ClosingIcon = FileCheck2; // ✅ Nuevo ícono
  protected readonly ReconciliationIcon = ShieldCheck; // ✅ Nuevo ícono
  protected readonly SubsidiaryLedgersIcon = Users; // ✅ Nuevo ícono
  protected readonly VarianceAnalysisIcon = BarChart3; // ✅ Nuevo ícono
}