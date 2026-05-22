import { Injectable, signal, effect, computed, Inject, PLATFORM_ID, OnDestroy, WritableSignal } from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';

export type ThemeMode = 'light' | 'dark' | 'system';
export type AppliedTheme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'app-theme-mode';

@Injectable({ providedIn: 'root' })
export class ThemeService implements OnDestroy {
  public themeMode: WritableSignal<ThemeMode>;
  private systemTheme: WritableSignal<AppliedTheme>;

  public activeTheme = computed<AppliedTheme>(() => {
    const mode = this.themeMode();
    return mode === 'system' ? this.systemTheme() : mode;
  });

  private colorSchemeQuery: MediaQueryList | undefined;
  private colorSchemeListener: ((e: MediaQueryListEvent) => void) | undefined;

  constructor(
    @Inject(DOCUMENT) private document: Document,
    @Inject(PLATFORM_ID) private platformId: object
  ) {
    this.systemTheme = signal(this.getInitialSystemTheme());
    this.themeMode = signal(this.getInitialThemeMode());

    // effect(() => this.updateThemeOnDom(this.activeTheme()), { allowSignalWrites: true });
    effect(() => this.updateThemeOnDom(this.activeTheme()), );

    if (isPlatformBrowser(this.platformId)) {
      this.colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.colorSchemeListener = (e: MediaQueryListEvent) => this.systemTheme.set(e.matches ? 'dark' : 'light');
      this.colorSchemeQuery.addEventListener('change', this.colorSchemeListener);
    }
  }

  public toggleTheme(): void {
    this.themeMode.update(currentMode => {
      const newMode: ThemeMode =
        currentMode === 'light' ? 'dark' : currentMode === 'dark' ? 'system' : 'light';
      localStorage.setItem(THEME_STORAGE_KEY, newMode);
      return newMode;
    });
  }

  private getInitialSystemTheme = (): AppliedTheme =>
    isPlatformBrowser(this.platformId) && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark' : 'light';

  private getInitialThemeMode = (): ThemeMode =>
    (isPlatformBrowser(this.platformId)
      ? localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode
      : 'system') || 'system';

  private updateThemeOnDom(theme: AppliedTheme): void {
    if (isPlatformBrowser(this.platformId)) {
      const themeLink = this.document.getElementById('app-theme') as HTMLLinkElement | null;
      if (themeLink) themeLink.href = `theme-${theme}.css`;
      // this.document.body.className = theme;
    }
  }

  ngOnDestroy(): void {
    if (this.colorSchemeQuery && this.colorSchemeListener) {
      this.colorSchemeQuery.removeEventListener('change', this.colorSchemeListener);
    }
  }
}