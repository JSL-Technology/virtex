import { Injectable, computed, inject, signal } from '@angular/core';
import { DesktopWindowService } from '../windows/desktop-window.service';

/** The slice of `navigator` we read for platform detection, without pulling in `any`. */
interface PlatformNavigator {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string };
}

/** True when the browser reports an Apple platform — Mac, iPhone or iPad. */
function detectApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as unknown as PlatformNavigator;
  // `userAgentData.platform` is the modern, unfrozen source; `navigator.platform` is the legacy
  // one every browser still fills. Either saying "mac"/"iphone"/"ipad" is enough.
  const declared = (nav.userAgentData?.platform || nav.platform || '').toLowerCase();
  if (/mac|iphone|ipad|ipod/.test(declared)) return true;
  // iPadOS 13+ Safari lies and reports a desktop UA ("MacIntel"); the UA string still carries it.
  return /Mac|iPhone|iPad|iPod/.test(nav.userAgent || '');
}

/**
 * Which keyboard the reader is on — the one thing that decides whether a shortcut shows ⌘ or Ctrl.
 *
 * ## Why not `DesktopWindowService.isMac`
 *
 * That one answers a different question: "is the Electron window drawn by macOS", which is only
 * true inside the desktop app and exists to decide whether the title bar draws its own window
 * buttons. A Mac user in a *browser* gets `false` there — yet `⌘W` is exactly what closes their
 * tab, and Safari would be told to show "Ctrl". So keyboard glyphs need a platform signal that is
 * also true in the browser, which is what this service adds. It still defers to the desktop bridge
 * when it is present, because inside Electron `process.platform` is the authoritative answer.
 *
 * ## Why a signal and not a constant
 *
 * The desktop bridge fills `platform` asynchronously at startup; reading it through the existing
 * signal keeps this reactive so a shortcut rendered before the bridge resolved still flips to ⌘
 * once it does. In the browser the value is settled at construction and never changes.
 */
@Injectable({ providedIn: 'root' })
export class PlatformService {
  private readonly desktop = inject(DesktopWindowService);
  private readonly browserIsApple = signal(detectApplePlatform());

  /** True on any Apple keyboard — desktop app on macOS, or any browser on a Mac/iPad. */
  readonly isMac = computed(() => this.desktop.platform() === 'darwin' || this.browserIsApple());
}
