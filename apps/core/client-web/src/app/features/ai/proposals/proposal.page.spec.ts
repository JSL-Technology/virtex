import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { NotificationService } from '../../../core/services/notification';
import { CopilotApiService } from '../copilot/copilot-api.service';
import { ProposalPage } from './proposal.page';

const PENDING = {
  id: 'p1', tool: 'draft_quote', summary: 'Cotización para Cliente de prueba', status: 'PROPOSED', channel: 'MCP', afterExternalText: true,
  result: null, error: null,
  preview: { customer: 'Cliente de prueba', total: 1180, lines: [{ description: 'Servicio', quantity: 2, unitPrice: 500 }] },
};

describe('ProposalPage', () => {
  let fixture: ComponentFixture<ProposalPage>;
  let api: Record<string, jest.Mock>;

  async function create(proposal = of(PENDING)) {
    api = {
      proposal: jest.fn().mockReturnValue(proposal),
      confirm: jest.fn().mockReturnValue(of({ ...PENDING, status: 'CONFIRMED', result: { id: 'q1', label: 'COT-1', link: '/sales/quotes/q1' } })),
      reject: jest.fn().mockReturnValue(of({ ...PENDING, status: 'REJECTED' })),
    };
    await TestBed.configureTestingModule({
      imports: [ProposalPage],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'p1' }) } } },
        { provide: CopilotApiService, useValue: api },
        { provide: NotificationService, useValue: { showHttpError: jest.fn() } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ProposalPage);
    fixture.detectChanges();
  }

  afterEach(() => fixture.destroy());

  it('shows a proposal from an external agent with its warning and lines', async () => {
    await create();
    expect(api['proposal']).toHaveBeenCalledWith('p1');
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('ai.mcp.proposal_from_agent');
    expect(text).toContain('Servicio');
    expect(fixture.componentInstance.lines(PENDING as never)[0].amount).toBe(1000);
  });

  it('confirms and links to what was created', async () => {
    await create();
    fixture.componentInstance.decide('confirm');
    fixture.detectChanges();
    expect(api['confirm']).toHaveBeenCalledWith('p1');
    expect(fixture.nativeElement.querySelector('a')?.getAttribute('href')).toBe('/sales/quotes/q1');
  });

  it('says so when the proposal does not exist or is not yours', async () => {
    await create(throwError(() => ({ status: 404 })));
    expect(fixture.nativeElement.textContent).toContain('ai.copilot.proposal_not_found');
  });
});
