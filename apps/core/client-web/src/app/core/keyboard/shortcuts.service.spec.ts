import { TestBed } from '@angular/core/testing';
import { ShortcutsService } from './shortcuts.service';
import { PlatformService } from '../platform/platform.service';
import { KeyChord, SHORTCUT_DEFINITIONS } from './keyboard-shortcuts';
import { DesktopWindowService } from '../windows/desktop-window.service';

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
    // The factory Alt+Shift+W fires again (Ctrl+W is the browser's on the web: QA A-14).
    expect(service.matches(keydown({ altKey: true, shiftKey: true, code: 'KeyW' }), 'tabs.close')).toBe(true);
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

/** QA A-14: no default may be a browser-reserved chord or AltGr, nor fire while typing. */
describe('ShortcutsService — atajos seguros en el navegador', () => {
  const make = (isDesktop: boolean) => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: PlatformService, useValue: { isMac: () => false } },
        { provide: DesktopWindowService, useValue: { isDesktop: () => isDesktop } },
      ],
    });
    return TestBed.inject(ShortcutsService);
  };

  it('en la web ningún atajo por defecto usa Ctrl+Alt (AltGr) ni Ctrl+W/T/Tab', () => {
    const reserved = ['KeyW', 'KeyT', 'Tab', 'KeyE'];
    for (const def of SHORTCUT_DEFINITIONS) {
      for (const chord of def.defaults) {
        expect({ id: def.id, altGr: Boolean((chord.mod || chord.ctrl) && chord.alt) }).toEqual({ id: def.id, altGr: false });
        if (chord.mod || chord.ctrl) expect({ id: def.id, code: reserved.includes(chord.code ?? '') }).toEqual({ id: def.id, code: false });
      }
    }
  });

  it('en la app de escritorio se conserva Ctrl+W', () => {
    const desktop = make(true);
    expect(desktop.matches(keydown({ ctrlKey: true, code: 'KeyW' }), 'tabs.close')).toBe(true);
    const web = make(false);
    expect(web.matches(keydown({ ctrlKey: true, code: 'KeyW' }), 'tabs.close')).toBe(false);
  });

  it('AltGr nunca dispara un atajo', () => {
    const service = make(false);
    const altGr = keydown({ altKey: true, shiftKey: true, code: 'KeyW', getModifierState: (k: string) => k === 'AltGraph' } as never);
    expect(service.matches(altGr, 'tabs.close')).toBe(false);
  });

  it('un atajo sin Ctrl no se dispara mientras se escribe en un campo', () => {
    const service = make(false);
    const input = document.createElement('input');
    expect(service.matches(keydown({ altKey: true, shiftKey: true, code: 'KeyW', target: input } as never), 'tabs.close')).toBe(false);
    expect(service.matches(keydown({ ctrlKey: true, code: 'KeyK', target: input } as never), 'app.search')).toBe(true);
  });

  it('los atajos por defecto no chocan entre sí', () => {
    const seen = new Map<string, string>();
    for (const def of SHORTCUT_DEFINITIONS) {
      for (const c of def.defaults) {
        const sig = `${!!c.mod}${!!c.ctrl}${!!c.alt}${!!c.shift}:${c.code}`;
        expect({ sig, clash: seen.get(sig) }).toEqual({ sig, clash: undefined });
        seen.set(sig, def.id);
      }
    }
  });
});
