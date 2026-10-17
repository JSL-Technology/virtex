import { composeKey } from '@virteex/shared/types';
import { VxDatePipe, VxPluralKeyPipe } from '@virteex/shared/ui-i18n';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  EnvironmentInjector,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  F_A11Y_CONFIG,
  F_DEFAULT_CONTROL_SCHEME,
  F_DRAG_SELECT_CONTROL_SCHEME,
  F_SCROLL_PAN_CONTROL_SCHEME,
  FControlSchemeController,
  mergeA11yConfig,
  provideFFlow,
  withA11y,
  withConnectionFlow,
  withControlScheme,
} from '@foblex/flow';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  AlertTriangle,
  ChevronDown,
  CircleAlert,
  History,
  CircleCheck,
  Copy,
  Download,
  GitBranchPlus,
  Keyboard,
  LayoutGrid,
  LucideAngularModule,
  Maximize,
  Minus,
  PanelLeft,
  PanelRight,
  Plus,
  Redo2,
  Save,
  Search,
  Send,
  Settings2,
  Trash2,
  Undo2,
  Upload,
  X,
  EyeOff,
} from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { AuthService } from '../../../core/services/auth';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { TabEvent } from '../../../core/tabs/tab-event-bus.service';
import { VxBadgeComponent } from '../../../shared/components/badge/badge.component';
import { VxDialogComponent } from '../../../shared/components/dialog';
import { VxKbdComponent } from '../../../shared/components/kbd';
import type { KeyChord } from '../../../core/keyboard/keyboard-shortcuts';
import {
  definitionStatusKey,
  definitionStatusTone,
  eventLabel,
  issueMessage,
  nodeTypeKey,
  outcomeLabel,
  pluralKey,
} from '../data/workflow-labels';
import {
  WorkflowDefinition,
  WorkflowGraphNode,
  WorkflowIssue,
  WorkflowNodeType,
  WorkflowService,
  WorkflowVersionSummary,
} from '../data/workflow.service';
import { DesignerCatalogs } from './designer-catalogs';
import { computeLayout, LayoutEngineName } from './designer-layout';
import { DesignerPaletteComponent, PaletteItem } from './designer-palette.component';
import { DesignerClipboard, DesignerStore, NODE_HEIGHT, NODE_WIDTH } from './designer-store';
import { EdgePanelComponent } from './panels/edge-panel.component';
import { GroupPanelComponent } from './panels/group-panel.component';
import { NodePanelComponent } from './panels/node-panel.component';
import { ProcessPanelComponent } from './panels/process-panel.component';
import { setSummaryLocale, summarizePredicate } from './predicate-summary';
import { LocaleStore } from '@virteex/shared/ui-i18n';
import {
  CanvasEdge,
  CanvasGroup,
  CanvasNode,
  CanvasPrefs,
  CanvasSelection,
  DEFAULT_CANVAS_PREFS,
  WorkflowCanvasComponent,
} from './workflow-canvas.component';

type ControlScheme = 'default' | 'select' | 'scroll';
type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

const PREFS_KEY = 'vx.workflow.designer.prefs';
const AUTOSAVE_MS = 2500;
const VALIDATE_MS = 600;
const IMPORT_LIMIT_BYTES = 2 * 1024 * 1024;
const NEGATIVE_OUTCOMES = new Set(['reject', 'error', 'return', 'deny', 'cancel']);

interface StoredPrefs extends CanvasPrefs {
  scheme: ControlScheme;
  palette: boolean;
  inspector: boolean;
}

/** In-memory clipboard shared by every designer tab, for when the system clipboard is unavailable. */
let sessionClipboard: DesignerClipboard | null = null;

/**
 * The Business Workflow designer.
 *
 * A Foblex Flow canvas between a palette and an inspector. Steps are dragged in from the palette,
 * connected by dragging between ports, arranged by hand (with magnetic guides and a grid) or by
 * Dagre/ELK auto-layout, grouped in lanes, and configured in the inspector. Everything goes
 * through {@link DesignerStore}, which gives undo/redo, copy/paste with fresh ids and a single
 * notion of «unsaved changes» the tab understands.
 *
 * Drafts save themselves a moment after each change (with optimistic concurrency against edits
 * from another tab or person) and are validated on the server as they are drawn, so problems show
 * on the step they concern long before «publish». Published and archived versions open read-only;
 * «new version» is the way to change them.
 */
