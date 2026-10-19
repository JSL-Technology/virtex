import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { Subject, catchError, debounceTime, distinctUntilChanged, map, of, startWith, switchMap, tap } from 'rxjs';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Crosshair,
  Download,
  ExternalLink,
  Info,
  Layers,
  List,
  Lock,
  LucideAngularModule,
  Network,
  RefreshCw,
  Search,
  Share2,
  X,
} from 'lucide-angular';
import { TranslateModule, FormatService } from '@virteex/shared/ui-i18n';
import { FlowCanvasComponent, FlowCanvasEdge, FlowCanvasNode, layeredLayout } from '../../shared/flow';
import { relationshipMapPath } from '../../shared/components/relationship-map-link';
import { ActiveOrganizationService } from '../../core/tenancy/active-organization.service';
import { NotificationService } from '../../core/services/notification';
import { TAB_CONTEXT } from '../../core/tabs/tab-context';
import {
  DocumentFlowMap,
  FLOW_DEFAULT_DEPTH,
  FLOW_DEFAULT_LIMIT,
  FLOW_DEPTH_CHOICES,
  FLOW_MAX_LIMIT,
  FlowDocumentSearchHit,
  FlowDocumentType,
  FlowDocumentTypeInfo,
  FlowEdge,
  FlowNode,
  FlowStatusKind,
  RelationshipMapService,
} from './data/relationship-map.service';
import { presentationOf } from './data/relationship-map.registry';
import { toCsv } from './relationship-map.csv';

/** One card as the canvas draws it: the document plus how it sits relative to the selection. */
export interface MapCard {
  node: FlowNode;
  icon: unknown;
  openable: boolean;
  selected: boolean;
  /** Not the selection nor one of its direct links, while something is selected or searched. */
  dimmed: boolean;
  /** Matches the in-map search. */
  match: boolean;
}

/** A link of the selected document, for the side panel. */
interface Relation {
  edge: FlowEdge;
  other: FlowNode;
  direction: 'in' | 'out';
}

type ViewMode = 'diagram' | 'list';

const PREFS_KEY = 'vx-relationship-map.prefs.v1';

interface Prefs {
  showPostings: boolean;
  view: ViewMode;
  depth: number;
}

/**
 * The document relationship map — SAP Business One's «Mapa de relaciones».
 *
 * Opened for one document (`:type/:id`, from the «Mapa de relaciones» button every document screen
 * carries), it draws the whole chain the document belongs to: the quotation it came from, the
 * invoice it became, the receipt that paid it, the entry each one posted.
 *
 * - **Diagram**: base documents on the left, derived ones to the right; every arrow says what the
 *   link is. Clicking a card selects it — its links light up, the rest dims, and the side panel
 *   shows its details and relations; double-clicking (or «Abrir») opens the document in its tab.
 * - **List**: the same chain as a sortable table, for reading, printing and screen readers.
 * - Journal entries can be hidden to read just the commercial flow; the depth can be widened when
 *   the server says the chain goes on; the chain exports to CSV.
 *
 * Opened from the menu, with no document in the address, it is a finder: search a document by
 * number across every type the user may read, and open its map.
 */
@Component({
  selector: 'app-relationship-map-page',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule, FlowCanvasComponent],
  templateUrl: './relationship-map.page.html',
  styleUrls: ['./relationship-map.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'clearSelection()' },
})
export class RelationshipMapPage {
  private readonly service = inject(RelationshipMapService);
  private readonly tenancy = inject(ActiveOrganizationService);
  private readonly router = inject(Router);
  private readonly format = inject(FormatService);
  private readonly translate = inject(TranslateService);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

  /** Route parameters, bound by the router's `withComponentInputBinding()`. */
  readonly type = input<string>('');
  readonly id = input<string>('');

  private readonly canvas = viewChild(FlowCanvasComponent);

  // ── Icons ──
  protected readonly ShareIcon = Share2;
  protected readonly InfoIcon = Info;
  protected readonly OpenIcon = ExternalLink;
  protected readonly LockIcon = Lock;
  protected readonly DownloadIcon = Download;
  protected readonly RefreshIcon = RefreshCw;
  protected readonly DiagramIcon = Network;
  protected readonly ListIcon = List;
  protected readonly SearchIcon = Search;
  protected readonly CloseIcon = X;
  protected readonly CenterIcon = Crosshair;
  protected readonly WarnIcon = AlertTriangle;
  protected readonly InIcon = ArrowLeft;
  protected readonly OutIcon = ArrowRight;
  protected readonly PostingsIcon = Layers;

