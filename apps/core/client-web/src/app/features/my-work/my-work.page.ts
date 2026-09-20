import { Component, ChangeDetectionStrategy, computed, signal, inject, OnInit } from '@angular/core';
import { LucideAngularModule, Key } from 'lucide-angular';
import { MyWorkService, WorkItem } from './my-work.service';
import { AuthService } from '../../core/services/auth';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { InboxShellComponent, InboxItem, InboxSection } from '../../shared/components/gestures';
import { ModuleInboxService } from '../../core/inbox/module-inbox.service';
import { ActiveOrganizationService } from '../../core/tenancy/active-organization.service';
import { MODULES } from '../../core/modules/module-registry';

@Component({
  selector: 'app-my-work-page',
  standalone: true,
  imports: [LucideAngularModule, TranslateModule, InboxShellComponent],
  templateUrl: './my-work.page.html',
  styleUrls: ['./my-work.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyWorkPage implements OnInit {
  private myWorkService = inject(MyWorkService);
  private authService = inject(AuthService);
  private moduleInbox = inject(ModuleInboxService);
  private tenancy = inject(ActiveOrganizationService);
  private translate = inject(TranslateService);

  protected readonly SecurityIcon = Key;

  readonly tasks = signal<WorkItem[]>([]);
  readonly approvals = signal<WorkItem[]>([]);
  readonly notifications = signal<WorkItem[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  /**
   * La bandeja, en un solo recorrido.
   *
   * Estaba en cuatro pestañas, y una bandeja con pestañas obliga a mirar en cuatro sitios para
   * saber si has terminado — que es la única pregunta que una bandeja existe para responder. Las
   * aprobaciones van primero porque son lo que bloquea a otra persona.
   */
  readonly sections = computed<InboxSection[]>(() => [
    { labelKey: 'my_work.approvals', items: this.approvals().map(toInboxItem) },
    ...this.moduleSections(),
    { labelKey: 'my_work.tasks', items: this.tasks().map(toInboxItem) },
    { labelKey: 'my_work.notifications', items: this.notifications().map(toInboxItem) },
  ]);

  /**
   * Una sección por módulo con trabajo bloqueado.
   *
   * Van entre las aprobaciones —que bloquean a OTRA persona, y por eso siguen primero— y las
   * tareas propias. Cada módulo trae lo suyo ya ordenado por lo que lleva más tiempo esperando, y
   * el servidor devuelve los módulos en ese mismo orden entre sí: la bandeja se lee de arriba
   * abajo sin tener que comparar nada.
   */
  private readonly moduleSections = computed<InboxSection[]>(() =>
    this.moduleInbox.modules().map((module) => ({
      labelKey: MODULES.find((m) => m.id === module.moduleId)?.titleKey ?? module.moduleId,
      //  El armazón de bandeja recibe texto ya compuesto, no claves: es su contrato, y lo que
      //  evita que cada pantalla invente su propia forma de traducir. El módulo manda la clave y
      //  sus parámetros —no decide idioma— y aquí se resuelve, una sola vez.
      items: module.items.map((item) => ({
        id: item.id,
        title: this.translate.instant(item.titleKey, item.titleParams),
        when: this.translate.instant('inbox.blocked_since', {
          date: item.blockedSince.slice(0, 10),
        }),
        // La empresa se añade aquí: el módulo declara la ruta del manifiesto, sin prefijo.
        link: this.tenancy.urlFor(item.route),
      })),
    })),
  );

  ngOnInit(): void {
    this.loadWorkItems();
    // Se pide aquí y no en el armazón: quien abre «Mi trabajo» quiere el número de ahora, y el
    // riel se actualiza con la misma respuesta porque las dos vistas leen el mismo servicio.
    void this.moduleInbox.refresh();
  }

  loadWorkItems(): void {
    this.loading.set(true);
    this.error.set(null);
    this.myWorkService.getWorkItems().subscribe({
      next: (data) => {
        this.tasks.set(data.tasks);
        this.approvals.set(data.approvals);
        this.notifications.set(data.notifications);
        this.loading.set(false);
      },
      //  No había rama de error: un fallo del servidor dejaba la bandeja vacía, que se lee como
      //  «no tienes nada pendiente» — la afirmación más cara que esta pantalla puede hacer.
      error: () => {
        this.error.set('my_work.load_failed');
        this.loading.set(false);
      },
    });
  }

  async registerPasskey() {
    await this.authService.registerPasskey();
  }
}

/** Un elemento del servidor, en la forma que la bandeja entiende. */
function toInboxItem(item: WorkItem): InboxItem {
  return {
    id: item.id,
    title: item.title,
    detail: item.description,
    when: item.dueDate,
    //  Vencido: lo que ya bloquea, frente a lo que bloqueará. Se ordena y se lee distinto.
    overdue: Boolean(item.dueDate) && new Date(item.dueDate) < new Date(),
    link: item.link,
  };
}
