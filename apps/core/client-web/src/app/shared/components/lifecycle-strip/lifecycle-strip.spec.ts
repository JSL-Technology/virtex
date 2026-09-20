import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { DocumentLifecycle } from '@virteex/shared/types';
import { DocumentLifecycleService } from '../../../core/lifecycle/document-lifecycle.service';
import { VxLifecycleStripComponent } from './index';

/** La orden de compra, tal como la declara el servidor. */
const ORDEN: DocumentLifecycle = {
  documentType: 'purchase-order',
  labelKey: 'purchasing.orders.document_name',
  stages: [
    { status: 'DRAFT', labelKey: 'l.draft', next: ['PENDING_APPROVAL', 'CANCELLED'] },
    { status: 'PENDING_APPROVAL', labelKey: 'l.pending', next: ['APPROVED', 'CANCELLED'] },
    { status: 'APPROVED', labelKey: 'l.approved', next: ['SENT', 'CANCELLED'] },
    { status: 'SENT', labelKey: 'l.sent', next: ['RECEIVED', 'CANCELLED'] },
    { status: 'RECEIVED', labelKey: 'l.received', next: [] },
    { status: 'CANCELLED', labelKey: 'l.cancelled', next: [], exceptional: true },
  ],
};

@Component({
  standalone: true,
  imports: [VxLifecycleStripComponent, TranslateModule],
  template: `<vx-lifecycle-strip [documentType]="tipo()" [status]="estado()" />`,
})
class Host {
  readonly tipo = signal('purchase-order');
  readonly estado = signal('SENT');
}

/**
 * La tira de etapas.
 *
 * Lo que se protege aquí es lo que un comprador ve: si la tira marca la etapa equivocada, el
 * producto está mintiendo sobre el estado de un compromiso con un proveedor, y lo hace con toda
 * la autoridad de una interfaz que parece saber.
 */
describe('VxLifecycleStripComponent', () => {
  /** Un servicio ya cargado: el componente no debe pedir nada para pintar. */
  function build(declarados: DocumentLifecycle[] = [ORDEN]) {
    const doble = {
      lifecycles: signal(new Map(declarados.map((l) => [l.documentType, l]))).asReadonly(),
      get: (tipo: string) => declarados.find((l) => l.documentType === tipo) ?? null,
      load: () => Promise.resolve(),
    };

    TestBed.configureTestingModule({
      imports: [Host, TranslateModule.forRoot()],
      providers: [{ provide: DocumentLifecycleService, useValue: doble }],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  }

  function etapas(fixture: ReturnType<typeof build>): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.ls__stage'));
  }

  it('dibuja el camino esperado y deja fuera la etapa excepcional', () => {
    const fixture = build();
    expect(etapas(fixture).map((e) => e.textContent?.trim())).toEqual([
      'l.draft',
      'l.pending',
      'l.approved',
      'l.sent',
      'l.received',
    ]);
  });

  it('marca dónde está y qué ya ocurrió', () => {
    const fixture = build();
    const puntos = etapas(fixture);

    // Enviada: las tres anteriores ocurrieron, «recibida» todavía no.
    expect(puntos.slice(0, 3).every((e) => e.classList.contains('ls__stage--done'))).toBe(true);
    expect(puntos[3].classList).toContain('ls__stage--current');
    expect(puntos[4].classList).not.toContain('ls__stage--done');
  });

  it('anuncia la etapa actual a un lector de pantalla', () => {
    // Sin esto la tira es decoración: quien no ve los colores no sabe dónde está el documento.
    const fixture = build();
    const marcados = etapas(fixture).filter((e) => e.getAttribute('aria-current') === 'step');
    expect(marcados).toHaveLength(1);
    expect(marcados[0].textContent?.trim()).toBe('l.sent');
  });

  it('en una etapa excepcional la añade al final y no marca nada como hecho', () => {
    const fixture = build();
    fixture.componentInstance.estado.set('CANCELLED');
    fixture.detectChanges();

    const puntos = etapas(fixture);
    expect(puntos.map((e) => e.textContent?.trim())).toEqual([
      'l.draft',
      'l.pending',
      'l.approved',
      'l.sent',
      'l.received',
      'l.cancelled',
    ]);
    // Desde «cancelada» no se sabe por dónde pasó antes. Marcar un recorrido sería adivinarlo.
    expect(puntos.filter((e) => e.classList.contains('ls__stage--done'))).toHaveLength(0);
    expect(puntos[5].classList).toContain('ls__stage--exceptional');
  });

  it('no dibuja nada para un documento que no declara su vida', () => {
    // La mayoría del producto está así. Inventarle un recorrido sería enseñar una regla falsa.
    const fixture = build();
    fixture.componentInstance.tipo.set('journal-entry');
    fixture.detectChanges();
    expect(etapas(fixture)).toHaveLength(0);
  });

  it('no dibuja nada ante un estado que el ciclo no declara', () => {
    // Llega de una versión anterior del producto. Una tira sin ninguna etapa marcada es peor que
    // ninguna tira: sugiere que el documento no ha empezado.
    const fixture = build();
    fixture.componentInstance.estado.set('INVENTADO');
    fixture.detectChanges();
    expect(etapas(fixture).filter((e) => e.classList.contains('ls__stage--current'))).toHaveLength(
      0,
    );
  });
});
