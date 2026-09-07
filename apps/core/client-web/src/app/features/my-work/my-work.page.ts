import { Component, ChangeDetectionStrategy, computed, signal, inject, OnInit } from '@angular/core';
import { LucideAngularModule, Key } from 'lucide-angular';
import { MyWorkService, WorkItem } from './my-work.service';
import { AuthService } from '../../core/services/auth';
import { TranslateModule } from '@ngx-translate/core';
import { InboxShellComponent, InboxItem, InboxSection } from '../../shared/components/gestures';

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
    { labelKey: 'MY_WORK.APPROVALS', items: this.approvals().map(toInboxItem) },
    { labelKey: 'MY_WORK.TASKS', items: this.tasks().map(toInboxItem) },
    { labelKey: 'MY_WORK.NOTIFICATIONS', items: this.notifications().map(toInboxItem) },
  ]);

  ngOnInit(): void {
    this.loadWorkItems();
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
        this.error.set('MY_WORK.LOAD_FAILED');
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
