import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { VxKbdComponent } from './index';
import { PlatformService } from '../../../core/platform/platform.service';
import { KeyChord, formatChord, speakChord } from '../../../core/keyboard/keyboard-shortcuts';

describe('formatChord', () => {
  const chord: KeyChord = { mod: true, shift: true, key: 'T' };

  it('shows the Command glyph on a Mac and spells Ctrl everywhere else', () => {
    // The whole point of the task: ⌘ on macOS, "Ctrl" on Windows/Linux, from one definition.
    expect(formatChord(chord, true)).toEqual(['⇧', '⌘', 'T']);
    expect(formatChord(chord, false)).toEqual(['Ctrl', 'Shift', 'T']);
  });

  it('keeps Ctrl literal on a Mac for the tab-cycling chords', () => {
    // ⌘+Tab is the OS app-switcher and cannot be intercepted; Ctrl+Tab is the real one, so it must
    // show ⌃ and not ⌘ even on a Mac.
    expect(formatChord({ ctrl: true, key: 'Tab' }, true)).toEqual(['⌃', 'Tab']);
  });

  it('speaks modifier names rather than glyphs for screen readers', () => {
    expect(speakChord(chord, true)).toBe('Command Shift T');
    expect(speakChord(chord, false)).toBe('Control Shift T');
  });
});

@Component({
  standalone: true,
  imports: [VxKbdComponent],
  template: `<vx-kbd [chord]="chord" />`,
})
class Host {
  chord: KeyChord = { alt: true, shift: true, key: 'I' };
}

describe('VxKbdComponent', () => {
  function build(isMac: boolean) {
    // Two platforms are exercised in one test, so the previous module must be torn down before the
    // next is configured — TestBed refuses to reconfigure once a component has been created.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [{ provide: PlatformService, useValue: { isMac: () => isMac } }],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  }

  function host(fixture: ReturnType<typeof build>): HTMLElement {
    return fixture.nativeElement.querySelector('vx-kbd');
  }

  it('renders a keycap per token and follows the platform', () => {
    const mac = build(true);
    expect([...host(mac).querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['⌥', '⇧', 'I']);

    const pc = build(false);
    expect([...host(pc).querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['Alt', 'Shift', 'I']);
  });

  it('exposes a spoken label and hides the glyphs from the reader', () => {
    const mac = build(true);
    expect(host(mac).getAttribute('role')).toBe('img');
    expect(host(mac).getAttribute('aria-label')).toBe('Option Shift I');
    expect(host(mac).querySelector('kbd')?.getAttribute('aria-hidden')).toBe('true');
  });
});
