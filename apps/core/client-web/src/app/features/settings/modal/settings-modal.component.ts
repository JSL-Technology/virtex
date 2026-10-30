import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Input,
  Type,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgComponentOutlet, NgTemplateOutlet, DOCUMENT } from '@angular/common';
import { Router } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { A11yModule } from '@angular/cdk/a11y';
import { TranslateService } from '@ngx-translate/core';
import { LucideAngularModule, ArrowLeft, Search, X, Lock, CheckCircle2 } from 'lucide-angular';
import { TranslateModule, LocaleStore, FORMAT_PIPES } from '@virteex/shared/ui-i18n';

import { AuthService } from '../../../core/services/auth';
import { DialogService } from '../../../core/services/dialog.service';
import {
  SETTINGS_ALIASES,
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  SettingsSectionDef,
  SettingsShellService,
} from '../shell';

/** Below this width the sidebar and the section cannot both be readable: one pane at a time. */
const COMPACT_BREAKPOINT = 900;

/** Lower-case, unaccented: «Contabilidad» is found by «contabilidad» and «contabilidád» alike. */
const normalise = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Settings: every section of the account, the company and its administration, in one place.
 *
 * ## What changed, and why
 *
 * - **Drawn from a registry** (`SETTINGS_SECTIONS`): the sidebar, the page title, the search, the
 *   permissions and the countries a section applies to come from one declaration, so the sidebar
 *   and the page can no longer call a section two different things, and a section someone cannot
 *   open is not offered to them.
 * - **One header for every section**, drawn here: where you are (group › section), what the section
 *   decides, whom it affects (only you / the whole company / administration), its actions, and —
 *   when the person may look but not change — that it is read only and why.
 * - **Nothing is lost without asking.** Escape, the backdrop, the close button and a change of
 *   section all ask first when the section declares unsaved work (`SettingsShellService`).
 * - **A dialog that behaves like one**: focus moves in, stays in, and returns where it was.
 * - **Room to work**: nearly the whole window instead of a 1,100-pixel box, and on a narrow screen
 *   the list of sections and the section take turns instead of squeezing the section to 105 px.
 * - **Searchable**, by name and by the words people use («NCF», «ITBIS», «2FA»…).
 */
