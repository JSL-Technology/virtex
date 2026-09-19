import { FocusTrap, FocusTrapFactory } from '@angular/cdk/a11y';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
  TemplateRef,
  ViewContainerRef,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, X } from 'lucide-angular';

let nextId = 0;

/** Why the dialog is closing. The caller usually treats all three alike; sometimes it must not. */
export type VxDialogDismissal = 'close-button' | 'escape' | 'scrim';

/**
 * A modal dialog that is actually modal.
 *
 * ## What this replaces, and the defect it fixes
 *
 * Eight hand-made overlays — `shared/components/geo-mismatch-modal`,
 * `shared/components/password-confirm-modal`,
 * `features/invoices/components/invoice-selection-dialog`,
 * `features/settings/components/security-settings`,
 * `features/settings/components/phone-verification-modal`, `features/settings/roles`,
 * `features/settings/organization/subsidiaries`, `features/auth/login` — plus
 * `shared/components/ui/modal`. Between all nine there was **not one focus trap in the entire
 * product**.
 *
 * That is not a polish item. With a dialog open, Tab walked straight out of it and into the page
 * behind: for anyone navigating by keyboard or screen reader, none of this product's modal
 * dialogs was modal. Three of them made it worse by putting `role="button"` and `tabindex="0"` on
 * the scrim, which adds a tab stop IN FRONT of the dialog.
 *
 * `cdkTrapFocus` with auto-capture both confines the focus and puts it back where it was when the
 * dialog closes — so the button that opened it is focused again, and the reader is where they
 * left off.
 *
 * ## Why CDK Overlay rather than a fixed-position div
 *
 * The scrim, the stacking, the block-scroll and the Escape stream all come from one place instead
 * of being reimplemented eight times, and `disposeOnNavigation` means a dialog cannot survive a
 * route change — which is how two of the hand-made ones could be left orphaned over the next page.
 *
 * ## Use
 *
 *     @if (editing()) {
 *       <vx-dialog [titleKey]="'x.edit'" size="md" (dismissed)="editing.set(false)">
 *         <form>…</form>
 *         <ng-container dialogActions>
 *           <button (click)="editing.set(false)">Cancelar</button>
 *           <button (click)="save()">Guardar</button>
 *         </ng-container>
 *       </vx-dialog>
 *     }
 *
 * The caller owns whether it exists, exactly as it owned the old `*ngIf`. That keeps migration to
 * a rename and keeps the dialog's content inside the caller's own change detection.
 */
@Component({
  selector: 'vx-dialog',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule],
  templateUrl: './dialog.component.html',
  styleUrls: ['./dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VxDialogComponent implements AfterViewInit, OnDestroy {
  private readonly overlay = inject(Overlay);
  private readonly focusTraps = inject(FocusTrapFactory);
  private readonly viewContainerRef = inject(ViewContainerRef);
  private readonly destroyRef = inject(DestroyRef);

  /** The dialog's accessible name, as a catalogue key. A dialog without one is unannounceable. */
  readonly titleKey = input<string | null>(null);
  /** Already-translated title, for a name that comes from a record rather than the catalogue. */
  readonly title = input<string | null>(null);
  readonly subtitleKey = input<string | null>(null);
  readonly size = input<'sm' | 'md' | 'lg' | 'xl'>('md');
  readonly closeOnScrim = input(true);
  readonly closeOnEscape = input(true);
  readonly hideCloseButton = input(false);
  /**
   * Refuse to close while something is in flight.
   *
   * A dialog that vanishes mid-save leaves the reader unable to tell whether it saved. The caller
   * sets this while the request is open; Escape and the scrim stop working, and the close button
   * is disabled.
   */
  readonly busy = input(false);

  readonly dismissed = output<VxDialogDismissal>();

  private readonly panelTemplate = viewChild.required<TemplateRef<unknown>>('panel');
  private overlayRef: OverlayRef | null = null;
  private focusTrap: FocusTrap | null = null;
  /** Where focus was when this opened, so it can go back there. */
  private opener: HTMLElement | null = null;

  protected readonly uid = `vx-dialog-${nextId++}`;
  protected readonly titleId = `${this.uid}-title`;
  protected readonly CloseIcon = X;

  ngAfterViewInit(): void {
    const overlayRef = this.overlay.create({
      positionStrategy: this.overlay.position().global().centerHorizontally().centerVertically(),
      //  Bloquear el desplazamiento del fondo es parte de ser modal: un diálogo sobre una página
      //  que sigue moviéndose detrás invita a interactuar con lo que no se puede.
      scrollStrategy: this.overlay.scrollStrategies.block(),
      hasBackdrop: true,
      backdropClass: ['cdk-overlay-dark-backdrop', 'vx-dialog__scrim'],
      panelClass: ['vx-dialog__pane', `vx-dialog__pane--${this.size()}`],
      disposeOnNavigation: true,
    });

    overlayRef
      .backdropClick()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.closeOnScrim() && !this.busy()) this.dismissed.emit('scrim');
      });

    //  `keydownEvents` y no un `HostListener` en el documento: el CDK entrega la tecla al overlay
    //  que está ENCIMA, así que un Escape con dos diálogos abiertos cierra el de arriba y no los
    //  dos. Un listener global cerraba los dos.
    overlayRef
      .keydownEvents()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        if (event.key !== 'Escape' || !this.closeOnEscape() || this.busy()) return;
        event.preventDefault();
        event.stopPropagation();
        this.dismissed.emit('escape');
      });

    this.opener = activeElement();
    overlayRef.attach(new TemplatePortal(this.panelTemplate(), this.viewContainerRef));
    this.overlayRef = overlayRef;
    this.trapFocus(overlayRef);
  }

  /**
   * Confine the focus, and place it.
   *
   * Built by hand rather than through `cdkTrapFocus [cdkTrapFocusAutoCapture]`, which places the
   * focus once the Angular zone goes stable — a promise about timing rather than about focus.
   * Here the trap is created and used in the same turn the panel is attached, so "the dialog has
   * the focus" is true by the time this method returns rather than at some point afterwards.
   *
   * ## Where the focus lands, and why not on the first button
   *
   * On the panel itself unless the caller marked a field with `cdkFocusInitial`. Focusing the
   * first tabbable element would mean the close button — the reader's first stop in a dialog they
   * have not been told about yet would be "dismiss". Focusing the container makes a screen reader
   * announce the dialog's role and name first, which is what the ARIA practices call for, and
   * leaves Tab to reach the content in document order.
   */
  private trapFocus(overlayRef: OverlayRef): void {
    const panel = overlayRef.overlayElement.querySelector<HTMLElement>('.vx-dialog__panel');
    if (!panel) return;

    this.focusTrap = this.focusTraps.create(panel);
    const preferred = panel.querySelector<HTMLElement>('[cdkFocusInitial]');
    if (preferred) preferred.focus();
    else panel.focus();
  }

  ngOnDestroy(): void {
    this.focusTrap?.destroy();
    this.focusTrap = null;
    this.overlayRef?.dispose();
    this.overlayRef = null;
    //  La otra mitad del trato. Sin esto, cerrar un diálogo deja a quien navega con teclado al
    //  principio de la página, buscando otra vez el botón que acaba de pulsar.
    if (this.opener?.isConnected) this.opener.focus();
    this.opener = null;
  }

  protected close(): void {
    if (this.busy()) return;
    this.dismissed.emit('close-button');
  }
}

/** The focused element, looking through shadow roots — a web component can hold the focus. */
function activeElement(): HTMLElement | null {
  let active = document.activeElement as HTMLElement | null;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement as HTMLElement;
  }
  return active;
}
