import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { API_URL } from '../../../../core/tokens/api-url.token';
import { catchError, of } from 'rxjs';

interface AuditLog {
  id: string;
  userId: string;
  entity: string;
  entityId: string;
  actionType: string;
  ipAddress?: string;
  timestamp: string;
  newValue?: Record<string, unknown>;
}

interface AuditLogResponse {
  data: AuditLog[];
  total: number;
}

@Component({
  selector: 'app-security',
  standalone: true,
  imports: [CommonModule, DatePipe],
  template: `
    <div class="p-6">
      <div class="mb-6">
        <h2 class="text-2xl font-bold">Seguridad y Auditoría</h2>
        <p class="text-gray-500 mt-1">Registro de actividad del sistema.</p>
      </div>

      <div class="bg-white rounded-lg border">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 border-b">
              <tr>
                <th class="text-left px-4 py-3 font-medium text-gray-600">Fecha</th>
                <th class="text-left px-4 py-3 font-medium text-gray-600">Acción</th>
                <th class="text-left px-4 py-3 font-medium text-gray-600">Entidad</th>
                <th class="text-left px-4 py-3 font-medium text-gray-600">Usuario (ID)</th>
                <th class="text-left px-4 py-3 font-medium text-gray-600">IP</th>
              </tr>
            </thead>
            <tbody>
              @if (loading()) {
                <tr>
                  <td colspan="5" class="px-4 py-8 text-center text-gray-500">Cargando...</td>
                </tr>
              } @else if (logs().length === 0) {
                <tr>
                  <td colspan="5" class="px-4 py-8 text-center text-gray-500">No hay registros de auditoría.</td>
                </tr>
              } @else {
                @for (log of logs(); track log.id) {
                  <tr class="border-b hover:bg-gray-50">
                    <td class="px-4 py-3 text-gray-700">{{ log.timestamp | date:'dd/MM/yyyy HH:mm' }}</td>
                    <td class="px-4 py-3">
                      <span class="px-2 py-1 rounded text-xs font-medium"
                        [class]="getActionClass(log.actionType)">
                        {{ log.actionType }}
                      </span>
                    </td>
                    <td class="px-4 py-3 text-gray-700">{{ log.entity }}</td>
                    <td class="px-4 py-3 text-gray-500 font-mono text-xs">{{ log.userId | slice:0:8 }}...</td>
                    <td class="px-4 py-3 text-gray-500">{{ log.ipAddress || '—' }}</td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>

        <div class="flex items-center justify-between px-4 py-3 border-t">
          <span class="text-sm text-gray-500">
            Mostrando {{ (page() - 1) * pageSize + 1 }}–{{ [page() * pageSize, total()].sort()[0] }} de {{ total() }} registros
          </span>
          <div class="flex gap-2">
            <button
              (click)="prevPage()"
              [disabled]="page() <= 1"
              class="px-3 py-1 text-sm border rounded disabled:opacity-40 hover:bg-gray-50">
              Anterior
            </button>
            <button
              (click)="nextPage()"
              [disabled]="page() * pageSize >= total()"
              class="px-3 py-1 text-sm border rounded disabled:opacity-40 hover:bg-gray-50">
              Siguiente
            </button>
          </div>
        </div>
      </div>
    </div>
  `
})
export class SecuritySettingsPage implements OnInit {
  private http = inject(HttpClient);
  private apiUrl = inject(API_URL);

  logs = signal<AuditLog[]>([]);
  total = signal(0);
  page = signal(1);
  loading = signal(false);
  readonly pageSize = 20;

  ngOnInit() {
    this.loadLogs();
  }

  loadLogs() {
    this.loading.set(true);
    this.http.get<AuditLogResponse>(
      `${this.apiUrl}/audit?page=${this.page()}&pageSize=${this.pageSize}`
    ).pipe(
      catchError(() => of({ data: [], total: 0 }))
    ).subscribe(res => {
      this.logs.set(res.data);
      this.total.set(res.total);
      this.loading.set(false);
    });
  }

  prevPage() {
    if (this.page() > 1) {
      this.page.update(p => p - 1);
      this.loadLogs();
    }
  }

  nextPage() {
    if (this.page() * this.pageSize < this.total()) {
      this.page.update(p => p + 1);
      this.loadLogs();
    }
  }

  getActionClass(action: string): string {
    const map: Record<string, string> = {
      CREATE: 'bg-green-100 text-green-700',
      UPDATE: 'bg-blue-100 text-blue-700',
      DELETE: 'bg-red-100 text-red-700',
      LOGIN: 'bg-purple-100 text-purple-700',
      LOGIN_FAILED: 'bg-orange-100 text-orange-700',
      LOGOUT: 'bg-gray-100 text-gray-600',
    };
    return map[action] || 'bg-gray-100 text-gray-600';
  }
}