@Component({
  selector: 'app-settings-modal',
  standalone: true,
  imports: [NgComponentOutlet, NgTemplateOutlet, A11yModule, LucideAngularModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './settings-modal.component.html',
  styleUrls: ['./settings-modal.component.scss'],
  providers: [SettingsShellService],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsModalComponent implements AfterViewInit {
  protected readonly router = inject(Router);
  protected readonly shell = inject(SettingsShellService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  private readonly translate = inject(TranslateService);
  private readonly localeStore = inject(LocaleStore);
  private readonly title = inject(Title);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly BackIcon = ArrowLeft;
  protected readonly SearchIcon = Search;
  protected readonly CloseIcon = X;
  protected readonly LockIcon = Lock;
  protected readonly SavedIcon = CheckCircle2;
  protected readonly groups = SETTINGS_GROUPS;

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly content = viewChild<ElementRef<HTMLElement>>('content');

  /** The section asked for, after resolving the ids that used to exist. */
  readonly requested = signal<string>('my-profile');
  /** A group inside the section to bring into view (an old id, or `#settings/x/<action>`). */
  readonly focus = signal<string | null>(null);
  /** What the fragment asks the section to do on arrival, e.g. `new`. */
  readonly action = signal<string | null>(null);

  readonly query = signal('');
  /** On a narrow screen, which pane is showing. */
  readonly pane = signal<'list' | 'section'>('section');
  readonly compact = signal(false);

  @Input()
  set sectionName(value: string) {
    const [raw, ...rest] = (value || 'my-profile').split('/');
    const alias = SETTINGS_ALIASES[raw];
    this.requested.set(alias ? alias[0] : raw || 'my-profile');
    this.focus.set(alias?.[1] ?? null);
    this.action.set(rest.join('/') || null);
    this.pane.set('section');
  }

  private readonly country = computed(() => this.localeStore.tenantContext()?.countryCode ?? null);

  /** The sections this person may see, for this company's country. */
  readonly visible = computed(() =>
    SETTINGS_SECTIONS.filter((section) => this.applies(section) && this.allowed(section.viewPermission)),
  );

  readonly current = computed<SettingsSectionDef | null>(() => SETTINGS_SECTIONS.find((section) => section.id === this.requested()) ?? null);
  /** Asked for a section that exists but is not for this person or this company. */
  readonly denied = computed(() => {
    const section = this.current();
    return Boolean(section && !this.visible().includes(section));
  });
  readonly canEdit = computed(() => {
    const section = this.current();
    return Boolean(section && this.allowed(section.editPermission ?? section.viewPermission));
  });
  readonly groupLabel = computed(() => SETTINGS_GROUPS.find((group) => group.id === this.current()?.group)?.labelKey ?? null);

  readonly sectionsByGroup = computed(() =>
    SETTINGS_GROUPS.map((group) => ({ group, sections: this.visible().filter((section) => section.group === group.id) })).filter(
      (entry) => entry.sections.length > 0,
    ),
  );

  /** Sections matching the search, by name, description and the words people use for them. */
  readonly results = computed(() => {
    const words = normalise(this.query().trim()).split(/\s+/).filter(Boolean);
    if (words.length === 0) return null;
    return this.visible().filter((section) => {
      const haystack = normalise(
        [section.labelKey, section.descriptionKey, section.keywordsKey ?? ''].map((key) => (key ? this.translate.instant(key) : '')).join(' '),
      );
      return words.every((word) => haystack.includes(word));
    });
  });

  readonly component = signal<Type<unknown> | null>(null);
  readonly inputs = computed<Record<string, unknown>>(() => ({
    ...(this.current()?.inputs ?? {}),
    ...(this.current()?.focusable ? { focus: this.focus() } : {}),
  }));

  private previousTitle = '';
  private previouslyFocused: HTMLElement | null = null;
  private loadToken = 0;

  constructor() {
    // Load the section's component whenever the section changes, and forget the last one's state.
    effect(() => {
      const section = this.current();
      const denied = this.denied();
      untracked(() => {
        this.shell.reset();
        this.shell.canEdit.set(this.canEdit());
        this.component.set(null);
        if (!section || denied) return;
        const token = ++this.loadToken;
        void section.load().then((type) => {
          if (token === this.loadToken) this.component.set(type);
        });
      });
    });
    effect(() => this.shell.canEdit.set(this.canEdit()));

    // The browser tab says where the person is.
    this.previousTitle = this.title.getTitle();
    effect(() => {
      const section = this.current();
      const label = section ? this.translate.instant(section.labelKey) : '';
      const settings = this.translate.instant('settings.shell.title');
      this.title.setTitle(label ? `${label} · ${settings} | Virtex` : `${settings} | Virtex`);
    });

    this.previouslyFocused = this.document.activeElement as HTMLElement | null;
    this.destroyRef.onDestroy(() => {
      this.title.setTitle(this.previousTitle);
      // Focus goes back where it was before Settings opened.
      this.previouslyFocused?.focus?.();
    });
  }

  ngAfterViewInit(): void {
    this.measure();
    // The section's heading takes the focus: a screen reader announces where the dialog opened.
    queueMicrotask(() => this.document.getElementById('settings-section-title')?.focus());
  }

  @HostListener('window:resize')
  measure(): void {
    this.compact.set((this.document.defaultView?.innerWidth ?? 1200) < COMPACT_BREAKPOINT);
  }

  /** Escape closes — unless another dialog (a step-up, a confirmation) is the one on top. */
  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: KeyboardEvent): void {
    if (this.document.querySelector('.cdk-overlay-container [role="dialog"], .cdk-overlay-container [role="alertdialog"], app-dialog-host [role="dialog"], app-dialog-host [role="alertdialog"]')) return;
    event.preventDefault();
    void this.close();
  }

  isActive(section: SettingsSectionDef): boolean {
    return this.current()?.id === section.id;
  }

  async navigate(section: string): Promise<void> {
    if (section === this.current()?.id) {
      this.pane.set('section');
      return;
    }
    if (!(await this.confirmLeave())) return;
    this.query.set('');
    void this.router.navigate([], { fragment: 'settings/' + section });
    this.pane.set('section');
    this.content()?.nativeElement.scrollTo?.({ top: 0 });
  }

  /** Enter in the search opens the first match. */
  openFirstResult(): void {
    const first = this.results()?.[0];
    if (first) void this.navigate(first.id);
  }

  showList(): void {
    this.pane.set('list');
  }

  async close(): Promise<void> {
    if (!(await this.confirmLeave())) return;
    // Navigate to the current path without the fragment, which is what closes Settings.
    const pathWithoutFragment = this.router.url.split('#')[0];
    void this.router.navigateByUrl(pathWithoutFragment);
  }

  scopeKey(section: SettingsSectionDef): string {
    return `settings.scope.${section.scope}`;
  }

  /**
   * Whether the section may be left. Asks — save, discard or stay — when it declares unsaved work.
   * A section that cannot be saved from outside is offered discard or stay only.
   */
  private async confirmLeave(): Promise<boolean> {
    if (!this.shell.dirty()) return true;
    const decision = await this.dialog.confirmClose({
      message: 'settings.shell.unsaved_message',
      messageParams: { section: this.current() ? this.translate.instant(this.current()!.labelKey) : '' },
      allowSave: this.shell.canSave(),
    });
    if (decision === 'cancel') return false;
    if (decision === 'save') return this.shell.save();
    this.shell.discard();
    return true;
  }

  private applies(section: SettingsSectionDef): boolean {
    const country = this.country();
    // Unknown market: show both country-specific variants rather than hide the right one.
    if (!country) return true;
    if (section.countries && !section.countries.includes(country)) return false;
    if (section.exceptCountries?.includes(country)) return false;
    return true;
  }

  private allowed(permission: string | undefined): boolean {
    return !permission || this.auth.hasPermissions([permission]);
  }
}
