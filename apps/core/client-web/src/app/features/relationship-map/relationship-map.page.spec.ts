import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';

import { Observable, of, throwError } from 'rxjs';
import { TranslateModule, FormatService } from '@virteex/shared/ui-i18n';
import { NotificationService } from '../../core/services/notification';
import { ActiveOrganizationService } from '../../core/tenancy/active-organization.service';
import { DocumentFlowMap, FlowNode, RelationshipMapService } from './data/relationship-map.service';
import { RelationshipMapPage } from './relationship-map.page';

const node = (key: string, extra: Partial<FlowNode> = {}): FlowNode => {
  const [type, id] = key.split(':');
  return {
    key,
    type: type as FlowNode['type'],
    id,
    module: 'sales',
    typeKey: `relationship_map.doc.${type.toLowerCase()}`,
    number: `N-${id}`,
    subtypeKey: null,
    description: null,
    date: '2026-10-12',
    statusKind: 'open',
    statusRaw: null,
    amount: 100,
    currencyCode: 'DOP',
    party: null,
    root: false,
    depth: 1,
    restricted: false,
    ...extra,
  };
};

/** quote → invoice (root) → receipt; invoice and receipt each post an entry. */
const MAP: DocumentFlowMap = {
  root: 'SALES_INVOICE:2',
  nodes: [
    node('SALES_INVOICE:2', { root: true, depth: 0 }),
    node('SALES_QUOTE:1'),
    node('CUSTOMER_PAYMENT:4', { restricted: true, number: null, amount: null }),
    node('JOURNAL_ENTRY:3', { module: 'finance' }),
    node('JOURNAL_ENTRY:5', { module: 'finance', depth: 2 }),
  ],
  edges: [
    { key: 'a', from: 'SALES_QUOTE:1', to: 'SALES_INVOICE:2', relation: 'invoiced', relationKey: 'relationship_map.rel.invoiced', category: 'flow' },
    { key: 'b', from: 'SALES_INVOICE:2', to: 'CUSTOMER_PAYMENT:4', relation: 'settled_by', relationKey: 'relationship_map.rel.settled_by', category: 'settlement' },
    { key: 'c', from: 'SALES_INVOICE:2', to: 'JOURNAL_ENTRY:3', relation: 'posted', relationKey: 'relationship_map.rel.posted', category: 'posting' },
    { key: 'd', from: 'CUSTOMER_PAYMENT:4', to: 'JOURNAL_ENTRY:5', relation: 'posted', relationKey: 'relationship_map.rel.posted', category: 'posting' },
  ],
  truncated: true,
  truncation: { nodes: false, depth: true, fanOut: false },
  limits: { maxNodes: 150, maxDepth: 4 },
  depthReached: 2,
  generatedAt: '2026-10-13T00:00:00Z',
};

describe('RelationshipMapPage', () => {
  let mapResponse: () => Observable<DocumentFlowMap>;
  const api = {
    map: jest.fn((_type: string, _id: string, _opts?: unknown) => mapResponse()),
    types: jest.fn(() => of([])),
    search: jest.fn(() => of([])),
  };

  function create() {
    TestBed.configureTestingModule({
      imports: [RelationshipMapPage, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: RelationshipMapService, useValue: api },
        { provide: FormatService, useValue: { money: (n: number) => `RD$${n}`, date: (d: string) => d } },
        { provide: NotificationService, useValue: { httpErrorMessage: () => 'failed' } },
        { provide: ActiveOrganizationService, useValue: { urlFor: (p: string) => `/acme/${p}` } },
      ],
    });
    const fixture = TestBed.createComponent(RelationshipMapPage);
    fixture.componentRef.setInput('type', 'SALES_INVOICE');
    fixture.componentRef.setInput('id', '2');
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    // The list view: the diagram needs a real layout engine the test DOM does not have.
    localStorage.setItem('vx-relationship-map.prefs.v1', JSON.stringify({ view: 'list', showPostings: true, depth: 4 }));
    mapResponse = () => of(MAP);
    api.map.mockClear();
  });

  it('loads the map for the document in the address, with the chosen depth', () => {
    const page = create().componentInstance;
    expect(api.map).toHaveBeenCalledWith('SALES_INVOICE', '2', { depth: 4, limit: 150 });
    expect(page.rows()).toHaveLength(5);
    expect(page.rootNode()?.key).toBe('SALES_INVOICE:2');
  });

  it('hides journal entries on request, keeping their count visible', () => {
    const page = create().componentInstance;
    page.togglePostings();
    expect(page.rows().map((r) => r.node.type)).not.toContain('JOURNAL_ENTRY');
    expect(page.hiddenPostings()).toBe(2);
    expect(page.summary()).toEqual({ documents: 3, links: 2 });
  });

  it('selecting a document lists its links in both directions and dims the rest', () => {
    const page = create().componentInstance;
    page.select(MAP.nodes[0]);
    expect(page.selectedRelations().map((r) => `${r.direction}:${r.other.key}`)).toEqual([
      'in:SALES_QUOTE:1',
      'out:CUSTOMER_PAYMENT:4',
      'out:JOURNAL_ENTRY:3',
    ]);
    const dimmed = page.cards().filter((c) => c.dimmed).map((c) => c.node.key);
    expect(dimmed).toEqual(['JOURNAL_ENTRY:5']);
  });

  it('the in-map search narrows the list to matching documents', () => {
    const page = create().componentInstance;
    page.filter.set('N-1');
    expect(page.rows().map((r) => r.node.key)).toEqual(['SALES_QUOTE:1']);
  });

  it('never opens a restricted document, and opens a permitted one in its own route', () => {
    const fixture = create();
    const router = TestBed.inject(Router);
    const navigate = jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture.componentInstance.open(MAP.nodes[2]);
    expect(navigate).not.toHaveBeenCalled();
    fixture.componentInstance.open(MAP.nodes[1]);
    expect(navigate).toHaveBeenCalledWith('/acme/quotes/1/edit');
  });

  it('widens the depth the server said it stopped at', () => {
    const fixture = create();
    const page = fixture.componentInstance;
    expect(page.canWiden()).toBe(true);
    page.widen();
    fixture.detectChanges();
    expect(page.depth()).toBe(8);
    expect(api.map).toHaveBeenLastCalledWith('SALES_INVOICE', '2', { depth: 8, limit: 150 });
  });

  it('does not offer to retry a document that does not exist', () => {
    mapResponse = () => throwError(() => new HttpErrorResponse({ status: 404 }));
    const page = create().componentInstance;
    expect(page.error()).toBe('failed');
    expect(page.retryable()).toBe(false);
  });

  it('offers to retry a server failure', () => {
    mapResponse = () => throwError(() => new HttpErrorResponse({ status: 503 }));
    const page = create().componentInstance;
    expect(page.retryable()).toBe(true);
  });
});
