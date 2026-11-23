import { Injectable, signal } from '@angular/core';
import type { StatementLanguage } from './statement-export.service';

const STORAGE_KEY = 'vx-export-language';
const CHOICES: readonly StatementLanguage[] = ['reader', 'books', 'bilingual'];

/**
 * The language this person exports statements in, remembered on this device (books bilingual).
 *
 * A preference of the viewer's, like the books view: the controller who sends the parent company
 * its statements in English every month chooses it once. Storage that is unavailable — a private
 * window, blocked site data — leaves the default: the reader's language.
 */
@Injectable({ providedIn: 'root' })
export class ExportLanguagePreference {
  private readonly _language = signal<StatementLanguage>(read());
  readonly language = this._language.asReadonly();

  set(language: StatementLanguage): void {
    if (!CHOICES.includes(language)) return;
    this._language.set(language);
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // Remembered for this page only.
    }
  }
}

function read(): StatementLanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as StatementLanguage | null;
    return stored && CHOICES.includes(stored) ? stored : 'reader';
  } catch {
    return 'reader';
  }
}
