import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { TransitionPreviewComponent } from './transition-preview.component';
import { TransitionPreview } from './transition-preview.model';

/**
 * The dialog that stands between a person and a posting.
 *
 * What it shows has to be exactly what the server said, and what it allows has to follow from it.
 * A preview that renders a blocked transition with an enabled confirm button is worse than no
 * preview: it invites the click it exists to prevent.
 */
describe('TransitionPreviewComponent', () => {
  let fixture: ComponentFixture<TransitionPreviewComponent>;

  const blocked: TransitionPreview = {
    canExecute: false,
    preconditions: [
      { code: 'INVOICES.PRECONDITION.DRAFT', status: 'passed', message: 'Está en borrador' },
      {
        code: 'ACCOUNTING.PERIOD_CLOSED',
        status: 'failed',
        message: 'El periodo 2026-08 está cerrado',
        remedy: { labelKey: 'REMEDY.OPEN_PERIOD', route: '/accounting/periods' },
      },
    ],
    effects: [],
  };

  const executable: TransitionPreview = {
    canExecute: true,
    preconditions: [
      { code: 'INVOICES.PRECONDITION.DRAFT', status: 'passed', message: 'Está en borrador' },
    ],
    effects: [
      {
        kind: 'sequence',
        titleKey: 'INVOICES.EFFECT.FISCAL_NUMBER',
        value: 'E310000000247',
      },
      {
        kind: 'ledger',
        titleKey: 'INVOICES.EFFECT.REVENUE_ENTRY',
        currencyCode: 'DOP',
        lines: [
          { accountCode: '1101', accountName: 'Cuentas por cobrar', debit: 45800, credit: 0 },
          { accountCode: '4101', accountName: 'Ingresos', debit: 0, credit: 38813.56 },
          { accountCode: '2105', accountName: 'ITBIS por pagar', debit: 0, credit: 6986.44 },
        ],
        totalDebit: 45800,
        totalCredit: 45800,
      },
    ],
  };

  async function render(preview: TransitionPreview) {
    await TestBed.configureTestingModule({
      imports: [TransitionPreviewComponent, TranslateModule.forRoot()],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(TransitionPreviewComponent);
    fixture.componentRef.setInput('preview', preview);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('muestra las precondiciones fallidas antes que las cumplidas', async () => {
    const el = await render(blocked);
    const checks = [...el.querySelectorAll('.tp__check')];
    expect(checks[0].classList).toContain('tp__check--failed');
  });

  it('una precondición bloqueante ofrece a dónde ir a resolverla', async () => {
    const el = await render(blocked);
    const remedy = el.querySelector('.tp__remedy');
    expect(remedy).toBeTruthy();
    expect(remedy?.getAttribute('href')).toBe('/accounting/periods');
  });

  it('no deja confirmar lo que el servidor dijo que no se puede ejecutar', async () => {
    const el = await render(blocked);
    const confirm = el.querySelector('.btn--primary') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it('no muestra efectos cuando la transición está bloqueada', async () => {
    // Showing what "would" happen next to a reason it cannot happen reads as if the block were
    // advisory. It is not.
    const el = await render(blocked);
    expect(el.querySelector('.tp__table')).toBeNull();
  });

  it('muestra el asiento con sus líneas de debe y haber', async () => {
    const el = await render(executable);
    const rows = [...el.querySelectorAll('.tp__table tbody tr')];
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('1101');
    expect(rows[0].textContent).toContain('Cuentas por cobrar');
  });

  it('muestra el número fiscal que se consumiría', async () => {
    const el = await render(executable);
    expect(el.textContent).toContain('E310000000247');
  });

  it('deja confirmar cuando el servidor dice que se puede', async () => {
    const el = await render(executable);
    const confirm = el.querySelector('.btn--primary') as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
  });

  it('avisa cuando el asiento no cuadra, en vez de callarlo', async () => {
    // An entry whose sides differ is a bug in the posting, and the user is the last person who
    // should find out afterwards.
    const el = await render({
      ...executable,
      effects: [
        {
          kind: 'ledger',
          titleKey: 'INVOICES.EFFECT.REVENUE_ENTRY',
          currencyCode: 'DOP',
          lines: [{ accountCode: '1101', accountName: 'CxC', debit: 100, credit: 0 }],
          totalDebit: 100,
          totalCredit: 90,
        },
      ],
    });
    expect(el.querySelector('.tp__warning')).toBeTruthy();
  });
});