  protected readonly legend: FlowStatusKind[] = ['draft', 'pending', 'open', 'closed', 'cancelled'];
  protected readonly depthChoices = FLOW_DEPTH_CHOICES;

  readonly hasTarget = computed(() => Boolean(this.type() && this.id()));

  // ── Preferences (per viewer, best effort) ──
  private readonly prefs = readPrefs();
  readonly showPostings = signal(this.prefs.showPostings);
  readonly view = signal<ViewMode>(this.prefs.view);
  readonly depth = signal<number>(this.prefs.depth);
  readonly limit = signal<number>(FLOW_DEFAULT_LIMIT);

  // ── Map state ──
  private readonly reload$ = new Subject<void>();
  readonly map = signal<DocumentFlowMap | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Whether trying again can help: not for a document that does not exist or may not be seen. */
  readonly retryable = signal(true);
  readonly selectedKey = signal<string | null>(null);
  readonly filter = signal('');

  // ── Finder state (no document in the address) ──
  readonly types = signal<FlowDocumentTypeInfo[]>([]);
  readonly searchText = signal('');
  readonly searchType = signal<FlowDocumentType | ''>('');
  readonly searching = signal(false);
  readonly results = signal<FlowDocumentSearchHit[] | null>(null);

  // ── Derived view ──

  /** Bumps on a language change, so labels translated with `instant` are recomputed. */
  private readonly lang = toSignal(this.translate.onLangChange.pipe(map((event) => event.lang)), {
    initialValue: this.translate.getCurrentLang(),
  });

  private readonly nodeByKey = computed(() => new Map((this.map()?.nodes ?? []).map((n) => [n.key, n])));

  /** Nodes and edges after the postings filter. The root is always kept. */
  private readonly visible = computed(() => {
    const map = this.map();
    if (!map) return { nodes: [] as FlowNode[], edges: [] as FlowEdge[] };
    const keep = (node: FlowNode) => node.root || this.showPostings() || node.type !== 'JOURNAL_ENTRY';
    const nodes = map.nodes.filter(keep);
    const keys = new Set(nodes.map((n) => n.key));
    return { nodes, edges: map.edges.filter((e) => keys.has(e.from) && keys.has(e.to)) };
  });

  readonly hiddenPostings = computed(() => (this.map()?.nodes.length ?? 0) - this.visible().nodes.length);

