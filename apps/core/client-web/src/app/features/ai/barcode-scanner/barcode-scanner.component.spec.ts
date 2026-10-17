import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { BarcodeScannerComponent } from './barcode-scanner.component';

/** The scanner is never a dead end: no camera, or no permission, still leaves typing the code. */
describe('BarcodeScannerComponent', () => {
  let fixture: ComponentFixture<BarcodeScannerComponent>;
  let component: BarcodeScannerComponent;
  const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

  const withCamera = (getUserMedia: jest.Mock | undefined) =>
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: getUserMedia ? { getUserMedia } : undefined,
    });

  afterEach(() => {
    fixture?.destroy();
    if (original) Object.defineProperty(navigator, 'mediaDevices', original);
    else delete (navigator as unknown as Record<string, unknown>)['mediaDevices'];
  });

  const create = async () => {
    await TestBed.configureTestingModule({ imports: [BarcodeScannerComponent, TranslateModule.forRoot()] }).compileComponents();
    fixture = TestBed.createComponent(BarcodeScannerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const state = () => (component as unknown as { state: () => string }).state();

  it('says the camera is unavailable when the device has none', async () => {
    withCamera(undefined);
    await create();
    expect(state()).toBe('unavailable');
  });

  it('says permission was refused, and still accepts a typed code', async () => {
    withCamera(
      jest.fn(async () => {
        throw new DOMException('Permission denied', 'NotAllowedError');
      }),
    );
    await create();
    expect(state()).toBe('denied');

    const emitted: string[] = [];
    component.scanned.subscribe((code) => emitted.push(code));
    const internals = component as unknown as { manual: string; submitManual: () => void };
    internals.manual = ' 7501055363063 ';
    internals.submitManual();
    expect(emitted).toEqual(['7501055363063']);
  });

  it('reads with the native detector and releases the camera once it has a code', async () => {
    const stop = jest.fn();
    const stream = { getTracks: () => [{ stop }] };
    withCamera(jest.fn().mockResolvedValue(stream));
    const detect = jest.fn().mockResolvedValue([{ rawValue: '4006381333931' }]);
    (globalThis as unknown as Record<string, unknown>)['BarcodeDetector'] = jest.fn(() => ({ detect }));
    jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    try {
      await TestBed.configureTestingModule({ imports: [BarcodeScannerComponent, TranslateModule.forRoot()] }).compileComponents();
      fixture = TestBed.createComponent(BarcodeScannerComponent);
      component = fixture.componentInstance;
      const emitted: string[] = [];
      component.scanned.subscribe((code) => emitted.push(code));
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(emitted).toEqual(['4006381333931']);
      expect(stop).toHaveBeenCalled();
    } finally {
      delete (globalThis as unknown as Record<string, unknown>)['BarcodeDetector'];
    }
  });
});
