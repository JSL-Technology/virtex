import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Una solicitud de aprobación pendiente, tal como la devuelve `GET /workflows/approvals/pending`. */
export interface PendingApproval {
  id: string;
  documentId: string;
  documentType: string;
  status: string;
  currentStep: number;
  amount: number;
  requestedByUserId: string | null;
  createdAt?: string;
}

/**
 * El centro de aprobaciones, contra la API que ya existía.
 *
 * La pantalla de aprobaciones traía dos facturas y un reporte de gastos escritos a mano en el
 * componente, y sus botones «Aprobar» y «Rechazar» eran `console.log`. El backend, mientras tanto,
 * tenía `GET /workflows/approvals/pending`, `POST /workflows/approve/:id` y
 * `POST /workflows/reject/:id`, con segregación de funciones —quien solicita no puede aprobar— y
 * registro por paso.
 */
@Injectable({ providedIn: 'root' })
export class WorkflowsService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/workflows`;

  pending(): Observable<PendingApproval[]> {
    return this.http.get<PendingApproval[]>(`${this.apiUrl}/approvals/pending`, {
      withCredentials: true,
    });
  }

  approve(requestId: string, comment?: string): Observable<unknown> {
    return this.http.post(
      `${this.apiUrl}/approve/${requestId}`,
      { comment },
      { withCredentials: true },
    );
  }

  /** El motivo es obligatorio en el servidor: un rechazo sin explicación no es una decisión. */
  reject(requestId: string, reason: string): Observable<unknown> {
    return this.http.post(
      `${this.apiUrl}/reject/${requestId}`,
      { reason },
      { withCredentials: true },
    );
  }
}
