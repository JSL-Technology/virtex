import { Overlay, OverlayRef, ConnectedPosition } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnDestroy,
  TemplateRef,
  ViewContainerRef,
  computed,
  contentChild,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ControlValueAccessor, NgControl } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ChevronDown, LucideAngularModule, Plus, RotateCcw, Search, X } from 'lucide-angular';
import { EMPTY, Subject, Subscription, isObservable, merge, of, timer } from 'rxjs';
import { catchError, debounce, map, switchMap, tap } from 'rxjs/operators';
import { VxSelectOptionDirective } from './select-option.directive';
import {
  VxSelectCreateFn,
  VxSelectDescribeFn,
  VxSelectDisabledFn,
  VxSelectDisplayFn,
  VxSelectResolveFn,
  VxSelectSearchFn,
  VxSelectSearchTextFn,
  VxSelectStatus,
  VxSelectValueFn,
} from './select.types';

/** Unique per instance, so `aria-activedescendant` and `<label for>` point somewhere real. */
let nextId = 0;

/**
 * Accent-insensitive, case-insensitive text, for the client-side filter.
 *
 * In a product whose default language is Spanish, matching "jose" against "José" is not a nicety:
 * an operator typing on a keyboard without dead keys — or simply in a hurry — otherwise gets an
 * empty list for a customer that is right there.
 */
/**
 * Whether a value means "nothing is selected".
 *
 * The empty string counts, and has to. A reactive control declared `['']` — which is how every
 * optional and every required-but-blank field in this product is declared, because that is what a
 * native `<select>` needs — hands `writeValue('')` to its accessor the instant the form is built.
 * Read as a real value that would send an empty id to the server on page load, once per field.
 */
function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase();
}

/**
 * A select with a search box and a way out of it.
 *
 * ## Why this exists
 *
 * Every entity picker in the product was a native `<select>` filled from a list the page had
 * already fetched in full: 2.000 customers rendered as 2.000 `<option>` elements, no way to search
 * them, and no way to add the one that is missing without abandoning the form. This is the one
 * component those fields are supposed to be.
 *
 * ## What it does NOT know
 *
 * Anything about the thing it is selecting. It has no notion of a customer, a product or an
 * account: it is handed functions — how to draw an option, how to read its value, how to search,
 * how to create one — and calls them. Every hardcoded reference to a particular entity that ends
 * up in here is a bug, because the next twenty fields that want this component are not customers.
 *
 * ## Two search modes, deliberately
 *
 * A list that can grow without bound (customers, products, accounts) is searched on the SERVER:
 * `[search]` receives the query, debounced, and a response to a superseded query is dropped. A
 * genuinely small, fixed list (five payment terms, three tax treatments) is handed over whole in
 * `[options]` and filtered here. Loading ten thousand rows into the browser to filter them with
 * `Array.prototype.filter` is the thing this component exists to stop, so the server mode is the
 * one to reach for when in doubt.
 *
 * ## Keyboard
 *
 * The trigger IS the search box — an ARIA 1.2 editable combobox — which is what makes the focus
 * promise keepable: focus never leaves the input, so there is nothing to restore on close. Arrows
 * move the active row, Enter takes it, Escape closes without changing anything, Alt+ArrowDown
 * opens without moving.
 */
