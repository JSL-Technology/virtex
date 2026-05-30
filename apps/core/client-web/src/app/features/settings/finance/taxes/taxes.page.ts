import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { API_URL } from '../../../../core/tokens/api-url.token';
import { catchError, of } from 'rxjs';

interface Tax {
  id: string;
  name: string;
  rate: number;
  type: 'Porcentaje' | 'Fijo';
  countryCode?: string;
}

@Component({
  selector: 'app-tax-rules',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="p-6">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h2 class="text-2xl font-bold">Reglas de Impuestos</h2>
          <p class="text-gray-500 mt-1">Configuración de impuestos aplicables.</p>
        </div>
        <button (click)="openForm()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
          + Nuevo Impuesto
        </button>
      </div>

      @if (showForm()) {
        <div class="bg-gray-50 border rounded-lg p-4 mb-6">
          <h3 class="font-semibold mb-4">{{ editingId() ? 'Editar Impuesto' : 'Nuevo Impuesto' }}</h3>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
              <input [(ngModel)]="form.name" type="text" placeholder="Ej: IVA 19%"
                class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Tasa</label>
              <input [(ngModel)]="form.rate" type="number" min="0" step="0.01" placeholder="19"
                class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
              <select [(ngModel)]="form.type"
                class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="Porcentaje">Porcentaje (%)</option>
                <option value="Fijo">Fijo (monto)</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">País (opcional)</label>
              <input [(ngModel)]="form.countryCode" type="text" maxlength="2" placeholder="CO"
                class="w-full border rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
          </div>
          @if (formError()) {
            <p class="text-red-500 text-sm mt-2">{{ formError() }}</p>
          }
          <div class="flex gap-2 mt-4">
            <button (click)="save()" class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
              Guardar
            </button>
            <button (click)="cancelForm()" class="px-4 py-2 border rounded-lg text-sm hover:bg-gray-100">
              Cancelar
            </button>
          </div>
        </div>
      }

      <div class="bg-white rounded-lg border">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 border-b">
            <tr>
              <th class="text-left px-4 py-3 font-medium text-gray-600">Nombre</th>
              <th class="text-left px-4 py-3 font-medium text-gray-600">Tasa</th>
              <th class="text-left px-4 py-3 font-medium text-gray-600">Tipo</th>
              <th class="text-left px-4 py-3 font-medium text-gray-600">País</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            @if (loading()) {
              <tr><td colspan="5" class="px-4 py-8 text-center text-gray-500">Cargando...</td></tr>
            } @else if (taxes().length === 0) {
              <tr><td colspan="5" class="px-4 py-8 text-center text-gray-500">No hay impuestos configurados.</td></tr>
            } @else {
              @for (t of taxes(); track t.id) {
                <tr class="border-b hover:bg-gray-50">
                  <td class="px-4 py-3 font-medium">{{ t.name }}</td>
                  <td class="px-4 py-3">{{ t.rate }}{{ t.type === 'Porcentaje' ? '%' : '' }}</td>
                  <td class="px-4 py-3 text-gray-500">{{ t.type }}</td>
                  <td class="px-4 py-3 text-gray-500">{{ t.countryCode || '—' }}</td>
                  <td class="px-4 py-3 text-right">
                    <button (click)="edit(t)" class="text-blue-600 hover:underline text-xs mr-3">Editar</button>
                    <button (click)="remove(t.id)" class="text-red-500 hover:underline text-xs">Eliminar</button>
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
    </div>
  `
})
export class TaxRulesPage implements OnInit {
  private http = inject(HttpClient);
  private readonly url = `${inject(API_URL)}/taxes`;

  taxes = signal<Tax[]>([]);
  loading = signal(false);
  showForm = signal(false);
  editingId = signal<string | null>(null);
  formError = signal<string | null>(null);
  form: { name: string; rate: number; type: 'Porcentaje' | 'Fijo'; countryCode: string } = {
    name: '', rate: 0, type: 'Porcentaje', countryCode: ''
  };

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    this.http.get<Tax[]>(this.url).pipe(
      catchError(() => of([]))
    ).subscribe(data => {
      this.taxes.set(data);
      this.loading.set(false);
    });
  }

  openForm() {
    this.form = { name: '', rate: 0, type: 'Porcentaje', countryCode: '' };
    this.editingId.set(null);
    this.formError.set(null);
    this.showForm.set(true);
  }

  edit(t: Tax) {
    this.form = { name: t.name, rate: t.rate, type: t.type, countryCode: t.countryCode || '' };
    this.editingId.set(t.id);
    this.formError.set(null);
    this.showForm.set(true);
  }

  cancelForm() {
    this.showForm.set(false);
    this.editingId.set(null);
    this.formError.set(null);
  }

  save() {
    if (!this.form.name) {
      this.formError.set('El nombre es obligatorio.');
      return;
    }
    const payload = {
      name: this.form.name,
      rate: Number(this.form.rate),
      type: this.form.type,
      countryCode: this.form.countryCode || undefined,
    };
    const req = this.editingId()
      ? this.http.patch<Tax>(`${this.url}/${this.editingId()}`, payload)
      : this.http.post<Tax>(this.url, payload);

    req.pipe(catchError(err => {
      this.formError.set(err.error?.message || 'Error al guardar.');
      return of(null);
    })).subscribe(result => {
      if (result) {
        this.cancelForm();
        this.load();
      }
    });
  }

  remove(id: string) {
    if (!confirm('¿Eliminar este impuesto?')) return;
    this.http.delete(`${this.url}/${id}`).pipe(
      catchError(() => of(null))
    ).subscribe(() => this.load());
  }
}