  private readonly matches = computed(() => {
    this.lang();
    const term = this.filter().trim().toLowerCase();
    if (!term) return null;
    const hits = new Set<string>();
    for (const node of this.visible().nodes) {
      const haystack = [node.number, node.party, node.description, this.translate.instant(node.typeKey)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (haystack.includes(term)) hits.add(node.key);
    }
    return hits;
  });

  /** The selected node and everything one link away, or null when nothing is selected. */
  private readonly neighbourhood = computed(() => {
    const key = this.selectedKey();
    if (!key) return null;
    const around = new Set<string>([key]);
    for (const edge of this.visible().edges) {
      if (edge.from === key) around.add(edge.to);
      if (edge.to === key) around.add(edge.from);
    }
    return around;
  });

  readonly cards = computed<MapCard[]>(() => {
    const around = this.neighbourhood();
    const matches = this.matches();
    return this.visible().nodes.map((node) => {
      const presentation = presentationOf(node.type);
      const match = !!matches?.has(node.key);
      // A search, when there is one, decides what stands out; otherwise the selection does.
      const dimmed = matches ? !match && node.key !== this.selectedKey() : around ? !around.has(node.key) : false;
      return {
        node,
        icon: presentation.icon,
        openable: !node.restricted && !!presentation.route,
        selected: node.key === this.selectedKey(),
        dimmed,
        match,
      };
    });
  });

  private readonly positions = computed(() => {
    const { nodes, edges } = this.visible();
    return layeredLayout(
      nodes.map((n) => n.key),
      edges.map((e) => ({ from: e.from, to: e.to })),
      { nodeWidth: 260, nodeHeight: 128, hGap: 150, vGap: 32 },
    );
  });

  readonly canvasNodes = computed<FlowCanvasNode<MapCard>[]>(() => {
    const positions = this.positions();
    return this.cards().map((card) => ({
      id: card.node.key,
      position: positions.get(card.node.key) ?? { x: 0, y: 0 },
      data: card,
    }));
  });

  readonly canvasEdges = computed<FlowCanvasEdge<FlowEdge>[]>(() => {
    this.lang();
    const around = this.neighbourhood();
    const selected = this.selectedKey();
    return this.visible().edges.map((edge) => {
      const active = !!selected && (edge.from === selected || edge.to === selected);
      const dim = !!around && !active;
      return {
        id: edge.key,
        source: edge.from,
        target: edge.to,
        label: this.translate.instant(edge.relationKey),
        cssClass: `vx-flow-edge--${edge.category}${active ? ' vx-flow-edge--active' : ''}${dim ? ' vx-flow-edge--dim' : ''}`,
        data: edge,
      };
    });
  });

  /** The list view's rows: the chain in reading order (depth, then date). */
  readonly rows = computed(() => {
    const around = this.matches();
    return this.cards().filter((card) => !around || card.match);
  });

  readonly selected = computed(() => {
    const key = this.selectedKey();
    return key ? this.nodeByKey().get(key) ?? null : null;
  });

  readonly selectedRelations = computed<Relation[]>(() => {
    const key = this.selectedKey();
    if (!key) return [];
    const nodes = this.nodeByKey();
    const out: Relation[] = [];
    for (const edge of this.map()?.edges ?? []) {
      if (edge.to === key && nodes.has(edge.from)) out.push({ edge, other: nodes.get(edge.from)!, direction: 'in' });
      if (edge.from === key && nodes.has(edge.to)) out.push({ edge, other: nodes.get(edge.to)!, direction: 'out' });
    }
    return out.sort((a, b) => (a.direction === b.direction ? 0 : a.direction === 'in' ? -1 : 1));
  });

  readonly rootNode = computed(() => {
    const map = this.map();
    return map ? this.nodeByKey().get(map.root) ?? null : null;
  });

  readonly summary = computed(() => {
    const { nodes, edges } = this.visible();
    return { documents: nodes.length, links: edges.length };
  });

  readonly canWiden = computed(() => {
    const map = this.map();
    if (!map?.truncated) return false;
    return (map.truncation.depth && this.depth() < FLOW_DEPTH_CHOICES[FLOW_DEPTH_CHOICES.length - 1]) ||
      (map.truncation.nodes && this.limit() < FLOW_MAX_LIMIT);
  });

  constructor() {
    // The map: one request per (document, limits, reload), the previous one cancelled.
    const request = computed(() => ({ type: this.type(), id: this.id(), depth: this.depth(), limit: this.limit() }));
    toObservable(request)
      .pipe(
        switchMap((req) =>
          this.reload$.pipe(
            startWith(undefined),
            map(() => req),
          ),
        ),
        tap((req) => {
          if (!req.type || !req.id) return;
          this.loading.set(true);
          this.error.set(null);
        }),
        switchMap((req) => {
          if (!req.type || !req.id) return of(null);
          return this.service.map(req.type, req.id, { depth: req.depth, limit: req.limit }).pipe(
            catchError((err: unknown) => {
              const status = err instanceof HttpErrorResponse ? err.status : 0;
              this.retryable.set(!(status >= 400 && status < 500 && status !== 408 && status !== 429));
              this.error.set(this.errorMessage(err));
              return of(null);
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        this.loading.set(false);
        if (!result) return;
        const keep = this.selectedKey();
        this.map.set(result);
        if (keep && !result.nodes.some((n) => n.key === keep)) this.selectedKey.set(null);
        this.applyTitle(result);
      });

    // Opening a different document starts with nothing selected.
    effect(() => {
      this.type();
      this.id();
      this.selectedKey.set(null);
      this.filter.set('');
    });

    // The finder: types once, search as the user types (debounced, previous cancelled).
    effect(() => {
      if (!this.hasTarget() && this.types().length === 0) {
        this.service.types().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: (types) => this.types.set(types),
          error: () => this.types.set([]),
        });
      }
    });
    const query = computed(() => ({ q: this.searchText().trim(), type: this.searchType() }));
    toObservable(query)
      .pipe(
        debounceTime(250),
        distinctUntilChanged((a, b) => a.q === b.q && a.type === b.type),
        switchMap(({ q, type }) => {
          if (q.length < 2) {
            this.searching.set(false);
            return of(null);
          }
          this.searching.set(true);
          return this.service.search(q, type || null).pipe(catchError(() => of([] as FlowDocumentSearchHit[])));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((hits) => {
        this.searching.set(false);
        this.results.set(hits);
      });

    // Preferences survive the tab.
    effect(() => writePrefs({ showPostings: this.showPostings(), view: this.view(), depth: this.depth() }));
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  refresh(): void {
    this.reload$.next();
  }

  select(node: FlowNode): void {
    this.selectedKey.set(node.key);
  }

  selectKey(key: string): void {
    this.selectedKey.set(key);
    if (this.view() === 'diagram') this.canvas()?.centerOn(key);
  }

  clearSelection(): void {
    this.selectedKey.set(null);
  }

  open(node: FlowNode): void {
    const route = presentationOf(node.type).route;
    if (node.restricted || !route) return;
    void this.router.navigateByUrl(this.tenancy.urlFor(route(node.id)));
  }

  /** Re-centre the map on another document: its own chain, in this tab's place. */
  reroot(node: FlowNode): void {
    if (node.restricted) return;
    void this.router.navigateByUrl(this.tenancy.urlFor(relationshipMapPath(node.type, node.id)));
  }

  openHit(hit: FlowDocumentSearchHit): void {
    void this.router.navigateByUrl(this.tenancy.urlFor(relationshipMapPath(hit.type, hit.id)));
  }

  togglePostings(): void {
    this.showPostings.update((v) => !v);
    const selected = this.selected();
    if (selected && !this.showPostings() && selected.type === 'JOURNAL_ENTRY' && !selected.root) this.clearSelection();
  }

  setDepth(value: string): void {
    const depth = Number(value);
    if (Number.isFinite(depth)) this.depth.set(depth);
  }

  /** Lift whichever limit the server reported hitting. */
  widen(): void {
    const map = this.map();
    if (!map) return;
    if (map.truncation.depth) {
      const next = FLOW_DEPTH_CHOICES.find((choice) => choice > this.depth());
      if (next) this.depth.set(next);
    }
    if (map.truncation.nodes) this.limit.set(Math.min(this.limit() * 2, FLOW_MAX_LIMIT));
  }

  exportCsv(): void {
    const map = this.map();
    const root = this.rootNode();
    if (!map || !root) return;
    const header = ['type', 'number', 'party', 'date', 'amount', 'currency', 'status', 'description', 'depth'].map(
      (column) => this.translate.instant(`relationship_map.csv.${column}`),
    );
    const lines = this.visible().nodes.map((node) => [
      this.translate.instant(node.typeKey),
      node.restricted ? this.translate.instant('relationship_map.node.restricted') : node.number ?? '',
      node.party ?? '',
      node.date ?? '',
      node.amount ?? '',
      node.currencyCode ?? '',
      this.translate.instant(this.statusKey(node.statusKind)),
      node.description ?? '',
      node.depth,
    ]);
    const blob = new Blob(['﻿' + toCsv([header, ...lines])], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.translate.instant('relationship_map.csv.file')}-${(root.number ?? root.id).replace(/[^\w.-]+/g, '_')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  // ── Presentation helpers ─────────────────────────────────────────────────────

  /** Built as template literals so `verify-catalogues` sees the families. */
  statusKey(kind: FlowStatusKind): string {
    return `relationship_map.status.${kind}`;
  }

  moduleKey(module: string): string {
    return `relationship_map.module.${module}`;
  }

  categoryKey(category: string): string {
    return `relationship_map.category.${category}`;
  }

  money(node: { amount: number | null; currencyCode: string | null }): string {
    return node.amount === null ? '' : this.format.money(node.amount, node.currencyCode);
  }

  dateOf(node: { date: string | null }): string {
    return node.date ? this.format.date(node.date) : '';
  }

  iconOf(type: string): unknown {
    return presentationOf(type).icon;
  }

  canOpen(node: FlowNode): boolean {
    return !node.restricted && !!presentationOf(node.type).route;
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  /** Name the tab for the root document, e.g. «Mapa · Factura FAC-00128». */
  private applyTitle(map: DocumentFlowMap): void {
    const root = map.nodes.find((node) => node.key === map.root);
    if (!root || !this.tab) return;
    const type = this.translate.instant(root.typeKey);
    this.tab.setTitle(root.number ? `${type} ${root.number}` : type);
  }

  private errorMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse && err.status === 403) {
      return this.translate.instant('relationship_map.forbidden');
    }
    return this.notifications.httpErrorMessage(err, 'relationship_map.load_failed');
  }
}

function readPrefs(): Prefs {
  const fallback: Prefs = { showPostings: true, view: 'diagram', depth: FLOW_DEFAULT_DEPTH };
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    if (!raw) return fallback;
    return {
      showPostings: typeof raw.showPostings === 'boolean' ? raw.showPostings : fallback.showPostings,
      view: raw.view === 'list' ? 'list' : 'diagram',
      depth: (FLOW_DEPTH_CHOICES as readonly number[]).includes(Number(raw.depth)) ? Number(raw.depth) : fallback.depth,
    };
  } catch {
    return fallback;
  }
}

function writePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* Storage blocked: preferences simply do not persist. */
  }
}
