import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { API_URL } from '../../../../core/tokens/api-url.token';
import { catchError, of } from 'rxjs';

interface Ledger {
  id: string;
  name: string;
  code: string;
  currency: string;
  isDefault: boolean;
}

@Component({
  selector: 'app-accounting-settings',
  standalone: true,
  imports: [CommonModule, DatePipe],
  template: `
    <div class="p-6">
      <div class="mb-6">
        <h2 class="text-2xl font-bold">Preferencias Contables</h2>
        <p class="text-gray-500 mt-1">Configuración de libros contables.</p>
      </div>

      <div class="grid gap-6">
        <div class="bg-white rounded-lg border">
          <div class="px-4 py-3 border-b">
            <h3 class="font-semibold">Libros Contables (Ledgers)</h3>
          </div>
          <table class="w-full text-sm">
            <thead class="bg-gray-50 border-b">
              <tr>
                <th class="text-left px-4 py-3 font-medium text-gray-600">Nombre</th>
                <th class="text-left px-4 py-3 font-medium text-gray-600">Código</th>
                <th class="text-left px-4 py-3 font-medium text-gray-600">Moneda</th>
                <th class="text-left px-4 py-3 font-medium text-gray-600">Por Defecto</th>
              </tr>
            </thead>
            <tbody>
              @if (loadingLedgers()) {
                <tr><td colspan="4" class="px-4 py-8 text-center text-gray-500">Cargando...</td></tr>
              } @else if (ledgers().length === 0) {
                <tr><td colspan="4" class="px-4 py-8 text-center text-gray-500">No hay libros contables configurados.</td></tr>
              } @else {
                @for (l of ledgers(); track l.id) {
                  <tr class="border-b hover:bg-gray-50">
                    <td class="px-4 py-3 font-medium">{{ l.name }}</td>
                    <td class="px-4 py-3 font-mono text-gray-500">{{ l.code }}</td>
                    <td class="px-4 py-3">{{ l.currency }}</td>
                    <td class="px-4 py-3">
                      @if (l.isDefault) {
                        <span class="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">Principal</span>
                      }
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class AccountingSettingsPage implements OnInit {
  private http = inject(HttpClient);
  private apiUrl = inject(API_URL);

  ledgers = signal<Ledger[]>([]);
  loadingLedgers = signal(false);

  ngOnInit() {
    this.loadingLedgers.set(true);
    this.http.get<Ledger[]>(`${this.apiUrl}/accounting/ledgers`).pipe(
      catchError(() => of([]))
    ).subscribe(data => {
      this.ledgers.set(data);
      this.loadingLedgers.set(false);
    });
  }
}
