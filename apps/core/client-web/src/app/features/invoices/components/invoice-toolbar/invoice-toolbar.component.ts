import { Component, ChangeDetectionStrategy, Input, Output, EventEmitter, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  ChevronFirst,
  ChevronLeft,
  ChevronRight,
  ChevronLast,
  Printer,
  Mail,
  Copy,
  FileDown,
  FileText,
  FileSpreadsheet,
  ArrowLeft,
  ArrowRight,
  Search,
  Settings,
  HelpCircle,
  FileUp,
  HandCoins,
  Ellipsis,
} from 'lucide-angular';
import { TranslateModule } from '@virteex/shared/ui-i18n';

@Component({
  selector: 'app-invoice-toolbar',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule],
  templateUrl: './invoice-toolbar.component.html',
  styleUrls: ['./invoice-toolbar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InvoiceToolbarComponent {
  // Navigation Icons
  protected readonly FirstIcon = ChevronFirst;
  protected readonly PrevIcon = ChevronLeft;
  protected readonly NextIcon = ChevronRight;
  protected readonly LastIcon = ChevronLast;

  // Action Icons
  protected readonly PrintIcon = Printer;
  protected readonly EmailIcon = Mail;
  protected readonly CopyIcon = Copy;
  protected readonly ExportIcon = FileDown;
  protected readonly PdfIcon = FileText;
  protected readonly WordIcon = FileText;
  protected readonly ExcelIcon = FileSpreadsheet;
  protected readonly BackIcon = ArrowLeft;
  protected readonly ForwardIcon = ArrowRight;
  protected readonly SearchIcon = Search;
  protected readonly ToolsIcon = Settings;
  protected readonly HelpIcon = HelpCircle;
  protected readonly ImportIcon = FileUp;
  protected readonly CollectIcon = HandCoins;
  protected readonly MoreIcon = Ellipsis;

  /** Whether the «Más» menu is open. */
  protected readonly moreOpen = signal(false);

  @Input() canNavigate = true;
  @Input() canCopy = true;
  /** «Copiar de» trae líneas de otro documento: solo tiene sentido en uno que aún se edita. */
  @Input() canCopyFrom = true;
  @Input() isNew = false;
  /** «Registrar cobro»: only for an issued document with something still owed. */
  @Input() canCollect = false;

  @Output() navigateRequested = new EventEmitter<'first' | 'prev' | 'next' | 'last'>();
  @Output() printRequested = new EventEmitter<void>();
  @Output() emailRequested = new EventEmitter<void>();
  @Output() exportRequested = new EventEmitter<'pdf' | 'excel'>();
  @Output() collectRequested = new EventEmitter<void>();
  @Output() copyFrom = new EventEmitter<void>();
  @Output() copyTo = new EventEmitter<void>();
  @Output() back = new EventEmitter<void>();
  @Output() forward = new EventEmitter<void>();
  @Output() searchRequested = new EventEmitter<void>();
  @Output() tools = new EventEmitter<void>();
  @Output() help = new EventEmitter<void>();

  onNavigate(direction: 'first' | 'prev' | 'next' | 'last') {
    this.navigateRequested.emit(direction);
  }

  /** Closes the «Más» menu once an entry was chosen. */
  protected pick(): void {
    this.moreOpen.set(false);
  }
}
