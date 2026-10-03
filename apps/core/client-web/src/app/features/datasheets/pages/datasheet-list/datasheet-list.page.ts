import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { DatasheetSummary, DatasheetVariablesService } from '../../services/datasheet-variables.service';
import { NotificationService } from '../../../../core/services/notification';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Plus, FileSpreadsheet } from 'lucide-angular';
import { ListShellComponent } from '../../../../shared/components/gestures';

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
  imports: [RouterModule, TranslateModule, LucideAngularModule, ListShellComponent, ...FORMAT_PIPES],
  styleUrl: './datasheet-list.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <vx-list-shell
      titleKey="datasheets.title"
      subtitleKey="datasheets.analysis_spreadsheets_connected_erp_real_time"
      [count]="documents().length"
      [loading]="loading()"
      [empty]="!loading() && documents().length === 0"
    >
      <!--
        Absolute, because this page is mounted as a window rather than by a router outlet: the
        ActivatedRoute a tab provides describes the tab, not a URL tree, so a relative link has
        nothing to resolve against and the only way to create a book did nothing at all.
      -->
      <a listActions [routerLink]="['/datasheets/new']" class="primary-button">
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
                    <a [routerLink]="['/datasheets', doc.id]" class="table-link">{{ doc.name }}</a>
                  </span>
                </td>
                <td>{{ ownerOf(doc) }}</td>
                <td>{{ doc.modifiedAt | vxDate: 'dateTime' }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </vx-list-shell>
  `,
})
export class DatasheetListPage implements OnInit {
  private readonly books = inject(DatasheetVariablesService);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly PlusIcon = Plus;
  protected readonly FileIcon = FileSpreadsheet;

  /**
   * The caller's real books. This was two invented rows — «Estado de Resultados Q1 — Juan Pérez»,
   * «Análisis de Rentabilidad - Laptops» — dated «now» on every visit and opening nothing (QA A-10).
   */
  readonly documents = signal<DatasheetSummary[]>([]);
  readonly loading = signal(true);

  ngOnInit(): void {
    this.books
      .listBooks()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (books) => {
          this.documents.set(books);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.notifications.showHttpError(error, 'datasheets.list_failed');
        },
      });
  }

  ownerOf(book: DatasheetSummary): string {
    const owner = book.owner;
    return owner ? `${owner.firstName ?? ''} ${owner.lastName ?? ''}`.trim() || '—' : '—';
  }
}
