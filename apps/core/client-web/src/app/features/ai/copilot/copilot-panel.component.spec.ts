import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { CopilotPanelComponent } from './copilot-panel.component';
import { CopilotApiService, CopilotChart, CopilotEvent, CopilotProposal } from './copilot-api.service';

const chart: CopilotChart = {
  id: 'g-1',
  title: 'Ventas por mes',
  type: 'column',
  sourceTool: 'sales_trend',
  pinned: false,
  createdAt: '2026-10-19T00:00:00Z',
  data: {
    categories: ['2026-08', '2026-09'],
    series: [{ name: 'Ventas', values: [100, 250] }],
    unit: 'DOP',
    omitted: 0,
    drawnAt: '2026-10-19T00:00:00Z',
  },
};

const proposal: CopilotProposal = {
  id: 'p-1',
  tool: 'draft_quote',
  summary: 'Draft quote for Acme',
  preview: { customerName: 'Acme', total: 118, lines: [{ description: 'Café', quantity: 2, subtotal: 100 }] },
  status: 'PROPOSED',
  result: null,
  error: null,
};

describe('CopilotPanelComponent', () => {
  let fixture: ComponentFixture<CopilotPanelComponent>;
  let component: CopilotPanelComponent;
  let api: Record<string, jest.Mock>;
  let turn: Subject<CopilotEvent>;

  const setup = async (overrides: Record<string, jest.Mock> = {}) => {
    turn = new Subject<CopilotEvent>();
    api = {
      capabilities: jest.fn().mockReturnValue(of([{ name: 'receivables_aging', kind: 'read' }, { name: 'draft_quote', kind: 'draft' }])),
      conversations: jest.fn().mockReturnValue(of([])),
      create: jest.fn().mockReturnValue(of({ id: 'c-1', title: '', createdAt: '', updatedAt: '' })),
      send: jest.fn().mockReturnValue(turn),
      confirm: jest.fn().mockReturnValue(of({ ...proposal, status: 'CONFIRMED', result: { id: 'q-1', link: '/quotes/q-1/edit', label: 'COT-1' } })),
      reject: jest.fn().mockReturnValue(of({ ...proposal, status: 'REJECTED' })),
      transcript: jest.fn(),
      remove: jest.fn().mockReturnValue(of(undefined)),
      pin: jest.fn().mockReturnValue(of({ ...chart, pinned: true })),
      unpin: jest.fn().mockReturnValue(of(undefined)),
      feedback: jest.fn().mockReturnValue(of({ seq: 2, verdict: 'UP' })),
      ...overrides,
    };
    await TestBed.configureTestingModule({
      imports: [CopilotPanelComponent],
      providers: [provideRouter([]), { provide: CopilotApiService, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(CopilotPanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  it('announces a finished answer once, links its records, and takes a rating', async () => {
    await setup();
    const live = () => fixture.nativeElement.querySelector('[aria-live]') as HTMLElement;
    // The conversation itself is no live region: a reader would hear every fragment.
    expect(fixture.nativeElement.querySelector('.cp__messages').getAttribute('aria-live')).toBeNull();
    component.draft.set('¿Qué facturas vencen?');
    component.send();
    turn.next({ type: 'text', delta: 'Vence **FAC-1**.' });
    fixture.detectChanges();
    expect(live().textContent?.trim()).toBe('');
    turn.next({
      type: 'done',
      result: {
        text: '', stopReason: 'end_turn', toolsUsed: ['list_invoices'], proposals: [], answerSeq: 2,
        sources: [{ tool: 'list_invoices', type: 'invoice', id: 'i-1', label: 'FAC-1', link: '/invoices/i-1' }],
      },
    });
    turn.complete();
    fixture.detectChanges();
    expect(live().textContent).toContain('Vence');
    expect(fixture.nativeElement.querySelector('.cp__record').getAttribute('href')).toBe('/invoices/i-1');

    (fixture.nativeElement.querySelector('.cp__feedback button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(api['feedback']).toHaveBeenCalledWith('c-1', 2, 'UP');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cp__feedback button').getAttribute('aria-pressed')).toBe('true');
  });

  it('warns on a draft proposed after reading text from outside the company', async () => {
    await setup();
    component.draft.set('cotiza la nota');
    component.send();
    turn.next({ type: 'proposal', proposal: { ...proposal, afterExternalText: true } });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cp__external')).not.toBeNull();
  });

  it('suggests only what the person can ask about', async () => {
    await setup();
    expect(component.suggestions().map((suggestion) => suggestion.tool)).toEqual(['receivables_aging', 'draft_quote']);
  });

  it('streams an answer, shows the sources, and starts the conversation on the first question', async () => {
    await setup();
    component.draft.set('¿Quién me debe?');
    component.send();
    expect(api['create']).toHaveBeenCalled();
    expect(api['send']).toHaveBeenCalledWith('c-1', '¿Quién me debe?');
    expect(component.canSend()).toBe(false);

    turn.next({ type: 'tool', name: 'receivables_aging' });
    turn.next({ type: 'text', delta: 'Acme te debe ' });
    turn.next({ type: 'text', delta: '1,500.' });
    turn.next({ type: 'done', result: { text: '', stopReason: 'end_turn', toolsUsed: ['receivables_aging'], proposals: [] } });
    turn.complete();

    const answer = component.messages().at(-1)!;
    expect(answer).toMatchObject({ role: 'assistant', text: 'Acme te debe 1,500.', toolsUsed: ['receivables_aging'], streaming: false });
    expect(component.streaming()).toBe(false);
  });

  it('a proposal is a card; only Confirm creates the draft, and then it links to it', async () => {
    await setup();
    component.ask('Cotiza 2 cafés a Acme');
    turn.next({ type: 'proposal', proposal });
    turn.next({ type: 'done', result: { text: '', stopReason: 'end_turn', toolsUsed: ['draft_quote'], proposals: ['p-1'] } });
    turn.complete();
    fixture.detectChanges();

    expect(api['confirm']).not.toHaveBeenCalled();
    expect(component.previewLines(component.proposal('p-1')!)).toEqual([{ description: 'Café', quantity: 2, amount: 100 }]);

    component.confirm(component.proposal('p-1')!);
    fixture.detectChanges();
    expect(api['confirm']).toHaveBeenCalledWith('p-1');
    expect(component.proposal('p-1')).toMatchObject({ status: 'CONFIRMED' });
    const link: HTMLAnchorElement | null = fixture.nativeElement.querySelector('.cp__created');
    expect(link?.getAttribute('href')).toBe('/quotes/q-1/edit');
  });

  it('draws a chart in the answer, with its data as a table, and pins it to the dashboard', async () => {
    await setup();
    component.ask('Gráfico de ventas');
    turn.next({ type: 'tool', name: 'sales_trend' });
    turn.next({ type: 'chart', chart });
    turn.next({ type: 'done', result: { text: '', stopReason: 'end_turn', toolsUsed: ['show_chart', 'sales_trend'], proposals: [] } });
    turn.complete();
    fixture.detectChanges();

    expect(component.messages().at(-1)).toMatchObject({ charts: ['g-1'] });
    const figure: HTMLElement = fixture.nativeElement.querySelector('app-copilot-chart');
    expect(figure.textContent).toContain('Ventas por mes');
    expect(figure.querySelectorAll('tbody tr')).toHaveLength(2);

    (figure.querySelector('.cc__pin') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(api['pin']).toHaveBeenCalledWith('g-1');
    expect(component.chart('g-1')).toMatchObject({ pinned: true });

    component.togglePin(component.chart('g-1')!);
    expect(api['unpin']).toHaveBeenCalledWith('g-1');
    expect(component.chart('g-1')).toMatchObject({ pinned: false });
  });

  it('shows the server’s reason when the plan does not include the assistant, and does not send', async () => {
    await setup({
      capabilities: jest.fn().mockReturnValue(throwError(() => ({ status: 403, error: { messageKey: 'saas.feature_disabled', message: 'Tu plan no incluye el asistente.' } }))),
    });
    expect(component.unavailable()).toBe('Tu plan no incluye el asistente.');
    component.draft.set('hola');
    expect(component.canSend()).toBe(false);
  });

  it('an error event ends the answer with the localized message', async () => {
    await setup();
    component.ask('hola');
    turn.next({ type: 'error', key: 'ai.credits_exhausted', message: 'Sin créditos de IA.' });
    turn.complete();
    expect(component.messages().at(-1)).toMatchObject({ error: 'Sin créditos de IA.', streaming: false });
  });
});
