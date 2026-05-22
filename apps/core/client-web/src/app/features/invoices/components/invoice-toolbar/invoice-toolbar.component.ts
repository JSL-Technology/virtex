import { Component, ChangeDetectionStrategy, Input, Output, EventEmitter } from '@angular/core';
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
  FileUp
} from 'lucide-angular';

@Component({
  selector: 'app-invoice-toolbar',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
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

  @Input() canNavigate = true;
  @Input() canCopy = true;
  @Input() isNew = false;

  @Output() navigate = new EventEmitter<'first' | 'prev' | 'next' | 'last'>();
  @Output() print = new EventEmitter<void>();
  @Output() email = new EventEmitter<void>();
  @Output() export = new EventEmitter<'pdf' | 'word' | 'excel'>();
  @Output() copyFrom = new EventEmitter<void>();
  @Output() copyTo = new EventEmitter<void>();
  @Output() back = new EventEmitter<void>();
  @Output() forward = new EventEmitter<void>();
  @Output() search = new EventEmitter<void>();
  @Output() tools = new EventEmitter<void>();
  @Output() help = new EventEmitter<void>();

  onNavigate(direction: 'first' | 'prev' | 'next' | 'last') {
    this.navigate.emit(direction);
  }
}
