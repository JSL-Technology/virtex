import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { VxDialogComponent } from '../../../shared/components/dialog';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';

/** The retail symbologies a shop's products carry. QR codes are not product identifiers. */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];

type ScanState = 'starting' | 'scanning' | 'denied' | 'unavailable';

interface DetectedBarcode {
  rawValue: string;
}
interface NativeDetector {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
type NativeDetectorClass = new (options: { formats: string[] }) => NativeDetector;

/**
 * Reads a product's barcode with the device camera.
 *
 * The browser's own `BarcodeDetector` where there is one (Chrome on Android, Safari on recent
 * iOS, Chromium desktops) — it runs in the platform and costs nothing to load. Elsewhere ZXing,
 * loaded only when needed, so a form opened without scanning never downloads it. The image never
 * leaves the device; only the digits read are emitted. And a person without a camera, or who
 * refused it, can still type the code: the dialog is never a dead end.
 */
@Component({
  selector: 'app-barcode-scanner',
  standalone: true,
  imports: [FormsModule, TranslatePipe, VxDialogComponent, ...VX_FORM_A11Y],
  template: `
    <vx-dialog [titleKey]="'ai.scan.title'" size="sm" (dismissed)="dismissed.emit()">
      <div class="scan">
        <video #video class="scan__video" [class.scan__video--hidden]="state() !== 'scanning'" playsinline muted
               [attr.aria-label]="'ai.scan.camera_label' | translate"></video>
        <p class="scan__status" role="status" aria-live="polite">
          @switch (state()) {
            @case ('starting') { {{ 'ai.scan.starting' | translate }} }
            @case ('scanning') { {{ 'ai.scan.instructions' | translate }} }
            @case ('denied') { {{ 'ai.scan.denied' | translate }} }
            @case ('unavailable') { {{ 'ai.scan.unavailable' | translate }} }
          }
        </p>
        <form class="scan__manual" (ngSubmit)="submitManual()">
          <div class="form-field">
            <label for="scan-manual">{{ 'ai.scan.manual' | translate }}</label>
            <input id="scan-manual" name="manual" [(ngModel)]="manual" inputmode="numeric" autocomplete="off" maxlength="64" />
          </div>
          <button type="submit" class="btn-secondary" [disabled]="!manual.trim()">{{ 'ai.scan.use_code' | translate }}</button>
        </form>
      </div>
    </vx-dialog>
  `,
  styles: [
    `
      .scan { display: flex; flex-direction: column; gap: var(--space-3); }
      .scan__video { width: 100%; max-height: 50vh; border-radius: var(--radius-md); background: var(--surface-sunken); object-fit: cover; }
      .scan__video--hidden { display: none; }
      .scan__status { margin: 0; font-size: var(--text-sm); color: var(--content-secondary); }
      .scan__manual { display: flex; align-items: flex-end; gap: var(--space-2); }
      .scan__manual .form-field { flex: 1; margin: 0; }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarcodeScannerComponent implements AfterViewInit, OnDestroy {
  readonly scanned = output<string>();
  readonly dismissed = output<void>();

  protected readonly state = signal<ScanState>('starting');
  protected manual = '';

  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private stream: MediaStream | null = null;
  private stopZxing: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private done = false;

  async ngAfterViewInit(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.state.set('unavailable');
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch (error) {
      this.state.set((error as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'unavailable');
      return;
    }
    if (this.done) return this.release();
    const video = this.video().nativeElement;
    video.srcObject = this.stream;
    await video.play().catch(() => undefined);
    this.state.set('scanning');

    const Native = (globalThis as unknown as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
    if (Native) {
      this.scanNative(new Native({ formats: FORMATS }), video);
    } else {
      await this.scanWithZxing(video);
    }
  }

  ngOnDestroy(): void {
    this.done = true;
    this.release();
  }

  protected submitManual(): void {
    const code = this.manual.replace(/[^0-9A-Za-z-]/g, '');
    if (code) this.emit(code);
  }

  private scanNative(detector: NativeDetector, video: HTMLVideoElement): void {
    const tick = async () => {
      if (this.done) return;
      try {
        const [hit] = await detector.detect(video);
        if (hit?.rawValue) return this.emit(hit.rawValue);
      } catch {
        // A frame that could not be read; the next one may.
      }
      this.timer = setTimeout(tick, 200);
    };
    void tick();
  }

  private async scanWithZxing(video: HTMLVideoElement): Promise<void> {
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      if (this.done) return;
      const reader = new BrowserMultiFormatReader();
      const controls = await reader.decodeFromVideoElement(video, (result) => {
        if (result) this.emit(result.getText());
      });
      this.stopZxing = () => controls.stop();
      if (this.done) this.release();
    } catch {
      this.state.set('unavailable');
    }
  }

  private emit(code: string): void {
    if (this.done) return;
    this.done = true;
    this.release();
    this.scanned.emit(code.trim());
  }

  private release(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.stopZxing?.();
    this.stopZxing = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
