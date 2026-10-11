import { TestBed } from '@angular/core/testing';
import { ShortcutsService } from './shortcuts.service';
import { PlatformService } from '../platform/platform.service';
import { KeyChord } from './keyboard-shortcuts';

/** A keydown good enough for `matchesChord` to read. */
function keydown(init: Partial<KeyboardEvent> & { code: string }): KeyboardEvent {
  return {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    key: '',
    ...init,
  } as KeyboardEvent;
}

describe('ShortcutsService', () => {
  let service: ShortcutsService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      // Pin the platform so the test is deterministic: off a Mac, `mod` is Ctrl.
      providers: [{ provide: PlatformService, useValue: { isMac: () => false } }],
    });
    service = TestBed.inject(ShortcutsService);
  });

  it('rebinds an editable shortcut, and the new chord is what matches', () => {
    const chord: KeyChord = { mod: true, shift: true, key: 'K', code: 'KeyK' };
    expect(service.rebind('create.invoice', chord)).toBeNull();

    // The old binding no longer fires…
    expect(service.matches(keydown({ altKey: true, shiftKey: true, code: 'KeyI' }), 'create.invoice')).toBe(false);
    // …and the new one does.
    expect(service.matches(keydown({ ctrlKey: true, shiftKey: true, code: 'KeyK' }), 'create.invoice')).toBe(true);
    expect(service.hasCustomizations()).toBe(true);
  });

  it('refuses a binding with no modifier', () => {
    expect(service.rebind('create.invoice', { key: 'K', code: 'KeyK' })).toEqual({ reason: 'needs_modifier' });
  });

  it('refuses a binding already taken, naming who holds it', () => {
    // create.invoice ships as Alt+Shift+I; binding that to create.quote must be refused.
    const rejection = service.rebind('create.quote', { alt: true, shift: true, key: 'I', code: 'KeyI' });
    expect(rejection).toEqual({ reason: 'conflict', withDescriptionKey: 'actions.new_invoice' });
  });

  it('will not rebind a fixed shortcut', () => {
    expect(service.rebind('general.dismiss', { mod: true, key: 'J', code: 'KeyJ' })).not.toBeNull();
  });

  it('resets one binding back to its default', () => {
    service.rebind('tabs.close', { mod: true, shift: true, key: 'K', code: 'KeyK' });
    service.resetBinding('tabs.close');
    expect(service.hasCustomizations()).toBe(false);
    // The factory Ctrl+W fires again.
    expect(service.matches(keydown({ ctrlKey: true, code: 'KeyW' }), 'tabs.close')).toBe(true);
  });

  it('persists overrides so a new instance restores them', () => {
    service.rebind('tabs.close', { mod: true, shift: true, key: 'K', code: 'KeyK' });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: PlatformService, useValue: { isMac: () => false } }],
    });
    const revived = TestBed.inject(ShortcutsService);
    expect(revived.matches(keydown({ ctrlKey: true, shiftKey: true, code: 'KeyK' }), 'tabs.close')).toBe(true);
  });

  it('applies a preset by clearing overrides back to its bindings', () => {
    service.rebind('tabs.close', { mod: true, shift: true, key: 'K', code: 'KeyK' });
    service.applyPreset('default');
    expect(service.hasCustomizations()).toBe(false);
  });
});
