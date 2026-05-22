import { Injectable, ApplicationRef, createComponent, EnvironmentInjector, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { ModalComponent } from '../components/modal/modal.component';

export interface ModalOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ModalService {
  private componentRef: any;
  private readonly onClose = new Subject<boolean | null>();
  public onClose$ = this.onClose.asObservable();

  // --- INICIO DE CAMBIOS ---
  // 1. Añade señales para el estado y las opciones.
  public isOpen = signal(false);
  public options = signal<ModalOptions | null>(null);
  // --- FIN DE CAMBIOS ---

  constructor(
    private appRef: ApplicationRef,
    private injector: EnvironmentInjector
  ) {}

  public open(options: ModalOptions) {
    // Evita abrir múltiples modales
    if (this.componentRef) {
      return;
    }

    // --- INICIO DE CAMBIOS ---
    // 2. Actualiza las señales cuando se abre el modal.
    this.options.set(options);
    this.isOpen.set(true);
    // --- FIN DE CAMBIOS ---

    // Crea una instancia del componente del modal
    this.componentRef = createComponent(ModalComponent, {
      environmentInjector: this.injector,
    });

    // Asigna las opciones al componente
    this.componentRef.instance.options = options;

    // Suscríbete a los eventos de salida del componente
    this.componentRef.instance.onConfirm.subscribe(() => this.close(true));
    this.componentRef.instance.onCancel.subscribe(() => this.close(false));
    this.componentRef.instance.onCloseModal.subscribe(() => this.close(null));

    // Adjunta el componente al DOM
    document.body.appendChild(this.componentRef.location.nativeElement);
    this.appRef.attachView(this.componentRef.hostView);

    return this; // Permite encadenar, por ejemplo: modalService.open({...}).onClose$.subscribe(...)
  }

  public close(result: boolean | null) {
    if (this.componentRef) {
      this.appRef.detachView(this.componentRef.hostView);
      this.componentRef.destroy();
      this.componentRef = null;

      // --- INICIO DE CAMBIOS ---
      // 3. Limpia las señales cuando se cierra el modal.
      this.isOpen.set(false);
      this.options.set(null);
      // --- FIN DE CAMBIOS ---

      this.onClose.next(result);
    }
  }
}