import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  LucideAngularModule,
  BookOpen,
  ClipboardList,
  ExternalLink,
  FileCheck,
  FileText,
  HandCoins,
  Info,
  PackageCheck,
  Receipt,
  Share2,
  ShoppingBag,
  ShoppingCart,
} from 'lucide-angular';
import { FormatService } from '@virteex/shared/ui-i18n';
import { FlowCanvasComponent, FlowCanvasEdge, FlowCanvasNode, layeredLayout } from '../../shared/flow';
import { ActiveOrganizationService } from '../../core/tenancy/active-organization.service';
import { NotificationService } from '../../core/services/notification';
import { TAB_CONTEXT } from '../../core/tabs/tab-context';
import {
  DocumentFlowMap,
  FlowEdge,
  FlowNode,
  FlowStatusKind,
  RelationshipMapService,
} from './data/relationship-map.service';

/**
 * The document relationship map — SAP Business One's «Mapa de relaciones».
 *
 * Opened for one document (`:type/:id`, usually from that document's own screen), it draws the whole
 * chain the document belongs to: the quotation it came from, the invoice it became, the receipt that
 * paid it, the journal entry each one posted. Nodes are the shared Foblex canvas; each is clickable
 * when the type has a screen, and opening one is the same as navigating — the workspace focuses or
 * opens its tab. With no document in the address it explains where to open it from, rather than
 * drawing an empty canvas.
 */
@Component({
  selector: 'app-relationship-map-page',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule, FlowCanvasComponent],
  templateUrl: './relationship-map.page.html',
  styleUrls: ['./relationship-map.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RelationshipMapPage {
  private readonly service = inject(RelationshipMapService);
  private readonly tenancy = inject(ActiveOrganizationService);
  private readonly router = inject(Router);
  private readonly format = inject(FormatService);
  private readonly translate = inject(TranslateService);
  private readonly notifications = inject(NotificationService);
  private readonly tab = inject(TAB_CONTEXT, { optional: true });

  /** Route parameters, bound by the router's `withComponentInputBinding()`. */
  readonly type = input<string>('');
  readonly id = input<string>('');

  readonly map = signal<DocumentFlowMap | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  protected readonly ShareIcon = Share2;
  protected readonly InfoIcon = Info;
  protected readonly OpenIcon = ExternalLink;

  /** The legend, ordered as a transaction tends to progress. */
  protected readonly legend: FlowStatusKind[] = ['open', 'closed', 'cancelled', 'draft'];

  /** Icon per document type, resolved to Lucide components (the server sends the name too). */
  private readonly icons: Record<string, unknown> = {
    SALES_QUOTE: FileText,
    SALES_INVOICE: Receipt,
    CUSTOMER_PAYMENT: HandCoins,
    POS_SALE: ShoppingCart,
    ECF_SUBMISSION: FileCheck,
    PURCHASE_REQUISITION: ClipboardList,
    PURCHASE_ORDER: ShoppingBag,
    GOODS_RECEIPT: PackageCheck,
    VENDOR_BILL: FileText,
    JOURNAL_ENTRY: BookOpen,
  };

  readonly hasTarget = computed(() => Boolean(this.type() && this.id()));

  private readonly view = computed<{
    nodes: FlowCanvasNode<FlowNode>[];
    edges: FlowCanvasEdge<FlowEdge>[];
  }>(() => {
    const map = this.map();
    if (!map) return { nodes: [], edges: [] };
    const positions = layeredLayout(
      map.nodes.map((node) => node.key),
      map.edges.map((edge) => ({ from: edge.from, to: edge.to })),
    );
    return {
      nodes: map.nodes.map((node) => ({
        id: node.key,
        position: positions.get(node.key) ?? { x: 0, y: 0 },
        data: node,
      })),
      edges: map.edges.map((edge) => ({
        id: `${edge.from}__${edge.to}__${edge.relationKey}`,
        source: edge.from,
        target: edge.to,
        data: edge,
      })),
    };
  });

  readonly canvasNodes = computed(() => this.view().nodes);
  readonly canvasEdges = computed(() => this.view().edges);

  constructor() {
    effect(() => {
      const type = this.type();
      const id = this.id();
      if (type && id) this.load(type, id);
    });
  }

  private load(type: string, id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.map(type, id).subscribe({
      next: (map) => {
        this.map.set(map);
        this.loading.set(false);
        this.applyTitle(map);
      },
      error: (err: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(err, 'relationship_map.load_failed'));
        this.loading.set(false);
      },
    });
  }

  /** Name the tab for the root document, e.g. «Factura FAC-00128». */
  private applyTitle(map: DocumentFlowMap): void {
    const root = map.nodes.find((node) => node.key === map.root);
    if (!root || !this.tab) return;
    const type = this.translate.instant(root.typeKey);
    this.tab.setTitle(root.number ? `${type} ${root.number}` : type);
  }

  iconFor(node: FlowNode): unknown {
    return this.icons[node.type] ?? FileText;
  }

  /** Built as a template literal so `verify-catalogues` sees the `relationship_map.status.*` family. */
  statusKey(kind: FlowStatusKind): string {
    return `relationship_map.status.${kind}`;
  }

  money(node: FlowNode): string {
    return node.amount === null ? '' : this.format.money(node.amount, node.currencyCode);
  }

  dateOf(node: FlowNode): string {
    return node.date ? this.format.date(node.date) : '';
  }

  open(node: FlowNode): void {
    if (!node.route) return;
    void this.router.navigateByUrl(this.tenancy.urlFor(node.route));
  }
}
