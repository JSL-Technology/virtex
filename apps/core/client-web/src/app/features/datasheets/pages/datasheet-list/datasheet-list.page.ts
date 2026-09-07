import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Plus, FileSpreadsheet } from 'lucide-angular';
import { ListShellComponent } from '../../../../shared/components/gestures';

interface Datasheet {
  id: string;
  name: string;
  owner: string;
  modifiedAt: Date;
}

/**
 * Las hojas de datos, listadas.
 *
 * ## Qué cambió, además del armazón
 *
 * Tenía una barra lateral propia con cinco filtros —Recientes, Mis documentos, Compartidos,
 * Plantillas, Papelera— de los que ninguno hacía nada: cinco botones sin manejador, uno de ellos
 * marcado como activo para siempre. Una segunda navegación dentro de una pantalla, que además no
 * navegaba. Se retira; cuando esos filtros existan, su sitio es la barra del gesto, junto a la
 * búsqueda, como en las demás listas.
 *
 * Las filas eran `<tr [routerLink]>`: una fila entera como enlace no se alcanza con el tabulador ni
 * se anuncia como algo que se pueda abrir. El enlace es ahora el nombre del documento.
 */
@Component({
  selector: 'app-datasheet-list',
  standalone: true,
  imports: [DatePipe, RouterModule, TranslateModule, LucideAngularModule, ListShellComponent],
  styleUrl: './datasheet-list.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <vx-list-shell
      titleKey="datasheets.title"
      subtitleKey="datasheets.subtitle"
      [count]="documents().length"
      [empty]="documents().length === 0"
    >
      <a listActions [routerLink]="['new']" class="primary-button">
        <lucide-icon [img]="PlusIcon" size="16" aria-hidden="true"></lucide-icon>
        <span>{{ 'datasheets.new_document' | translate }}</span>
      </a>

      <div class="table-container card">
        <table class="data-table">
          <thead>
            <tr>
              <th>{{ 'datasheets.name' | translate }}</th>
              <th>{{ 'datasheets.owner' | translate }}</th>
              <th>{{ 'datasheets.last_modified' | translate }}</th>
            </tr>
          </thead>
          <tbody>
            @for (doc of documents(); track doc.id) {
              <tr>
                <td>
                  <span class="doc-info">
                    <lucide-icon [img]="FileIcon" size="18" class="doc-icon" aria-hidden="true"></lucide-icon>
                    <a [routerLink]="[doc.id]" class="table-link">{{ doc.name }}</a>
                  </span>
                </td>
                <td>{{ doc.owner }}</td>
                <td>{{ doc.modifiedAt | date: 'medium' }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </vx-list-shell>
  `,
})
export class DatasheetListPage {
  protected readonly PlusIcon = Plus;
  protected readonly FileIcon = FileSpreadsheet;

  readonly documents = signal<Datasheet[]>([
    { id: '1', name: 'Estado de Resultados Q1', owner: 'Juan Pérez', modifiedAt: new Date() },
    { id: '2', name: 'Análisis de Rentabilidad - Laptops', owner: 'Ana García', modifiedAt: new Date() },
  ]);
}
