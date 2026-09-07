import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LucideAngularModule, Check, X } from 'lucide-angular';
import { InboxShellComponent, InboxItem, InboxSection } from '../../shared/components/gestures';
import { PendingApproval, WorkflowsService } from '../../core/api/workflows.service';
import { NotificationService } from '../../core/services/notification';
import { DialogService } from '../../core/services/dialog.service';
import { FORMAT_PIPES } from '../../core/i18n/pipes/format.pipes';

/**
 * El centro de aprobaciones.
 *
 * ## Qué era esta pantalla
 *
 * Dos facturas y un reporte de gastos escritos a mano en el componente, tres pestañas y dos botones
 * —«Aprobar» y «Rechazar»— cuyo cuerpo entero era `console.log`. Dos de las tres pestañas dibujaban
 * `<li class="approval-item"> </li>`: una fila EN BLANCO por cada registro, así que tres gastos
 * pendientes se veían como tres renglones vacíos.
 *
 * El backend tenía, mientras tanto, `GET /workflows/approvals/pending`, `POST /workflows/approve/:id`
 * y `POST /workflows/reject/:id`, con segregación de funciones —quien solicita no puede aprobar—,
 * ámbito por empresa y registro de quién decidió qué en cada paso. La pantalla no lo llamaba.
 *
 * ## Por qué el rechazo pide un motivo
 *
 * Porque el servidor lo exige, y porque tiene razón: quien recibe el rechazo necesita saber qué
 * corregir. Se pide antes de enviar, no después de que el servidor devuelva un 400.
 */
@Component({
  selector: 'app-approvals-page',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule, InboxShellComponent, ...FORMAT_PIPES],
  templateUrl: './approvals.page.html',
  styleUrls: ['./approvals.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApprovalsPage implements OnInit {
  private readonly workflows = inject(WorkflowsService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);
  private readonly translate = inject(TranslateService);

  protected readonly ApproveIcon = Check;
  protected readonly RejectIcon = X;

  readonly pending = signal<PendingApproval[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  /** Id de la solicitud que se está decidiendo, para no enviar dos veces la misma decisión. */
  readonly deciding = signal<string | null>(null);

  /**
   * Un solo tramo, agrupado por tipo de documento.
   *
   * Las tres pestañas fijas —facturas, gastos, órdenes— eran una lista cerrada escrita a mano, y
   * el servidor devuelve el tipo de cada solicitud. Un tipo nuevo aparece aquí sin tocar nada.
   */
  readonly sections = computed<InboxSection[]>(() => {
    const byType = new Map<string, InboxItem[]>();
    for (const request of this.pending()) {
      const items = byType.get(request.documentType) ?? [];
      items.push(this.toItem(request));
      byType.set(request.documentType, items);
    }
    if (byType.size === 0) return [{ labelKey: 'APPROVALS.PENDIENTES', items: [] }];
    return [...byType.entries()].map(([documentType, items]) => ({
      labelKey: `APPROVALS.DOCUMENT_TYPE.${documentType}`,
      items,
    }));
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.workflows.pending().subscribe({
      next: (requests) => {
        this.pending.set(requests);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('APPROVALS.LOAD_FAILED');
        this.loading.set(false);
      },
    });
  }

  approve(requestId: string): void {
    this.decide(this.workflows.approve(requestId), requestId, 'APPROVALS.APROBADA');
  }

  async reject(requestId: string): Promise<void> {
    const reason = await this.dialog.prompt({
      title: 'APPROVALS.MOTIVO_RECHAZO_TITULO',
      message: 'APPROVALS.MOTIVO_RECHAZO_MENSAJE',
      confirmText: 'APPROVALS.RECHAZAR',
      variant: 'danger',
      minLength: 1,
    });
    if (reason === null) return;

    this.decide(this.workflows.reject(requestId, reason), requestId, 'APPROVALS.RECHAZADA');
  }

  private decide(
    request: ReturnType<WorkflowsService['approve']>,
    requestId: string,
    successKey: string,
  ): void {
    this.deciding.set(requestId);
    request.subscribe({
      next: () => {
        this.notifications.showSuccess(successKey);
        this.deciding.set(null);
        //  Se recarga en vez de quitar la fila a mano: una aprobación puede avanzar la solicitud
        //  al siguiente paso en lugar de cerrarla, y el servidor es quien sabe cuál de las dos.
        this.load();
      },
      error: (err: { error?: { message?: string } }) => {
        this.notifications.showError(
          err?.error?.message || this.translate.instant('APPROVALS.ERROR_DECIDIR'),
        );
        this.deciding.set(null);
      },
    });
  }

  private toItem(request: PendingApproval): InboxItem {
    return {
      id: request.id,
      title: this.translate.instant(`APPROVALS.DOCUMENT_TYPE.${request.documentType}`),
      detail: this.translate.instant('APPROVALS.PASO', { step: request.currentStep }),
      amount: String(request.amount),
      when: request.createdAt ?? undefined,
      //  Sin enlace: el documento vive en el módulo que lo emitió y esta solicitud no conoce su
      //  ruta. Inventarla produciría enlaces rotos, que es peor que no ofrecerlos.
      link: null,
    };
  }
}
