import { ChangeDetectionStrategy, Component, TemplateRef, computed, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, AlertTriangle, CheckCircle, RotateCw } from 'lucide-angular';

/** Algo que espera a esta persona. */
export interface InboxItem {
  id: string;
  /** Ya compuesto: el nombre del documento o de la tarea. */
  title: string;
  /** Por qué está aquí, en una línea. Ya compuesto. */
  detail?: string;
  /** Desde cuándo espera, o para cuándo vence. Ya formateado. */
  when?: string;
  /** Vencido. Se lee como tal y no solo por el color. */
  overdue?: boolean;
  /** La cifra que decide —un importe—, ya formateada. */
  amount?: string;
  /** A dónde lleva el título. Ausente cuando el elemento se resuelve aquí mismo. */
  link?: unknown[] | string | null;
}

/** Un tramo de la bandeja: aprobaciones, tareas, avisos. */
export interface InboxSection {
  /** Clave i18n del encabezado. */
  labelKey: string;
  items: InboxItem[];
}

/**
 * El gesto INBOX: qué te toca, ordenado por lo que bloquea.
 *
 * ## Por qué secciones y no pestañas
 *
 * Las dos pantallas que este armazón sustituye estaban organizadas en pestañas —Tareas,
 * Aprobaciones, Avisos, Seguridad en una; Facturas, Gastos, Órdenes en la otra—, y una bandeja con
 * pestañas obliga a mirar en cuatro sitios para saber si has terminado. Que es exactamente la
 * pregunta que una bandeja existe para responder.
 *
 * Aquí todo está en un solo recorrido. Los tramos vacíos no desaparecen: se encogen a una línea
 * que dice que ese está al día, porque «no hay nada» también es una respuesta y esconderla obliga a
 * comprobarlo por otro camino.
 *
 * ## Por qué la acción viaja en una plantilla
 *
 * Aprobar y rechazar no son navegación: resuelven el elemento sin salir de la bandeja, y la acción
 * que lo resuelve depende de qué sea. El armazón se queda con la anatomía —qué es, por qué está
 * aquí, desde cuándo, y qué se puede hacer con ello— y la página aporta el botón, con el elemento
 * como contexto.
 */
@Component({
  selector: 'vx-inbox-shell',
  standalone: true,
  imports: [NgTemplateOutlet, RouterModule, TranslateModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inbox-shell.component.html',
  styleUrls: ['./inbox-shell.component.scss'],
})
export class InboxShellComponent {
  readonly titleKey = input.required<string>();
  readonly subtitleKey = input<string | null>(null);

  readonly sections = input.required<InboxSection[]>();

  readonly loading = input(false);
  /** Clave i18n o mensaje ya localizado; ver `ListShellComponent.error`. */
  readonly error = input<string | null>(null);

  /** Plantilla de las acciones de un elemento. Recibe el `InboxItem` como `$implicit`. */
  readonly itemActions = input<TemplateRef<{ $implicit: InboxItem }> | null>(null);

  readonly reload = output<void>();

  protected readonly OverdueIcon = AlertTriangle;
  protected readonly ClearIcon = CheckCircle;
  protected readonly ReloadIcon = RotateCw;

  protected readonly SKELETON = [1, 2, 3, 4] as const;

  /** Cuántas cosas esperan en total. Es el número que responde «¿he terminado?». */
  protected readonly pending = computed(() =>
    this.sections().reduce((total, section) => total + section.items.length, 0),
  );

  protected readonly state = computed<'loading' | 'error' | 'clear' | 'content'>(() => {
    if (this.loading()) return 'loading';
    if (this.error()) return 'error';
    if (this.pending() === 0) return 'clear';
    return 'content';
  });
}
