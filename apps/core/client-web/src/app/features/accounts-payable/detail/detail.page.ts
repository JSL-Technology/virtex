import { Component, ChangeDetectionStrategy, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogService } from '../../../core/services/dialog.service';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideAngularModule, ChevronLeft, Edit, MoreVertical, Trash2 } from 'lucide-angular';
import { AccountsPayableService, VendorBill } from '../../../core/services/accounts-payable';
import { NotificationService } from '../../../core/services/notification';
import { EMPTY, Observable } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';

@Component({
  selector: 'app-vendor-bill-detail-page',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './detail.page.html',
  styleUrls: ['./detail.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VendorBillDetailPage implements OnInit {
  private readonly dialog = inject(DialogService);
  protected readonly BackIcon = ChevronLeft;
  protected readonly EditIcon = Edit;
  protected readonly MoreIcon = MoreVertical;
  protected readonly VoidIcon = Trash2;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private accountsPayableService = inject(AccountsPayableService);
  private notificationService = inject(NotificationService);

  bill = signal<VendorBill | null>(null);
  isLoading = signal(true);
  error = signal<string | null>(null);

  ngOnInit(): void {
    this.route.paramMap.pipe(
      switchMap(params => {
        const id = params.get('id');
        if (id) {
          return this.accountsPayableService.getVendorBillById(id);
        }
        this.handleNotFound();
        return EMPTY;
      }),
      catchError(err => {
        this.handleError('No se pudo cargar la factura del proveedor.');
        return EMPTY;
      })
    ).subscribe(data => {
      this.bill.set(data);
      this.isLoading.set(false);
    });
  }

  async voidBill(): Promise<void> {
    const billId = this.bill()?.id;
    if (!billId) return;

    const reason = await this.dialog.prompt({
      title: 'DIALOG.VOID_BILL.TITLE',
      message: 'DIALOG.VOID_BILL.MESSAGE',
      placeholder: 'DIALOG.VOID_BILL.PLACEHOLDER',
      minLength: 10,
      tooShort: 'DIALOG.VOID_BILL.TOO_SHORT',
      variant: 'danger',
    });
    if (!reason) return;

    this.isLoading.set(true);
    this.accountsPayableService.voidBill(billId, reason).subscribe({
      next: () => {
        this.notificationService.showSuccess('ACCOUNTS_PAYABLE.DETAIL.FACTURA_ANULADA_EXITO');
        // Optionally, refresh data or navigate away
        this.router.navigate(['/accounts-payable']);
      },
      error: (err) => {
        this.handleError('Error al anular la factura.');
      }
    });
  }

  private handleError(message: string): void {
    this.error.set(message);
    this.notificationService.showError(message);
    this.isLoading.set(false);
  }

  private handleNotFound(): void {
    this.router.navigate(['/accounts-payable']);
    this.notificationService.showError('ACCOUNTS_PAYABLE.DETAIL.FACTURA_ENCONTRADA');
  }
}