@Component({
  selector: 'app-workflow-designer-page',
  standalone: true,
  imports: [
    VxDatePipe,
    VxPluralKeyPipe,
    TranslateModule,
    LucideAngularModule,
    VxBadgeComponent,
    VxDialogComponent,
    VxKbdComponent,
    WorkflowCanvasComponent,
    DesignerPaletteComponent,
    NodePanelComponent,
    EdgePanelComponent,
    GroupPanelComponent,
    ProcessPanelComponent,
  ],
  providers: [
    DesignerStore,
    DesignerCatalogs,
    provideFFlow(withControlScheme(F_DEFAULT_CONTROL_SCHEME), withA11y({ keyboard: true }), withConnectionFlow('click')),
    // Spoken canvas messages in the reader's language. Delete and select-all are left to the page's
    // own shortcuts, so they behave the same with the focus on the canvas or on the toolbar.
    {
      provide: F_A11Y_CONFIG,
      useFactory: () => {
        const t = inject(TranslateService);
        const k = (key: string, params?: Record<string, unknown>) => t.instant(composeKey('workflow_engine.a11y', key), params);
        return mergeA11yConfig({
          keyboard: true,
          moveStep: 20,
          coarseMoveStep: 100,
          keys: { deleteSelected: [], selectAll: [] },
          messages: {
            flow: k('flow'),
            node: k('node'),
            group: k('group'),
            connection: k('connection'),
            instructions: k('instructions'),
            connectionLabel: (source, target) => k('connection_label', { source, target }),
            nodeFocused: (label, index, total) => k('node_focused', { label, index, total }),
            connectionFocused: (label) => k('connection_focused', { label }),
            allSelected: (count) => k('all_selected', { count }),
            selectionCleared: k('selection_cleared'),
            itemsCount: (count) => k('items_count', { count }),
            grabbed: (label) => k('grabbed', { label }),
            moved: (x, y) => k('moved', { x: Math.round(x), y: Math.round(y) }),
            dropped: (label, x, y) => k('dropped', { label, x: Math.round(x), y: Math.round(y) }),
            moveCancelled: (label) => k('move_cancelled', { label }),
            connectStarted: (label) => k('connect_started', { label }),
            connectTarget: (label, index, total) => k('connect_target', { label, index, total }),
            connected: (source, target) => k('connected', { source, target }),
            connectCancelled: k('connect_cancelled'),
            connectUnavailable: k('connect_unavailable'),
            connectRequiresSingleNode: k('connect_requires_single'),
            deleteRequested: (count) => k('delete_requested', { count }),
            zoom: (percent) => k('zoom', { percent }),
          },
        });
      },
    },
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './workflow-designer.page.html',
  styleUrl: './workflow-designer.page.scss',
  host: {
    '(keydown)': 'onKeydown($event)',
    // The tab wrapper marks a record tab dirty on any edit event (a safety net for pages that
    // don't track their own state). This page does: whatever was typed — a search box, a person
    // picker — the tab shows exactly what the store says.
    '(input)': 'resyncTab()',
    '(change)': 'resyncTab()',
    '(paste)': 'resyncTab()',
  },
})
export class WorkflowDesignerPage {
  protected readonly store = inject(DesignerStore);
  protected readonly catalogs = inject(DesignerCatalogs);
  private readonly service = inject(WorkflowService);
  private readonly translate = inject(TranslateService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly tenancy = inject(ActiveOrganizationService);
  private readonly injector = inject(EnvironmentInjector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly scheme = inject(FControlSchemeController);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly tab = inject(TAB_CONTEXT, { optional: true });
  private readonly localeStore = inject(LocaleStore);

  readonly id = input<string>('');

  protected readonly canvas = viewChild(WorkflowCanvasComponent);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private readonly importInput = viewChild<ElementRef<HTMLInputElement>>('importInput');

  readonly definition = signal<WorkflowDefinition | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly saveState = signal<SaveState>('saved');
  readonly lastSavedAt = signal<Date | null>(null);
  readonly publishing = signal(false);
  readonly issues = signal<WorkflowIssue[]>([]);
  readonly validating = signal(false);
  readonly zoomPercent = signal(100);
  readonly layoutBusy = signal(false);

  readonly inspectorTab = signal<'properties' | 'issues'>('properties');
  readonly showShortcuts = signal(false);
  readonly showSettings = signal(false);
  readonly searchOpen = signal(false);
  readonly searchQuery = signal('');
  readonly searchCursor = signal(0);
  readonly typeFilter = signal<Set<WorkflowNodeType>>(new Set());

  readonly prefs = signal<StoredPrefs>(loadPrefs());
  readonly layoutMenuOpen = signal(false);
  readonly versionsOpen = signal(false);
  readonly versions = signal<WorkflowVersionSummary[] | null>(null);
  /** Warnings the server wants acknowledged before publishing; the dialog is open while set. */
  readonly publishWarnings = signal<WorkflowIssue[] | null>(null);
  /** Whether the process has a live version other than this one (an archived one can be reactivated when not). */
  readonly hasLiveVersion = signal(true);
  private pendingRollback = false;

  readonly canDesign = computed(() => this.auth.hasPermissions(['workflow_engine:design']));
  readonly readOnly = computed(() => {
    const definition = this.definition();
    return !definition || definition.status !== 'DRAFT' || !this.canDesign();
  });
  readonly canvasPrefs = computed<CanvasPrefs>(() => {
    const { snap, guides, minimap, background, connectionsOnTop } = this.prefs();
    return { snap, guides, minimap, background, connectionsOnTop };
  });

  // ── Derived view ────────────────────────────────────────────────────────────

  readonly issuesByNode = computed(() => groupIssues(this.issues(), 'nodeId'));
  readonly issuesByEdge = computed(() => groupIssues(this.issues(), 'edgeId'));
  readonly errorCount = computed(() => this.issues().filter((i) => i.severity === 'error').length);
  readonly warningCount = computed(() => this.issues().filter((i) => i.severity === 'warning').length);
  readonly processIssues = computed(() => this.issues().filter((i) => !i.nodeId && !i.edgeId));

  private readonly variableLabels = computed(() => new Map(this.catalogs.availableVariables().map((v) => [v.name, v.label])));

  /** Steps matching the search box and the type filter; null when neither is active. */
  readonly matches = computed<Set<string> | null>(() => {
    const query = normalize(this.searchQuery());
    const types = this.typeFilter();
    if (!query && !types.size) return null;
    const out = new Set<string>();
    for (const node of this.store.nodes()) {
      if (types.size && !types.has(node.type)) continue;
      if (query && !normalize(`${this.nodeName(node)} ${node.description ?? ''} ${this.nodeMeta(node)}`).includes(query)) continue;
      out.add(node.id);
    }
    return out;
  });
  readonly matchList = computed(() => {
    const matches = this.matches();
    return matches ? this.store.nodes().filter((n) => matches.has(n.id)) : [];
  });

  readonly canvasNodes = computed<CanvasNode[]>(() => {
    const issues = this.issuesByNode();
    const matches = this.matches();
    return this.store.nodes().map((node) => {
      const own = issues.get(node.id) ?? [];
      const errors = own.filter((i) => i.severity === 'error').length;
      const name = this.nodeName(node);
      const meta = this.nodeMeta(node);
      return {
        id: node.id,
        type: node.type,
        name,
        meta,
        position: node.position ?? { x: 0, y: 0 },
        parentId: node.parentId,
        issue: errors ? 'error' : own.length ? 'warning' : null,
        issueCount: own.length,
        dim: !!matches && !matches.has(node.id),
        ariaLabel: [this.translate.instant(nodeTypeKey(node.type)), name, meta].filter(Boolean).join(', '),
      };
    });
  });

  readonly canvasEdges = computed<CanvasEdge[]>(() => {
    const issues = this.issuesByEdge();
    const nodes = this.store.nodeById();
    const matches = this.matches();
    const labels = this.variableLabels();
    return this.store.edges().map((edge) => {
      const source = nodes.get(edge.from);
      let label = edge.label ?? '';
      let tone: CanvasEdge['tone'] = 'plain';
      if (edge.outcome) {
        label ||= outcomeLabel(this.translate, edge.outcome, source?.config?.outcomeLabels);
        tone = NEGATIVE_OUTCOMES.has(edge.outcome) ? 'negative' : 'outcome';
      } else if (edge.default && source?.type !== 'start') {
        label ||= this.translate.instant('workflow_engine.designer.otherwise');
        tone = 'fallback';
      } else if (edge.condition) {
        // A condition branch always shows its rule as it is now. A typed caption («> 10 000») went
        // stale the moment someone changed the threshold, and the canvas then lied (QA M-01).
        this.localeStore.locale();
        label = summarizePredicate(this.translate, edge.condition, (v) => labels.get(v) ?? v, 40);
        tone = 'condition';
      }
      const own = issues.get(edge.id) ?? [];
      return {
        id: edge.id,
        from: edge.from,
        to: edge.to,
        label,
        tone,
        waypoints: edge.waypoints,
        issue: own.some((i) => i.severity === 'error') ? 'error' : own.length ? 'warning' : null,
        dim: !!matches && !(matches.has(edge.from) && matches.has(edge.to)),
      };
    });
  });

  readonly canvasGroups = computed<CanvasGroup[]>(() =>
    this.store.groups().map((group) => ({
      id: group.id,
      name: group.name || this.translate.instant('workflow_engine.designer.lane'),
      position: group.position ?? { x: 0, y: 0 },
      size: group.size ?? { width: 720, height: 220 },
      color: group.color ?? 'viz-1',
    })),
  );

  readonly selectionCount = computed(() => {
    const s = this.store.selection();
    return s.nodes.length + s.edges.length + s.groups.length;
  });
  readonly singleNode = computed(() => {
    const s = this.store.selection();
    return s.nodes.length === 1 && !s.edges.length && !s.groups.length ? this.store.selectedNodes()[0] ?? null : null;
  });
  readonly singleEdge = computed(() => {
    const s = this.store.selection();
    return s.edges.length === 1 && !s.nodes.length && !s.groups.length ? this.store.selectedEdges()[0] ?? null : null;
  });
  readonly singleGroup = computed(() => {
    const s = this.store.selection();
    return s.groups.length === 1 && !s.nodes.length && !s.edges.length ? this.store.selectedGroups()[0] ?? null : null;
  });

  protected readonly nodeTypes: WorkflowNodeType[] = ['start', 'task', 'approval', 'condition', 'action', 'timer', 'end'];
  protected readonly shortcuts: Array<{ chord: KeyChord; labelKey: string }> = [
    { chord: { mod: true, key: 'S' }, labelKey: 'workflow_engine.shortcut.save' },
    { chord: { mod: true, key: 'Z' }, labelKey: 'workflow_engine.shortcut.undo' },
    { chord: { mod: true, shift: true, key: 'Z' }, labelKey: 'workflow_engine.shortcut.redo' },
    { chord: { mod: true, key: 'C' }, labelKey: 'workflow_engine.shortcut.copy' },
    { chord: { mod: true, key: 'X' }, labelKey: 'workflow_engine.shortcut.cut' },
    { chord: { mod: true, key: 'V' }, labelKey: 'workflow_engine.shortcut.paste' },
    { chord: { mod: true, key: 'D' }, labelKey: 'workflow_engine.shortcut.duplicate' },
    { chord: { mod: true, key: 'A' }, labelKey: 'workflow_engine.shortcut.select_all' },
    { chord: { key: 'Supr' }, labelKey: 'workflow_engine.shortcut.delete' },
    { chord: { mod: true, key: 'F' }, labelKey: 'workflow_engine.shortcut.search' },
    { chord: { shift: true, key: '1' }, labelKey: 'workflow_engine.shortcut.fit' },
    { chord: { mod: true, shift: true, key: 'L' }, labelKey: 'workflow_engine.shortcut.layout' },
    { chord: { key: '+' }, labelKey: 'workflow_engine.shortcut.zoom_in' },
    { chord: { key: '-' }, labelKey: 'workflow_engine.shortcut.zoom_out' },
    { chord: { key: 'Tab' }, labelKey: 'workflow_engine.shortcut.next_step' },
    { chord: { key: 'Space' }, labelKey: 'workflow_engine.shortcut.grab' },
    { chord: { key: 'C' }, labelKey: 'workflow_engine.shortcut.connect' },
    { chord: { key: 'Esc' }, labelKey: 'workflow_engine.shortcut.escape' },
    { chord: { key: '?' }, labelKey: 'workflow_engine.shortcut.help' },
  ];

  protected readonly UndoIcon = Undo2;
  protected readonly RedoIcon = Redo2;
  protected readonly SaveIcon = Save;
  protected readonly PublishIcon = Send;
  protected readonly VersionIcon = GitBranchPlus;
  protected readonly ZoomInIcon = Plus;
  protected readonly ZoomOutIcon = Minus;
  protected readonly FitIcon = Maximize;
  protected readonly LayoutIcon = LayoutGrid;
  protected readonly SearchIcon = Search;
  protected readonly ExportIcon = Download;
  protected readonly ImportIcon = Upload;
  protected readonly KeyboardIcon = Keyboard;
  protected readonly SettingsIcon = Settings2;
  protected readonly PaletteIcon = PanelLeft;
  protected readonly InspectorIcon = PanelRight;
  protected readonly CloseIcon = X;
  protected readonly ErrorIcon = CircleAlert;
  protected readonly WarnIcon = AlertTriangle;
  protected readonly OkIcon = CircleCheck;
  protected readonly CopyIcon = Copy;
  protected readonly DeleteIcon = Trash2;
  protected readonly UnpublishIcon = EyeOff;
  protected readonly HistoryIcon = History;
  protected readonly ChevronIcon = ChevronDown;

  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private validateTimer: ReturnType<typeof setTimeout> | null = null;
  private validateSeq = 0;
  private inFlight: Promise<boolean> | null = null;
  private saveQueued = false;

  constructor() {
    this.catalogs.load();
    effect(() => setSummaryLocale(this.localeStore.locale()));
    this.applyScheme(this.prefs().scheme);

    effect(() => {
      const id = this.id();
      if (id) untracked(() => this.load(id));
    });

    // The tab's «unsaved changes» follows the store, never the DOM events of the inspector.
    effect(() => {
      const dirty = this.store.dirty();
      untracked(() => {
        if (dirty) this.tab?.markDirty(true);
        else this.tab?.markClean();
        if (dirty && this.saveState() === 'saved') this.saveState.set('dirty');
      });
    });

    // Every change: validate soon, and save a moment later (drafts only).
    effect(() => {
      this.store.revision();
      untracked(() => {
        if (!this.definition()) return;
        this.scheduleValidation();
        if (!this.readOnly() && this.store.dirty()) this.scheduleAutosave();
      });
    });

    effect(() => {
      const prefs = this.prefs();
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      } catch {
        /* private mode: preferences last for the session */
      }
    });

    this.tab?.registerSaveHandler(() => this.save({ silent: false }));

    this.destroyRef.onDestroy(() => {
      if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
      if (this.validateTimer) clearTimeout(this.validateTimer);
    });
  }

  // ── Loading ─────────────────────────────────────────────────────────────────

  private load(id: string): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.service.getDefinition(id).subscribe({
      next: (definition) => this.apply(definition),
      error: (err: unknown) => {
        this.loadError.set(this.notifications.httpErrorMessage(err, 'workflow_engine.load_failed'));
        this.loading.set(false);
      },
    });
  }

  private apply(definition: WorkflowDefinition): void {
    this.definition.set(definition);
    const graph = definition.graph ?? { nodes: [], edges: [] };
    this.store.load({
      name: definition.name,
      description: definition.description ?? '',
      nodes: graph.nodes ?? [],
      edges: graph.edges ?? [],
      groups: graph.groups ?? [],
      variables: graph.variables ?? [],
      settings: graph.settings ?? {},
      trigger: definition.trigger ?? { mode: 'manual' },
    });
    this.catalogs.resolvePeople(referencedPeople(graph.nodes ?? []));
    this.saveState.set('saved');
    this.lastSavedAt.set(new Date(definition.updatedAt));
    this.loading.set(false);
    this.tab?.setTitle(definition.name);
    this.tab?.markClean();
    this.validateNow();
    if (definition.status === 'ARCHIVED') this.refreshVersions();
  }

  /**
   * Delete what is selected. «Inicio» cannot go — every process has exactly one — and pressing
   * Supr on it used to do nothing at all; now the author is told why.
   */
  deleteSelected(): boolean {
    if (this.readOnly()) return false;
    const selection = this.store.selection();
    const removed = this.store.deleteItems();
    const startSelected = selection.nodes.some((id) => this.store.nodes().find((n) => n.id === id)?.type === 'start');
    if (startSelected) this.notifications.showInfo('workflow_engine.designer.start_not_deletable');
    return removed > 0 || startSelected;
  }

  resyncTab(): void {
    queueMicrotask(() => {
      if (this.store.dirty()) this.tab?.markDirty(true);
      else this.tab?.markClean();
    });
  }

  reload(): void {
    const id = this.id();
    if (id) this.load(id);
  }

  // ── Saving ──────────────────────────────────────────────────────────────────

  private scheduleAutosave(): void {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => void this.save({ silent: true }), AUTOSAVE_MS);
  }

  /** Save now. Resolves true when the server has the current drawing. */
  async save(options: { silent?: boolean; force?: boolean } = {}): Promise<boolean> {
    if (this.autosaveTimer) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    const definition = this.definition();
    if (!definition || this.readOnly()) return true;
    if (this.inFlight) {
      this.saveQueued = true;
      return this.inFlight;
    }
    if (!this.store.dirty() && !options.force) return true;

    const doc = this.store.doc();
    if (!doc.name.trim()) {
      this.saveState.set('error');
      if (!options.silent) this.notifications.showError('workflow_engine.designer.name_required');
      this.store.clearSelection();
      return false;
    }

    const revision = this.store.revision();
    this.saveState.set('saving');
    this.inFlight = firstValueFrom(
      this.service.updateDefinition(definition.id, {
        name: doc.name.trim(),
        description: doc.description.trim() || null,
        graph: this.store.toGraph(),
        trigger: doc.trigger,
        expectedUpdatedAt: options.force ? undefined : definition.updatedAt,
      }),
    )
      .then((saved) => {
        this.definition.set(saved);
        this.store.markSaved(revision);
        this.saveState.set(this.store.dirty() ? 'dirty' : 'saved');
        this.lastSavedAt.set(new Date());
        this.tab?.setTitle(saved.name);
        this.tab?.emit({ type: TabEvent.RECORD_SAVED, entity: 'workflow_definition', id: saved.id });
        if (!options.silent) this.notifications.showSuccess('workflow_engine.saved');
        return true;
      })
      .catch(async (err: unknown) => {
        this.saveState.set('error');
        if (messageKeyOf(err) === 'workflow_engine.edited_elsewhere') return this.resolveConflict(err);
        this.notifications.showHttpError(err, 'workflow_engine.save_failed');
        return false;
      })
      .finally(() => {
        this.inFlight = null;
        if (this.saveQueued) {
          this.saveQueued = false;
          if (this.store.dirty()) this.scheduleAutosave();
        }
      });
    return this.inFlight;
  }

  /**
   * The draft was saved elsewhere since it was opened: keep that version or overwrite it. The title
   * says who — «Otra persona» read wrong when it was the same person in another tab (QA).
   */
  private async resolveConflict(err: unknown): Promise<boolean> {
    const params = (err as { error?: { params?: { self?: boolean; name?: string | null } } })?.error?.params ?? {};
    const message = params.self
      ? 'workflow_engine.conflict.message_self'
      : params.name
        ? 'workflow_engine.conflict.message_named'
        : 'workflow_engine.conflict.message';
    const decision = await this.dialog.confirmClose({
      title: params.self ? 'workflow_engine.conflict.title_self' : 'workflow_engine.conflict.title',
      message,
      messageParams: { name: params.name ?? '' },
      saveText: 'workflow_engine.conflict.overwrite',
      discardText: 'workflow_engine.conflict.reload',
      cancelText: 'workflow_engine.conflict.later',
    });
    if (decision === 'save') {
      this.inFlight = null;
      return this.save({ force: true });
    }
    if (decision === 'discard') this.reload();
    return false;
  }

  // ── Validation ──────────────────────────────────────────────────────────────

  private scheduleValidation(): void {
    if (this.validateTimer) clearTimeout(this.validateTimer);
    this.validateTimer = setTimeout(() => this.validateNow(), VALIDATE_MS);
  }

  validateNow(): void {
    const seq = ++this.validateSeq;
    this.validating.set(true);
    this.service.validate(this.store.toGraph(), this.store.trigger(), this.definition()?.id).subscribe({
      next: ({ issues }) => {
        if (seq !== this.validateSeq) return;
        this.issues.set(issues);
        this.validating.set(false);
      },
      error: () => {
        if (seq === this.validateSeq) this.validating.set(false);
      },
    });
  }

  issueText(issue: WorkflowIssue): string {
    return issueMessage(this.translate, issue, (id) => { const node = this.store.nodeById().get(id); return node ? this.nodeName(node) : undefined; });
  }

  issueTarget(issue: WorkflowIssue): string {
    if (issue.nodeId) {
      const node = this.store.nodeById().get(issue.nodeId);
      return node ? this.nodeName(node) : '';
    }
    if (issue.edgeId) {
      const edge = this.store.edges().find((e) => e.id === issue.edgeId);
      if (!edge) return '';
      const from = this.store.nodeById().get(edge.from);
      const to = this.store.nodeById().get(edge.to);
      return `${from ? this.nodeName(from) : '—'} → ${to ? this.nodeName(to) : '—'}`;
    }
    return this.translate.instant('workflow_engine.designer.process');
  }

  focusIssue(issue: WorkflowIssue): void {
    if (issue.nodeId) {
      this.store.select({ nodes: [issue.nodeId] });
      this.canvas()?.center(issue.nodeId);
    } else if (issue.edgeId) {
      this.store.select({ edges: [issue.edgeId] });
    } else {
      this.store.clearSelection();
    }
    this.inspectorTab.set('properties');
    this.setPref('inspector', true);
  }

  // ── Publishing and versions ─────────────────────────────────────────────────

  async publish(rollback = false, acknowledgeWarnings = false): Promise<void> {
    const definition = this.definition();
    if (!definition || this.publishing()) return;
    if (this.store.dirty() && !(await this.save({ silent: true }))) return;
    if (!rollback && this.errorCount() > 0) {
      this.inspectorTab.set('issues');
      this.setPref('inspector', true);
      this.notifications.showError(pluralKey(this.translate, 'workflow_engine.designer.fix_before_publish', this.errorCount()), { count: this.errorCount() });
      return;
    }
    this.publishing.set(true);
    this.service.publish(definition.id, rollback, acknowledgeWarnings).subscribe({
      next: (published) => {
        this.publishing.set(false);
        this.publishWarnings.set(null);
        this.definition.set(published);
        this.hasLiveVersion.set(true);
        this.store.clearSelection();
        this.notifications.showSuccess('workflow_engine.published', { version: published.version });
        this.tab?.emit({ type: TabEvent.RECORD_SAVED, entity: 'workflow_definition', id: published.id });
      },
      error: async (err: unknown) => {
        this.publishing.set(false);
        const key = messageKeyOf(err);
        if (key === 'workflow_engine.publish_has_warnings') {
          // The server found warnings: the author reads each one and decides, in one dialog,
          // instead of publishing past a yellow badge they may never have opened (QA C-01).
          const warnings = paramsOf(err)['issues'];
          this.pendingRollback = rollback;
          this.publishWarnings.set(Array.isArray(warnings) ? (warnings as WorkflowIssue[]) : []);
          return;
        }
        if (key === 'workflow_engine.stale_version') {
          const params = paramsOf(err);
          const confirmed = await this.dialog.confirm({
            title: 'workflow_engine.rollback.title',
            message: 'workflow_engine.rollback.message',
            messageParams: params,
            confirmText: 'workflow_engine.rollback.confirm',
            variant: 'warning',
          });
          if (confirmed) void this.publish(true, acknowledgeWarnings);
          return;
        }
        const issues = paramsOf(err)['issues'];
        if (Array.isArray(issues)) {
          this.issues.set(issues as WorkflowIssue[]);
          this.inspectorTab.set('issues');
          this.setPref('inspector', true);
        }
        this.notifications.showHttpError(err, 'workflow_engine.publish_failed');
      },
    });
  }

  confirmPublishWithWarnings(): void {
    this.publishWarnings.set(null);
    void this.publish(this.pendingRollback, true);
  }

  /** An archived version with nothing live in its place: make it live again (QA A-07). */
  async reactivate(): Promise<void> {
    const definition = this.definition();
    if (!definition) return;
    const confirmed = await this.dialog.confirm({
      title: 'workflow_engine.reactivate.title',
      message: 'workflow_engine.reactivate.message',
      messageParams: { name: definition.name, version: definition.version },
      confirmText: 'workflow_engine.reactivate.confirm',
    });
    if (confirmed) void this.publish(true);
  }

  // ── Versions ────────────────────────────────────────────────────────────────

  openVersions(): void {
    this.closePopovers();
    this.versionsOpen.set(true);
    this.refreshVersions();
  }

  private refreshVersions(): void {
    const definition = this.definition();
    if (!definition) return;
    this.versions.set(null);
    this.service.catalogue().subscribe({
      next: (catalogue) => {
        const entry = catalogue.find((item) => item.key === definition.key);
        this.versions.set(entry?.versions ?? []);
        this.hasLiveVersion.set(!!entry?.published);
      },
      error: () => this.versions.set([]),
    });
  }

  openVersion(id: string): void {
    this.versionsOpen.set(false);
    const definition = this.definition();
    if (this.tab) this.tab.replaceRoute(`/workflows/${id}/edit`, { title: definition?.name ?? '' });
    else void this.router.navigateByUrl(this.tenancy.urlFor(`workflows/${id}/edit`));
    if (id !== this.id()) this.load(id);
  }

  /** Make an earlier version live again. It is validated like any publish; warnings are shown. */
  async restoreVersion(id: string): Promise<void> {
    const version = this.versions()?.find((v) => v.id === id);
    const confirmed = await this.dialog.confirm({
      title: 'workflow_engine.versions.restore_title',
      message: 'workflow_engine.versions.restore_message',
      messageParams: { version: version?.version ?? '' },
      confirmText: 'workflow_engine.versions.restore',
      variant: 'warning',
    });
    if (!confirmed) return;
    this.openVersion(id);
    // The version loads read-only; publishing it as a rollback is the restore.
    const wait = setInterval(() => {
      if (this.definition()?.id === id && !this.loading()) {
        clearInterval(wait);
        void this.publish(true);
      }
    }, 100);
    setTimeout(() => clearInterval(wait), 10_000);
  }

  async unpublish(): Promise<void> {
    const definition = this.definition();
    if (!definition) return;
    const confirmed = await this.dialog.confirm({
      title: 'workflow_engine.unpublish.title',
      message: 'workflow_engine.unpublish.message',
      messageParams: { name: definition.name },
      confirmText: 'workflow_engine.unpublish.confirm',
      variant: 'warning',
    });
    if (!confirmed) return;
    this.service.unpublish(definition.id).subscribe({
      next: (updated) => {
        this.definition.set(updated);
        this.notifications.showSuccess('workflow_engine.unpublished');
      },
      error: (err: unknown) => this.notifications.showHttpError(err, 'workflow_engine.save_failed'),
    });
  }

  newVersion(): void {
    const definition = this.definition();
    if (!definition) return;
    this.service.newVersion(definition.id).subscribe({
      next: (draft) => {
        // The tab's route is the page's own, without the company prefix; the router's is the full URL.
        if (this.tab) this.tab.replaceRoute(`/workflows/${draft.id}/edit`, { title: draft.name });
        else void this.router.navigateByUrl(this.tenancy.urlFor(`workflows/${draft.id}/edit`));
        if (draft.id !== this.id()) this.load(draft.id);
        this.notifications.showSuccess('workflow_engine.draft_ready', { version: draft.version });
      },
      error: (err: unknown) => this.notifications.showHttpError(err, 'workflow_engine.save_failed'),
    });
  }

  // ── Canvas events ───────────────────────────────────────────────────────────

  onConnect(event: { from: string; to: string }): void {
    const result = this.store.connect(event.from, event.to, this.catalogs.actions());
    if ('reasonKey' in result) this.notifications.showWarning(result.reasonKey);
  }

  onReassign(event: { edgeId: string; from?: string; to?: string }): void {
    const problem = this.store.reassign(event.edgeId, event);
    if (problem) this.notifications.showWarning(problem);
  }

  onMoved(moves: Array<{ id: string; position: { x: number; y: number } }>): void {
    this.store.moveNodes(moves);
  }

  onCanvasSelection(selection: CanvasSelection): void {
    this.store.select(selection);
    if (selection.nodes.length + selection.edges.length + selection.groups.length > 0) this.inspectorTab.set('properties');
  }

  onDropped(event: { data: unknown; position: { x: number; y: number }; groupId?: string }): void {
    const item = event.data as PaletteItem | undefined;
    if (!item || this.readOnly()) return;
    this.addItem(item, event.position, event.groupId);
  }

  onDroppedToGroup(event: { groupId: string; nodeIds: string[] }): void {
    this.store.setParent(event.nodeIds, event.groupId);
  }

  onGroupResized(event: { id: string; size: { width: number; height: number } }): void {
    const group = this.store.groups().find((g) => g.id === event.id);
    if (!group || (group.size?.width === Math.round(event.size.width) && group.size?.height === Math.round(event.size.height))) return;
    this.store.patchGroup(event.id, { size: { width: Math.round(event.size.width), height: Math.round(event.size.height) } }, 'resize');
  }

  onActivate(): void {
    this.inspectorTab.set('properties');
    this.setPref('inspector', true);
    queueMicrotask(() => this.host.nativeElement.querySelector<HTMLElement>('.wd-inspector input:not([readonly]), .wd-inspector textarea')?.focus());
  }

  /** Palette click / Enter: add at the centre of the visible canvas, offset so repeats don't stack. */
  addFromPalette(item: PaletteItem): void {
    if (this.readOnly()) return;
    const center = this.canvas()?.viewportCenter() ?? { x: 200, y: 200 };
    this.addItem(item, freeSpot(this.store.nodes(), { x: center.x - NODE_WIDTH / 2, y: center.y - NODE_HEIGHT / 2 }));
  }

  private addItem(item: PaletteItem, position: { x: number; y: number }, groupId?: string): void {
    if (item.kind === 'lane') {
      this.store.addGroup(position, this.translate.instant('workflow_engine.designer.new_lane'));
      return;
    }
    if (!item.type) return;
    const preset = structuredClone(item.preset ?? {});
    if (groupId) preset.parentId = groupId;
    // Every step is born with a name: a task's name is its title in every inbox and notice, and an
    // unnamed one was shown to people as its internal identifier (QA A-04).
    if (!preset.name?.trim() && item.type !== 'start') preset.name = uniqueName(this.store.nodes(), item.label || this.translate.instant(nodeTypeKey(item.type)));
    this.store.addNode(item.type, position, preset);
    this.inspectorTab.set('properties');
  }

  // ── Toolbar actions ─────────────────────────────────────────────────────────

  undo(): void {
    this.store.undo();
  }

  redo(): void {
    this.store.redo();
  }

  fit(): void {
    this.canvas()?.fit();
  }

  async autoLayout(engine: LayoutEngineName): Promise<void> {
    if (this.readOnly() || this.layoutBusy() || !this.store.nodes().length) return;
    this.layoutBusy.set(true);
    try {
      const positions = await computeLayout(this.injector, this.store.nodes(), this.store.edges(), {
        engine,
        direction: this.store.settings().layoutDirection ?? 'LR',
        sizes: this.canvas()?.measuredSizes(),
      });
      this.store.applyLayout(positions);
      requestAnimationFrame(() => requestAnimationFrame(() => this.fit()));
    } catch (error) {
      console.error('[workflow] auto-layout failed', error);
      this.notifications.showError('workflow_engine.designer.layout_failed');
    } finally {
      this.layoutBusy.set(false);
    }
  }

  setPref<K extends keyof StoredPrefs>(key: K, value: StoredPrefs[K]): void {
    this.prefs.update((prefs) => ({ ...prefs, [key]: value }));
    if (key === 'scheme') this.applyScheme(value as ControlScheme);
  }

  togglePref(key: 'snap' | 'guides' | 'minimap' | 'connectionsOnTop' | 'palette' | 'inspector'): void {
    this.setPref(key, !this.prefs()[key]);
  }

  private applyScheme(scheme: ControlScheme): void {
    this.scheme.setScheme(
      scheme === 'select' ? F_DRAG_SELECT_CONTROL_SCHEME : scheme === 'scroll' ? F_SCROLL_PAN_CONTROL_SCHEME : F_DEFAULT_CONTROL_SCHEME,
    );
  }

  // ── Clipboard ───────────────────────────────────────────────────────────────

  async copy(cut = false): Promise<void> {
    const fragment = this.store.copy();
    if (!fragment) return;
    sessionClipboard = fragment;
    try {
      await navigator.clipboard?.writeText(JSON.stringify(fragment));
    } catch {
      /* the in-memory copy still works within the app */
    }
    if (cut && !this.readOnly()) this.store.deleteItems();
    this.notifications.showInfo(pluralKey(this.translate, cut ? 'workflow_engine.designer.cut_done' : 'workflow_engine.designer.copied', fragment.nodes.length), { count: fragment.nodes.length });
  }

  async paste(): Promise<void> {
    if (this.readOnly()) return;
    let fragment: DesignerClipboard | null = null;
    try {
      const text = await navigator.clipboard?.readText();
      if (text) fragment = parseFragment(text);
    } catch {
      /* permission denied: fall back to the in-memory copy */
    }
    fragment ??= sessionClipboard;
    if (!fragment) return;
    this.store.paste(fragment);
  }

  // ── Import / export ─────────────────────────────────────────────────────────

  exportJson(): void {
    const definition = this.definition();
    const doc = this.store.doc();
    const payload = {
      kind: 'virtex.workflow',
      version: 1,
      exportedAt: new Date().toISOString(),
      key: definition?.key,
      name: doc.name,
      description: doc.description,
      trigger: doc.trigger,
      graph: this.store.toGraph(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    // Named after what the author calls the process now, not the key minted from its first name.
    link.download = `${fileSlug(doc.name) || definition?.key || 'workflow'}-v${definition?.version ?? 1}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  chooseImport(): void {
    this.importInput()?.nativeElement.click();
  }

  async importJson(event: Event): Promise<void> {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    inputEl.value = '';
    if (!file || this.readOnly()) return;
    if (file.size > IMPORT_LIMIT_BYTES) {
      this.notifications.showError('workflow_engine.import.too_large');
      return;
    }
    let parsed: ReturnType<typeof parseExport>;
    try {
      parsed = parseExport(await file.text());
    } catch {
      parsed = null;
    }
    if (!parsed) {
      this.notifications.showError('workflow_engine.import.invalid');
      return;
    }
    const confirmed = await this.dialog.confirm({
      title: 'workflow_engine.import.title',
      message: 'workflow_engine.import.message',
      messageParams: { nodes: parsed.graph.nodes.length },
      confirmText: 'workflow_engine.import.confirm',
    });
    if (!confirmed) return;
    const imported = parsed;
    this.store.commit((d) => ({
      ...d,
      description: imported.description ?? d.description,
      nodes: imported.graph.nodes,
      edges: imported.graph.edges,
      groups: imported.graph.groups ?? [],
      variables: imported.graph.variables ?? [],
      settings: { ...d.settings, ...(imported.graph.settings ?? {}) },
      trigger: imported.trigger ?? d.trigger,
    }));
    this.store.clearSelection();
    this.catalogs.resolvePeople(referencedPeople(imported.graph.nodes));
    requestAnimationFrame(() => requestAnimationFrame(() => this.fit()));
    this.notifications.showSuccess('workflow_engine.import.done');
  }

  // ── Search ──────────────────────────────────────────────────────────────────

  openSearch(): void {
    this.closePopovers();
    this.searchOpen.set(true);
    // The field exists only after the next render; focusing it any sooner lost the first keys typed.
    setTimeout(() => this.searchInput()?.nativeElement.focus(), 0);
  }

  /** One floating panel at a time: settings, the layout menu and search never stack. */
  togglePopover(kind: 'settings' | 'layout'): void {
    const open = kind === 'settings' ? this.showSettings() : this.layoutMenuOpen();
    this.closePopovers();
    if (this.searchOpen()) this.closeSearch();
    if (open) return;
    if (kind === 'settings') this.showSettings.set(true);
    else this.layoutMenuOpen.set(true);
  }

  closePopovers(): void {
    this.showSettings.set(false);
    this.layoutMenuOpen.set(false);
  }

  closeSearch(): void {
    this.searchOpen.set(false);
    this.searchQuery.set('');
    this.typeFilter.set(new Set());
    this.searchCursor.set(0);
  }

  setSearch(value: string): void {
    this.searchQuery.set(value);
    this.searchCursor.set(0);
  }

  toggleType(type: WorkflowNodeType): void {
    this.typeFilter.update((set) => {
      const next = new Set(set);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
    this.searchCursor.set(0);
  }

  /** Enter in the search box: go to the next match. */
  nextMatch(backwards = false): void {
    const list = this.matchList();
    if (!list.length) return;
    const index = (this.searchCursor() + (backwards ? list.length - 1 : 0)) % list.length;
    const node = list[index];
    this.store.select({ nodes: [node.id] });
    this.canvas()?.center(node.id);
    this.searchCursor.set((index + 1) % list.length);
  }

  // ── Keyboard ────────────────────────────────────────────────────────────────

  onKeydown(event: KeyboardEvent): void {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const editing = isEditable(event.target);

    if (mod && key === 's') return this.handled(event, () => void this.save({ silent: false }));
    // Escape closes a floating panel even from one of its own fields.
    if (key === 'escape' && (this.showSettings() || this.layoutMenuOpen())) return this.handled(event, () => this.closePopovers());
    if (editing) return;

    if (mod && key === 'z' && !event.shiftKey) return this.handled(event, () => this.undo());
    if (mod && ((key === 'z' && event.shiftKey) || key === 'y')) return this.handled(event, () => this.redo());
    if (mod && key === 'c') return this.handled(event, () => void this.copy());
    if (mod && key === 'x') return this.handled(event, () => void this.copy(true));
    if (mod && key === 'v') return this.handled(event, () => void this.paste());
    if (mod && key === 'd') return this.handled(event, () => !this.readOnly() && this.store.duplicateSelection());
    if (mod && key === 'a') return this.handled(event, () => this.store.selectAll());
    if (mod && key === 'f') return this.handled(event, () => this.openSearch());
    if (mod && event.shiftKey && key === 'l') return this.handled(event, () => void this.autoLayout('dagre'));
    if ((key === 'delete' || key === 'backspace') && !mod) return this.handled(event, () => this.deleteSelected());
    if (event.shiftKey && (event.key === '!' || event.code === 'Digit1')) return this.handled(event, () => this.fit());
    if (event.key === '?') return this.handled(event, () => this.showShortcuts.set(true));
    if (key === 'escape') {
      if (this.showSettings() || this.layoutMenuOpen()) return this.handled(event, () => this.closePopovers());
      if (this.searchOpen()) return this.handled(event, () => this.closeSearch());
      if (this.store.hasSelection()) return this.handled(event, () => this.store.clearSelection());
    }
  }

  private handled(event: KeyboardEvent, action: () => unknown): void {
    event.preventDefault();
    event.stopPropagation();
    action();
  }

  // ── Labels ──────────────────────────────────────────────────────────────────

  nodeName(node: WorkflowGraphNode): string {
    return node.name?.trim() || this.translate.instant(nodeTypeKey(node.type));
  }

  /** The card's second line: what an author needs to read the process at a glance. */
  nodeMeta(node: WorkflowGraphNode): string {
    const cfg = node.config ?? {};
    switch (node.type) {
      case 'start': {
        const trigger = this.store.trigger();
        return trigger.mode === 'event' && trigger.event
          ? eventLabel(this.translate, trigger.event)
          : this.translate.instant('workflow_engine.trigger.manual');
      }
      case 'task':
      case 'approval': {
        const who = cfg.assigneeUserId
          ? this.catalogs.personName(cfg.assigneeUserId)
          : cfg.assigneeRoleId
            ? this.catalogs.roleName(cfg.assigneeRoleId)
            : this.translate.instant('workflow_engine.designer.no_assignee');
        const due = cfg.dueInHours ? ` · ${formatHours(this.translate, cfg.dueInHours)}` : '';
        return `${who}${due}`;
      }
      case 'action': {
        const action = this.catalogs.action(cfg.action);
        return action ? this.translate.instant(action.labelKey) : this.translate.instant('workflow_engine.designer.choose_action');
      }
      case 'timer':
        if (cfg.timerUntilVar) {
          return this.translate.instant('workflow_engine.designer.until', { variable: this.variableLabels().get(cfg.timerUntilVar) ?? cfg.timerUntilVar });
        }
        return cfg.timerMinutes ? formatMinutes(this.translate, cfg.timerMinutes) : '';
      case 'condition': {
        const count = this.store.edges().filter((e) => e.from === node.id).length;
        return this.translate.instant(pluralKey(this.translate, 'workflow_engine.designer.branch_count', count), { count });
      }
      default:
        return '';
    }
  }

  versionStatusKey(status: WorkflowDefinition['status']): string {
    return definitionStatusKey(status);
  }

  versionTone(status: WorkflowDefinition['status']) {
    return definitionStatusTone(status);
  }

  statusKey(definition: WorkflowDefinition): string {
    return definitionStatusKey(definition.status);
  }

  statusTone(definition: WorkflowDefinition) {
    return definitionStatusTone(definition.status);
  }

  typeKey(type: WorkflowNodeType): string {
    return nodeTypeKey(type);
  }

  schemeHint(): string {
    return composeKey('workflow_engine.designer.scheme_hint', this.prefs().scheme);
  }

  onScale(scale: number): void {
    this.zoomPercent.set(Math.round(scale * 100));
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function loadPrefs(): StoredPrefs {
  const defaults: StoredPrefs = { ...DEFAULT_CANVAS_PREFS, scheme: 'default', palette: true, inspector: true };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<StoredPrefs>;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

/** The nearest free place to `wanted`, so steps added one after another never land on each other. */
function freeSpot(nodes: WorkflowGraphNode[], wanted: { x: number; y: number }): { x: number; y: number } {
  const gapX = NODE_WIDTH + 40;
  const gapY = NODE_HEIGHT + 32;
  const overlaps = (x: number, y: number) =>
    nodes.some((node) => {
      const p = node.position ?? { x: 0, y: 0 };
      return Math.abs(p.x - x) < gapX && Math.abs(p.y - y) < gapY;
    });
  for (let ring = 0; ring < 12; ring += 1) {
    for (let step = 0; step <= ring; step += 1) {
      for (const [dx, dy] of [[0, ring], [ring, step], [step, ring], [-ring, step], [step, -ring], [0, -ring]]) {
        const x = wanted.x + dx * gapX;
        const y = wanted.y + dy * gapY;
        if (!overlaps(x, y)) return { x, y };
      }
    }
  }
  return { x: wanted.x, y: wanted.y + nodes.length * 24 };
}

/** «Tarea», then «Tarea 2», «Tarea 3»… so two steps never share a name in inboxes and timelines. */
function uniqueName(nodes: WorkflowGraphNode[], base: string): string {
  const taken = new Set(nodes.map((node) => node.name?.trim().toLowerCase()).filter(Boolean));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

function fileSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .slice(0, 80);
}

function groupIssues(issues: WorkflowIssue[], key: 'nodeId' | 'edgeId'): Map<string, WorkflowIssue[]> {
  const out = new Map<string, WorkflowIssue[]>();
  for (const issue of issues) {
    const id = issue[key];
    if (!id) continue;
    const list = out.get(id) ?? [];
    list.push(issue);
    out.set(id, list);
  }
  return out;
}

function referencedPeople(nodes: WorkflowGraphNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    const cfg = node.config ?? {};
    if (cfg.assigneeUserId) ids.push(cfg.assigneeUserId);
    if (cfg.escalateToUserId) ids.push(cfg.escalateToUserId);
    const recipient = cfg.actionParams?.['userId'];
    if (typeof recipient === 'string') ids.push(recipient);
  }
  return ids;
}

function messageKeyOf(err: unknown): string | null {
  if (err instanceof HttpErrorResponse && err.error && typeof err.error === 'object') {
    const body = err.error as { messageKey?: unknown; code?: unknown };
    if (typeof body.messageKey === 'string') return body.messageKey;
    if (typeof body.code === 'string') return body.code;
  }
  return null;
}

function paramsOf(err: unknown): Record<string, unknown> {
  if (err instanceof HttpErrorResponse && err.error && typeof err.error === 'object') {
    const params = (err.error as { params?: unknown }).params;
    if (params && typeof params === 'object') return params as Record<string, unknown>;
  }
  return {};
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'range', 'color'].includes(type);
  }
  return false;
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function formatHours(translate: TranslateService, hours: number): string {
  return hours % 24 === 0
    ? translate.instant('workflow_engine.unit.days_short', { count: hours / 24 })
    : translate.instant('workflow_engine.unit.hours_short', { count: hours });
}

function formatMinutes(translate: TranslateService, minutes: number): string {
  if (minutes % 1440 === 0) return translate.instant('workflow_engine.designer.wait_for', { duration: translate.instant('workflow_engine.unit.days_short', { count: minutes / 1440 }) });
  if (minutes % 60 === 0) return translate.instant('workflow_engine.designer.wait_for', { duration: translate.instant('workflow_engine.unit.hours_short', { count: minutes / 60 }) });
  return translate.instant('workflow_engine.designer.wait_for', { duration: translate.instant('workflow_engine.unit.minutes_short', { count: minutes }) });
}

function parseFragment(text: string): DesignerClipboard | null {
  try {
    const value = JSON.parse(text) as Partial<DesignerClipboard>;
    if (value?.kind !== 'virtex.workflow.fragment' || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return null;
    return { kind: value.kind, version: 1, nodes: value.nodes, edges: value.edges, groups: Array.isArray(value.groups) ? value.groups : [] };
  } catch {
    return null;
  }
}

/** A file this designer exported (or a bare graph). Shape-checked; the server validates the rest. */
function parseExport(text: string): {
  description?: string;
  trigger?: WorkflowDefinition['trigger'];
  graph: WorkflowDefinition['graph'];
} | null {
  const value = JSON.parse(text) as Record<string, unknown>;
  const graph = (value['kind'] === 'virtex.workflow' ? value['graph'] : value) as WorkflowDefinition['graph'] | undefined;
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return null;
  const ok =
    graph.nodes.every((n) => n && typeof n.id === 'string' && typeof n.type === 'string') &&
    graph.edges.every((e) => e && typeof e.id === 'string' && typeof e.from === 'string' && typeof e.to === 'string');
  if (!ok) return null;
  const trigger = value['trigger'] as WorkflowDefinition['trigger'] | undefined;
  return {
    description: typeof value['description'] === 'string' ? (value['description'] as string) : undefined,
    trigger: trigger && (trigger.mode === 'manual' || trigger.mode === 'event') ? trigger : undefined,
    graph,
  };
}
