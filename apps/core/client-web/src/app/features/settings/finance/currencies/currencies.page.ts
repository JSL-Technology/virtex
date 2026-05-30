import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { API_URL } from '../../../../core/tokens/api-url.token';
import { catchError, of } from 'rxjs';

interface Currency {
  id: string;
  name: string;
  code: string;
  symbol: string;
}

@Component({
  selector: 'app-currencies',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="p-6">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h2 class="text-2xl font-bold">Multimoneda y Tasas</h2>
          <p class="text-gray-500 mt-1">Gestión de monedas disponibles en el sistema.</p>
        </div>
        <button (click)="openForm()" class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
          + Nueva Moneda
        </button>
      </div>

      @if (showForm()) {
        <div class="bg-gray-50 border rounded-lg p-4 mb-6">
          <h3 class="font-semibold mb-4">{{ editingId() ? 'Editar Moneda' : 'Nueva Moneda' }}</h3>
          <div class="grid grid-cols-3 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
              <input [(ngModel)]="form.name" type="text" placeholder="Ej: Dólar Estadounidense"
                class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Código (3 letras)</label>
              <input [(ngModel)]="form.code" type="text" maxlength="3" placeholder="USD"
                class="w-full border rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Símbolo</label>
              <input [(ngModel)]="form.symbol" type="text" placeholder="$"
                class="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
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
              <th class="text-left px-4 py-3 font-medium text-gray-600">Código</th>
              <th class="text-left px-4 py-3 font-medium text-gray-600">Símbolo</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            @if (loading()) {
              <tr><td colspan="4" class="px-4 py-8 text-center text-gray-500">Cargando...</td></tr>
            } @else if (currencies().length === 0) {
              <tr><td colspan="4" class="px-4 py-8 text-center text-gray-500">No hay monedas configuradas.</td></tr>
            } @else {
              @for (c of currencies(); track c.id) {
                <tr class="border-b hover:bg-gray-50">
                  <td class="px-4 py-3 font-medium">{{ c.name }}</td>
                  <td class="px-4 py-3 font-mono">{{ c.code }}</td>
                  <td class="px-4 py-3">{{ c.symbol }}</td>
                  <td class="px-4 py-3 text-right">
                    <button (click)="edit(c)" class="text-blue-600 hover:underline text-xs mr-3">Editar</button>
                    <button (click)="remove(c.id)" class="text-red-500 hover:underline text-xs">Eliminar</button>
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
export class CurrencySettingsPage implements OnInit {
  private http = inject(HttpClient);
  private readonly url = `${inject(API_URL)}/currencies`;

  currencies = signal<Currency[]>([]);
  loading = signal(false);
  showForm = signal(false);
  editingId = signal<string | null>(null);
  formError = signal<string | null>(null);
  form = { name: '', code: '', symbol: '' };

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    this.http.get<Currency[]>(this.url).pipe(
      catchError(() => of([]))
    ).subscribe(data => {
      this.currencies.set(data);
      this.loading.set(false);
    });
  }

  openForm() {
    this.form = { name: '', code: '', symbol: '' };
    this.editingId.set(null);
    this.formError.set(null);
    this.showForm.set(true);
  }

  edit(c: Currency) {
    this.form = { name: c.name, code: c.code, symbol: c.symbol };
    this.editingId.set(c.id);
    this.formError.set(null);
    this.showForm.set(true);
  }

  cancelForm() {
    this.showForm.set(false);
    this.editingId.set(null);
    this.formError.set(null);
  }

  save() {
    if (!this.form.name || !this.form.code || !this.form.symbol) {
      this.formError.set('Todos los campos son obligatorios.');
      return;
    }
    if (this.form.code.length !== 3) {
      this.formError.set('El código debe tener exactamente 3 caracteres.');
      return;
    }
    const payload = { ...this.form, code: this.form.code.toUpperCase() };
    const req = this.editingId()
      ? this.http.patch<Currency>(`${this.url}/${this.editingId()}`, payload)
      : this.http.post<Currency>(this.url, payload);

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
    if (!confirm('¿Eliminar esta moneda?')) return;
    this.http.delete(`${this.url}/${id}`).pipe(
      catchError(() => of(null))
    ).subscribe(() => this.load());
  }
}
