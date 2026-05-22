import { Component, ChangeDetectionStrategy, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LucideAngularModule, ChevronLeft, Edit, MoreVertical, Trash2 } from 'lucide-angular';
import { AccountsPayableService, VendorBill } from '../../../core/services/accounts-payable';
import { NotificationService } from '../../../core/services/notification';
import { EMPTY, Observable } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';

@Component({
  selector: 'app-vendor-bill-detail-page',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule],
  templateUrl: './detail.page.html',
  styleUrls: ['./detail.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VendorBillDetailPage implements OnInit {
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

  voidBill(): void {
    const billId = this.bill()?.id;
    if (!billId) return;

    // A real implementation should use a confirmation dialog.
    const reason = prompt('Por favor, introduce un motivo para la anulación:');
    if (!reason) return;

    this.isLoading.set(true);
    this.accountsPayableService.voidBill(billId, reason).subscribe({
      next: () => {
        this.notificationService.showSuccess('Factura anulada con éxito.');
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
    this.notificationService.showError('Factura no encontrada.');
  }
}
