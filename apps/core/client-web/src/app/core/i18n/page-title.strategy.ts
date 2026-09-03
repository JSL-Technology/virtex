import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';

/**
 * One place that decides what the browser tab says.
 *
 * Route titles were literal strings, in Spanish, each carrying its own copy of the product name —
 * and the name they carried was **FacturaPRO**, a different product entirely. The application
 * meanwhile called itself Virtex in its translation files and Virteex in the backend, so a
 * customer signing up saw three brands across one flow and none of them agreed.
 *
 * A route now names a translation key. The product name comes from `APP_TITLE`, so it is one
 * value in two files rather than a literal repeated at every route, and the tab reads in the
 * language the user chose.
 *
 * A route with no `title` gets the product name alone rather than whatever the previous page had
 * left behind, which is what an unset title actually does.
 *
 * ## Why it listens for the language change
 *
 * `updateTitle` runs on navigation. Changing the language is not a navigation, so the tab kept
 * the previous language's title until the reader happened to move to another page — the one part
 * of the interface that did not follow the switch. Re-rendering on `onLangChange` costs one
 * translation lookup and removes that inconsistency.
 *
 * The last snapshot the router handed us is cached rather than read back from an injected
 * `Router`. Injecting `Router` here is a circular dependency — the router injects the
 * `TitleStrategy` to update the title on navigation, so a `TitleStrategy` that injects the router
 * closes the loop and Angular throws `NG0200` at bootstrap. The router already passes the snapshot
 * to `updateTitle`; keeping the most recent one is all the language re-render needs.
 */
@Injectable({ providedIn: 'root' })
export class TranslatedTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly translate = inject(TranslateService);
  private lastSnapshot: RouterStateSnapshot | null = null;

  constructor() {
    super();
    this.translate.onLangChange.subscribe(() => {
      if (this.lastSnapshot) this.updateTitle(this.lastSnapshot);
    });
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.lastSnapshot = snapshot;

    const key = this.buildTitle(snapshot);
    const appName = this.translate.instant('APP_TITLE');

    if (!key) {
      this.title.setTitle(appName);
      return;
    }

    const page = this.translate.instant(key);
    // `instant` returns the key itself when there is no entry for it, which would put
    // `AUTH.TITLES.LOGIN` in the browser tab. A literal title passed through unchanged is the
    // useful fallback.
    this.title.setTitle(`${page === key ? key : page} | ${appName}`);
  }
}