@Component({
  selector: 'vx-select',
  standalone: true,
  imports: [NgTemplateOutlet, ScrollingModule, TranslateModule, LucideAngularModule],
  templateUrl: './select.component.html',
  styleUrls: ['./select.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'vx-select',
    '[class.vx-select--disabled]': 'isDisabled()',
    '[class.vx-select--open]': 'panelOpen()',
  },
})
export class VxSelectComponent<TOption, TValue = TOption>
  implements ControlValueAccessor, OnDestroy
{
  // ── Dependencias ───────────────────────────────────────────────────────────
  private readonly overlay = inject(Overlay);
  private readonly viewContainerRef = inject(ViewContainerRef);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * The form control this field is bound to, when there is one.
   *
   * Self-injected and wired by hand rather than declared through `NG_VALUE_ACCESSOR`, because the
   * provider form makes the control and its accessor mutually dependent and Angular refuses the
   * cycle. Doing it this way also lets the field read its OWN validity — which is what puts
   * `aria-invalid` on the input the user is actually in, rather than on the wrapper element.
   */
  private readonly ngControl = inject(NgControl, { optional: true, self: true });

  // ── Contrato ───────────────────────────────────────────────────────────────
  /** How to draw an option as text. Required: the closed field and screen readers need words. */
  readonly displayWith = input.required<VxSelectDisplayFn<TOption>>();

  /** A quieter second line — a tax id, a SKU, an account code. */
  readonly describeWith = input<VxSelectDescribeFn<TOption> | null>(null);

  /** What the form control holds. Defaults to the option itself. */
  readonly valueWith = input<VxSelectValueFn<TOption, TValue>>(
    (option) => option as unknown as TValue,
  );

  /** Whether an option can be chosen. Listed but refused is a real state: an inactive customer. */
  readonly disabledWith = input<VxSelectDisabledFn<TOption> | null>(null);

  /** The text the CLIENT-side filter matches. Defaults to the display text. */
  readonly searchTextWith = input<VxSelectSearchTextFn<TOption> | null>(null);

  /** Server-side search. Supplying it chooses server mode; see the class comment. */
  readonly search = input<VxSelectSearchFn<TOption> | null>(null);

  /** The whole list, for a small fixed set. Filtered here. */
  readonly options = input<readonly TOption[] | null>(null);

  /** Turns a value that arrived from outside into the option it names. Server mode needs it. */
  readonly resolveWith = input<VxSelectResolveFn<TOption, TValue> | null>(null);

  /** Opens the caller's own creation flow. Absent, the field offers no way to create. */
  readonly createWith = input<VxSelectCreateFn<TOption> | null>(null);

  /** Are two values the same value. Ids are strings, so identity is the right default. */
  readonly compareWith = input<(a: TValue, b: TValue) => boolean>((a, b) => a === b);

  // ── Presentación ───────────────────────────────────────────────────────────
  readonly inputId = input<string>('');
  readonly placeholderKey = input('shared.select.placeholder');
  readonly createLabelKey = input('shared.select.create');
  readonly emptyLabelKey = input('shared.select.empty');
  readonly ariaLabel = input<string | null>(null);
  readonly ariaLabelledBy = input<string | null>(null);
  readonly ariaDescribedBy = input<string | null>(null);
  readonly required = input(false);
  /** A field that can be emptied again. Off for one that must always hold something. */
  readonly clearable = input(true);

  // ── Ajustes ────────────────────────────────────────────────────────────────
  /** How long to wait before asking the server. Ignored in client mode. */
  readonly debounceMs = input(250);
  /** How many rows to ask the server for. Passed through to `search`. */
  readonly limit = input(50);
  /** Row height in px, used to virtualize. Overridden at open time by the measured value. */
  readonly optionSize = input(36);
  /** How tall the list may get before it scrolls. */
  readonly panelMaxHeight = input(288);

  // ── Salidas ────────────────────────────────────────────────────────────────
  /**
   * The option itself, not just its value.
   *
   * A page usually needs more of the chosen record than the id it stores — the invoice form reads
   * the customer's credit terms to date the document — and without this it would have to go and
   * fetch a row the field is already holding.
   */
  readonly optionSelected = output<TOption | null>();
  readonly opened = output<void>();
  readonly closed = output<void>();

  // ── Plantilla del llamante ─────────────────────────────────────────────────
  protected readonly optionTemplate = contentChild(VxSelectOptionDirective);

  private readonly fieldEl = viewChild.required<ElementRef<HTMLElement>>('field');
  private readonly inputEl = viewChild.required<ElementRef<HTMLInputElement>>('searchInput');
  private readonly panelTemplate = viewChild.required<TemplateRef<unknown>>('panel');
  private readonly viewport = viewChild(CdkVirtualScrollViewport);

  // ── Estado ─────────────────────────────────────────────────────────────────
  private readonly id = `vx-select-${nextId++}`;
  protected readonly listboxId = `${this.id}-listbox`;
  protected readonly createOptionId = `${this.id}-create`;
  protected readonly statusId = `${this.id}-status`;

  protected readonly panelOpen = signal(false);
  protected readonly status = signal<VxSelectStatus>('idle');
  protected readonly query = signal('');
  /** What the input shows. Not the query: a closed field shows its selection, not a search. */
  protected readonly text = signal('');
  protected readonly activeIndex = signal(0);
  protected readonly isDisabled = signal(false);
  protected readonly creating = signal(false);
  protected readonly selectedOption = signal<TOption | null>(null);
  private readonly serverOptions = signal<readonly TOption[]>([]);
  private readonly value = signal<TValue | null>(null);
  /** The measured row height, so virtualization survives the compact density setting. */
  protected readonly rowHeight = signal(36);

  /** Bumped on every event of the bound control, so `controlInvalid` can re-read it. */
  private readonly controlRevision = signal(0);

  private readonly queries = new Subject<string>();
  private readonly retries = new Subject<void>();
  private overlayRef: OverlayRef | null = null;
  private resolution: Subscription | null = null;
  private creation: Subscription | null = null;

  protected readonly SearchIcon = Search;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly PlusIcon = Plus;
  protected readonly ClearIcon = X;
  protected readonly RetryIcon = RotateCcw;

  // ── Derivados ──────────────────────────────────────────────────────────────
  protected readonly serverMode = computed(() => this.search() !== null);

  /** The client-side filter. Accent- and case-insensitive; see `fold`. */
  private readonly clientOptions = computed(() => {
    const all = this.options() ?? [];
    const needle = fold(this.query().trim());
    if (!needle) return all;
    const text = this.searchTextWith() ?? this.displayWith();
    return all.filter((option) => fold(text(option) ?? '').includes(needle));
  });

  protected readonly visibleOptions = computed(() =>
    this.serverMode() ? this.serverOptions() : this.clientOptions(),
  );

  protected readonly canCreate = computed(() => this.createWith() !== null && !this.isDisabled());

  /** The create row sits one past the last option, so the arrow keys reach it like any other. */
  protected readonly createIndex = computed(() =>
    this.canCreate() ? this.visibleOptions().length : -1,
  );

  private readonly rowCount = computed(
    () => this.visibleOptions().length + (this.canCreate() ? 1 : 0),
  );

  protected readonly viewportHeight = computed(() =>
    Math.min(this.visibleOptions().length * this.rowHeight(), this.panelMaxHeight()),
  );

  protected readonly hasValue = computed(() => !isEmpty(this.value()));

  protected readonly controlInvalid = computed(() => {
    this.controlRevision();
    const control = this.ngControl?.control;
    return !!control && control.invalid && control.touched;
  });

  protected readonly activeOptionId = computed(() => {
    const index = this.activeIndex();
    if (index < 0) return null;
    if (index === this.createIndex()) return this.createOptionId;
    return index < this.visibleOptions().length ? this.optionId(index) : null;
  });

  /**
   * What the live region says.
   *
   * A sighted user sees the list shrink as they type; without this a screen reader user hears
   * nothing at all between keystrokes and has no way to know whether anything was found.
   */
  protected readonly announcementKey = computed(() => {
    if (!this.panelOpen()) return null;
    switch (this.status()) {
      case 'loading':
        return 'shared.select.status_loading';
      case 'error':
        return 'shared.select.status_error';
      default:
        return this.visibleOptions().length === 0
          ? 'shared.select.status_empty'
          : 'shared.select.status_results';
    }
  });

  constructor() {
    if (this.ngControl) this.ngControl.valueAccessor = this;

    // ── La búsqueda del servidor ─────────────────────────────────────────────
    //  `switchMap` drops the answer to a superseded question: a slow response to "ju" must never
    //  overwrite the list for "juan". `catchError` inside the inner stream, never outside it —
    //  outside, one failed request would end the pipeline and the field would stop searching for
    //  the rest of its life.
    merge(
      this.queries.pipe(debounce(() => timer(this.serverMode() ? this.debounceMs() : 0))),
      this.retries.pipe(map(() => this.query())),
    )
      .pipe(
        switchMap((query) => {
          const search = this.search();
          if (!search) return EMPTY;
          this.status.set('loading');
          return search(query, this.limit()).pipe(
            map((options) => ({ failed: false, options })),
            catchError(() => of({ failed: true, options: [] as readonly TOption[] })),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ failed, options }) => {
        this.serverOptions.set(failed ? [] : options);
        this.status.set(failed ? 'error' : 'ready');
        this.resetActiveIndex();
      });

    //  Una lista que llega tarde (el catálogo se carga por HTTP) tiene que poder completar una
    //  selección que ya se escribió en el formulario. Sin esto el campo se queda en blanco encima
    //  de un control que sí tiene valor.
    effect(() => {
      this.options();
      if (untracked(() => this.value() !== null && this.selectedOption() === null)) {
        untracked(() => this.resolveSelection());
      }
    });

    //  El control ya sabe si es inválido; esto solo vuelve a leerlo cuando cambia.
    effect((onCleanup) => {
      this.controlRevision();
      const control = this.ngControl?.control;
      if (!control) return;
      const subscription = control.events.subscribe(() =>
        this.controlRevision.update((revision) => revision + 1),
      );
      onCleanup(() => subscription.unsubscribe());
    });
  }

  ngOnDestroy(): void {
    this.destroyOverlay();
    this.resolution?.unsubscribe();
    this.creation?.unsubscribe();
  }

  // ── ControlValueAccessor ───────────────────────────────────────────────────
  private onChange: (value: TValue | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(value: TValue | null): void {
    this.value.set(isEmpty(value) ? null : value);
    this.resolveSelection();
  }

  registerOnChange(fn: (value: TValue | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.isDisabled.set(disabled);
    if (disabled) this.closePanel();
  }

  /**
   * Find the option a bare value names, and show it.
   *
   * Three places to look, cheapest first: the list we were handed, the results we already have,
   * and — only then — the server, through `resolveWith`. Without the last one a server-mode field
   * patched with an id shows nothing, which reads as "empty" over a control that is not empty.
   */
  private resolveSelection(): void {
    this.resolution?.unsubscribe();
    this.resolution = null;

    const value = this.value();
    if (isEmpty(value)) {
      this.selectedOption.set(null);
      this.text.set('');
      return;
    }

    //  Lo que ya está en pantalla cuenta como resuelto. Un formulario que vuelve a escribir el
    //  mismo id —`patchValue` sobre un grupo entero lo hace en cada guardado— no puede costar otra
    //  petición al servidor por un nombre que el campo ya está mostrando.
    const shown = this.selectedOption();
    if (shown && this.matches(this.valueWith()(shown), value)) return;

    const known =
      this.findByValue(this.options() ?? [], value) ??
      this.findByValue(this.serverOptions(), value);
    if (known) {
      this.showSelection(known);
      return;
    }

    const resolve = this.resolveWith();
    if (!resolve) return;

    this.resolution = resolve(value)
      .pipe(
        catchError(() => of(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((option) => {
        //  Solo si el valor sigue siendo el mismo: una respuesta lenta no puede pintar el nombre
        //  de un registro que el usuario ya cambió.
        if (option && this.matches(this.valueWith()(option), this.value())) {
          this.showSelection(option);
        }
      });
  }

  private findByValue(options: readonly TOption[], value: TValue): TOption | null {
    const read = this.valueWith();
    return options.find((option) => this.matches(read(option), value)) ?? null;
  }

  private matches(a: TValue | null, b: TValue | null): boolean {
    if (isEmpty(a) || isEmpty(b)) return a === b;
    return this.compareWith()(a, b);
  }

  private showSelection(option: TOption): void {
    this.selectedOption.set(option);
    this.text.set(this.displayWith()(option) ?? '');
  }

  // ── Apertura y cierre ──────────────────────────────────────────────────────
  protected openPanel(): void {
    if (this.isDisabled() || this.panelOpen()) return;

    this.rowHeight.set(this.measureRowHeight());
    this.panelOpen.set(true);
    this.resetActiveIndex();

    if (this.serverMode()) {
      //  Se pide la primera página al abrir. En un ERP los datos de hace diez minutos ya no son
      //  los datos: el cliente que se acaba de dar de alta tiene que estar en la lista.
      this.queries.next(this.query());
    } else {
      this.status.set('ready');
    }

    const overlayRef = this.overlay.create({
      positionStrategy: this.overlay
        .position()
        .flexibleConnectedTo(this.fieldEl())
        .withFlexibleDimensions(false)
        .withPush(true)
        .withViewportMargin(8)
        .withPositions(PANEL_POSITIONS),
      //  `reposition` y no `block`: el panel sigue al campo cuando la página que hay detrás se
      //  desplaza, que es justo lo que un posicionamiento absoluto hecho a mano no hace.
      scrollStrategy: this.overlay.scrollStrategies.reposition({ autoClose: true }),
      width: this.fieldEl().nativeElement.getBoundingClientRect().width,
      disposeOnNavigation: true,
      panelClass: 'vx-select-overlay',
    });
    overlayRef.attach(new TemplatePortal(this.panelTemplate(), this.viewContainerRef));

    //  Un clic fuera cierra. `outsidePointerEvents` en vez de un backdrop porque el resto de la
    //  página tiene que seguir siendo utilizable mientras el panel está abierto.
    overlayRef
      .outsidePointerEvents()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        if (!this.fieldEl().nativeElement.contains(event.target as Node)) this.closePanel();
      });

    this.overlayRef = overlayRef;
    this.opened.emit();
  }

  protected closePanel(): void {
    if (!this.panelOpen()) return;
    this.panelOpen.set(false);
    this.query.set('');
    this.destroyOverlay();
    //  Al cerrar, el campo vuelve a mostrar lo que tiene seleccionado: lo tecleado era una
    //  búsqueda, no un valor, y dejarlo ahí haría creer que el campo guarda ese texto.
    const selected = this.selectedOption();
    this.text.set(selected ? (this.displayWith()(selected) ?? '') : '');
    this.closed.emit();
  }

  private destroyOverlay(): void {
    this.overlayRef?.dispose();
    this.overlayRef = null;
  }

  /**
   * The row height, as the stylesheet currently computes it.
   *
   * Virtualization needs a number in pixels, and the number is not a constant: `[data-density]`
   * rewrites the control scale for the whole application, so a hardcoded 36 would leave the list
   * mispositioned by several rows for every operator who chose the compact setting.
   */
  private measureRowHeight(): number {
    const element = this.fieldEl?.()?.nativeElement;
    if (!element || typeof getComputedStyle !== 'function') return this.optionSize();
    const raw = getComputedStyle(element).getPropertyValue('--vx-select-row-height').trim();
    const amount = Number.parseFloat(raw);
    if (!Number.isFinite(amount) || amount <= 0) return this.optionSize();
    if (raw.endsWith('rem')) {
      const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
      return amount * (Number.isFinite(root) && root > 0 ? root : 16);
    }
    return amount;
  }

  // ── Interacción ────────────────────────────────────────────────────────────
  protected onInput(event: Event): void {
    const typed = (event.target as HTMLInputElement).value;
    this.text.set(typed);
    this.query.set(typed);
    if (!this.panelOpen()) this.openPanel();
    else if (this.serverMode()) this.queries.next(typed);
    this.resetActiveIndex();
  }

  protected onFocus(): void {
    //  Seleccionar lo que hay hace que escribir lo sustituya, que es lo que espera quien llega al
    //  campo para cambiar la elección y no para editarla letra a letra.
    this.inputEl().nativeElement.select();
  }

  protected onBlur(): void {
    this.onTouched();
    this.closePanel();
  }

  protected toggle(): void {
    if (this.panelOpen()) this.closePanel();
    else {
      this.inputEl().nativeElement.focus();
      this.openPanel();
    }
  }

  protected clear(): void {
    this.commit(null, null);
    this.inputEl().nativeElement.focus();
  }

  protected onKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        //  Abrir NO mueve. `resetActiveIndex` ya deja la fila activa donde corresponde —la opción
        //  seleccionada, o la primera— y avanzar además haría que la primera pulsación se saltase
        //  el primer elemento de la lista.
        if (!this.panelOpen()) this.openPanel();
        else this.moveActive(1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (event.altKey) {
          this.closePanel();
          return;
        }
        if (!this.panelOpen()) this.openPanel();
        else this.moveActive(-1);
        return;
      case 'Home':
        if (!this.panelOpen()) return;
        event.preventDefault();
        this.setActive(0);
        return;
      case 'End':
        if (!this.panelOpen()) return;
        event.preventDefault();
        this.setActive(this.rowCount() - 1);
        return;
      case 'Enter':
        if (!this.panelOpen()) return;
        //  Se detiene aquí: en un formulario dentro de un armazón, Enter guarda el borrador. Un
        //  Enter que elige una opción de la lista no puede además enviar el documento.
        event.preventDefault();
        this.takeActive();
        return;
      case 'Escape':
        if (!this.panelOpen()) return;
        //  Solo se traga el Escape cuando hay panel abierto: si no, el diálogo que hospeda el
        //  formulario dejaría de cerrarse con Escape por culpa de este campo.
        event.preventDefault();
        event.stopPropagation();
        this.closePanel();
        return;
      case 'Tab':
        this.closePanel();
        return;
      default:
        return;
    }
  }

  private moveActive(delta: number): void {
    const count = this.rowCount();
    if (count === 0) return;
    const from = this.activeIndex();
    //  Da la vuelta por los dos extremos: llegar al final de la lista y seguir bajando lleva al
    //  principio, que es lo que hace cualquier menú y lo que la mano ya espera.
    this.setActive((from + delta + count) % count);
  }

  private setActive(index: number): void {
    this.activeIndex.set(index);
    if (index >= 0 && index < this.visibleOptions().length) {
      //  Con virtualización, la fila activa TIENE que estar renderizada: `aria-activedescendant`
      //  apunta a un id, y un id que no existe en el DOM no lo lee ningún lector de pantalla.
      this.viewport()?.scrollToIndex(index, 'smooth');
    }
  }

  private resetActiveIndex(): void {
    const selected = this.selectedOption();
    const options = this.visibleOptions();
    const index = selected
      ? options.findIndex((option) =>
          this.matches(this.valueWith()(option), this.valueWith()(selected)),
        )
      : -1;
    this.activeIndex.set(index >= 0 ? index : 0);
  }

  protected optionId(index: number): string {
    return `${this.id}-option-${index}`;
  }

  protected isOptionDisabled(option: TOption): boolean {
    return this.disabledWith()?.(option) ?? false;
  }

  protected isSelected(option: TOption): boolean {
    const selected = this.selectedOption();
    if (!selected) return false;
    const read = this.valueWith();
    return this.matches(read(option), read(selected));
  }

  private takeActive(): void {
    const index = this.activeIndex();
    if (index === this.createIndex()) {
      this.startCreate();
      return;
    }
    const option = this.visibleOptions()[index];
    if (option !== undefined) this.selectOption(option);
  }

  protected selectOption(option: TOption): void {
    if (this.isOptionDisabled(option)) return;
    this.commit(option, this.valueWith()(option));
    this.inputEl().nativeElement.focus();
  }

  private commit(option: TOption | null, value: TValue | null): void {
    this.value.set(value);
    this.selectedOption.set(option);
    this.onChange(value);
    this.optionSelected.emit(option);
    this.closePanel();
    this.text.set(option ? (this.displayWith()(option) ?? '') : '');
  }

  protected retry(): void {
    this.retries.next();
  }

  /**
   * Hand the caller what was typed, and take back whatever they made of it.
   *
   * The panel closes first: the caller is about to put a dialog on screen and a floating list
   * hanging over it is debris. What comes back — if anything comes back — is selected, and focus
   * returns to this field, so the user is exactly where they left off with the gap filled in.
   */
  protected startCreate(): void {
    const create = this.createWith();
    if (!create || this.creating()) return;

    const query = this.query().trim();
    this.closePanel();
    this.creating.set(true);
    this.creation?.unsubscribe();

    const result = create(query);
    if (!isObservable(result)) {
      this.creating.set(false);
      return;
    }

    this.creation = result
      .pipe(
        catchError(() => of(null)),
        tap(() => this.creating.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((option) => {
        //  El foco vuelve SIEMPRE, se haya creado algo o se haya cancelado: quien abrió el
        //  diálogo desde este campo tiene que volver a este campo.
        this.inputEl().nativeElement.focus();
        if (option) this.commit(option, this.valueWith()(option));
      });
  }
}

/**
 * Below the field, or above it when there is no room below.
 *
 * The fallbacks matter more than they look: these fields sit in dialogs, in dockable windows and
 * at the bottom of long forms, and a panel that only ever opens downwards is a panel that opens
 * off-screen for the last field on the page.
 */
const PANEL_POSITIONS: ConnectedPosition[] = [
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
  { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
  { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
];
