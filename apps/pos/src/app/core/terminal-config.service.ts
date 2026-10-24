import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'virtex.pos.terminal';
const AUTO_PRINT_KEY = 'virtex.pos.autoPrint';
/** What a terminal id may look like: short, printable, safe on a ticket and in a URL. */
export const TERMINAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

/**
 * Which till this device is.
 *
 * Every shift and every sale is keyed by terminal; the till used to hard-code `'main'`, so two
 * devices in one shop were one till — they shared a shift, the second one's sales landed in the
 * first one's drawer, and closing either closed both. The id is now set per device (once, by
 * whoever installs it) and remembered in this browser. It is a device setting, not a security
 * boundary: the server scopes every shift to the tenant and its cashier regardless of the id.
 */
@Injectable({ providedIn: 'root' })
export class TerminalConfigService {
  private readonly _terminalId = signal(this.read());
  readonly terminalId = this._terminalId.asReadonly();

  /** Print the ticket as soon as a sale completes (a counter with a receipt printer attached). */
  private readonly _autoPrint = signal(this.readFlag(AUTO_PRINT_KEY));
  readonly autoPrint = this._autoPrint.asReadonly();

  setAutoPrint(value: boolean): void {
    this._autoPrint.set(value);
    try {
      localStorage.setItem(AUTO_PRINT_KEY, value ? '1' : '0');
    } catch {
      // Blocked storage: the choice holds for this page load.
    }
  }

  private readFlag(key: string): boolean {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  }

  setTerminalId(value: string): boolean {
    const id = value.trim();
    if (!TERMINAL_ID_PATTERN.test(id)) return false;
    this._terminalId.set(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Private window or blocked storage: the id holds for this page load.
    }
    return true;
  }

  private read(): string {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && TERMINAL_ID_PATTERN.test(stored)) return stored;
    } catch {
      // Unavailable storage falls back to the default till.
    }
    return 'main';
  }
}
