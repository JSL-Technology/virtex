import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { CopilotPanelComponent } from './copilot-panel.component';
import { CopilotApiService, CopilotEvent, CopilotProposal } from './copilot-api.service';

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
