import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { VX_FEEDBACK } from './index';

@Component({
  standalone: true,
  imports: [TranslateModule, ...VX_FEEDBACK],
  template: `
    <vx-spinner [withLabel]="withLabel()" labelKey="common.loading" />
    <vx-empty-state titleKey="common.empty_title" [params]="{ query: 'ferre' }" />
    <vx-error-state [detail]="detail()" [retryable]="true" (retry)="retries.set(retries() + 1)" />
  `,
})
class Host {
  readonly withLabel = signal(false);
  readonly detail = signal<string | null>(null);
  readonly retries = signal(0);
}

describe('estados de una pantalla', () => {
  function build() {
    TestBed.configureTestingModule({ imports: [Host, TranslateModule.forRoot()] });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  }

  it('el giro se anuncia aunque no se vea', () => {
    //  Un círculo girando es, para un lector de pantalla, un div con una animación de fondo.
    const spinner = build().nativeElement.querySelector('vx-spinner') as HTMLElement;
    expect(spinner.getAttribute('role')).toBe('status');
    expect(spinner.getAttribute('aria-live')).toBe('polite');
    expect(spinner.getAttribute('aria-busy')).toBe('true');
    //  La etiqueta existe en el DOM aunque esté oculta a la vista.
    expect(spinner.querySelector('.vx-spinner__label')).not.toBeNull();
  });

  it('el giro puede además escribir su etiqueta', () => {
    const fixture = build();
    fixture.componentInstance.withLabel.set(true);
    fixture.detectChanges();
    const spinner = fixture.nativeElement.querySelector('vx-spinner') as HTMLElement;
    expect(spinner.querySelector('.vx-spinner__caption')).not.toBeNull();
    expect(spinner.querySelector('.vx-spinner__label')).toBeNull();
  });

  it('el estado vacío dice qué falta, no «sin datos»', () => {
    const empty = build().nativeElement.querySelector('vx-empty-state') as HTMLElement;
    expect(empty.querySelector('.empty-title')?.textContent?.trim()).toBeTruthy();
    expect(empty.querySelector('.empty-icon')).not.toBeNull();
  });

  it('el fallo se anuncia como alerta y ofrece reintentar', () => {
    const fixture = build();
    const error = fixture.nativeElement.querySelector('vx-error-state') as HTMLElement;
    expect(error.getAttribute('role')).toBe('alert');

    (error.querySelector('.vx-error-state__retry') as HTMLButtonElement).click();
    expect(fixture.componentInstance.retries()).toBe(1);
  });

  it('el fallo imprime las palabras del servidor, no una clave', () => {
    //  Lo que devuelve la API ya viene traducido por la API. Buscarlo en el catálogo del cliente
    //  imprimiría la clave de todo lo que el servidor conoce y el cliente no.
    const fixture = build();
    fixture.componentInstance.detail.set('El período ya está cerrado.');
    fixture.detectChanges();
    expect(
      (fixture.nativeElement.querySelector('vx-error-state') as HTMLElement).textContent,
    ).toContain('El período ya está cerrado.');
  });
});
