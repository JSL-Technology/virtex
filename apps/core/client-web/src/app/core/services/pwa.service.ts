import { Injectable, signal, PLATFORM_ID, inject, HostListener } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

@Injectable({
  providedIn: 'root'
})
export class PwaService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  // Install related
  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  public canInstall = signal(false);

  // Connection related
  public isOnline = signal(true);

  constructor() {
    if (this.isBrowser) {
      this.isOnline.set(window.navigator.onLine);
      this.initEventListeners();
    }
  }

  private initEventListeners() {
    window.addEventListener('beforeinstallprompt', (e) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Stash the event so it can be triggered later.
      this.deferredPrompt = e as BeforeInstallPromptEvent;
      // Update UI notify the user they can install the PWA
      this.canInstall.set(true);
    });

    window.addEventListener('appinstalled', (evt) => {
      // Log install to analytics
      console.log('INSTALL: Success');
      this.canInstall.set(false);
      this.deferredPrompt = null;
    });

    window.addEventListener('online', () => this.isOnline.set(true));
    window.addEventListener('offline', () => this.isOnline.set(false));
  }

  public async installApp() {
    if (!this.deferredPrompt) {
      return;
    }
    // Show the install prompt
    this.deferredPrompt.prompt();
    // Wait for the user to respond to the prompt
    const { outcome } = await this.deferredPrompt.userChoice;
    // Optionally, send analytics event with outcome of user choice
    console.log(`User response to the install prompt: ${outcome}`);
    // We've used the prompt, and can't use it again, throw it away
    this.deferredPrompt = null;
    this.canInstall.set(false);
  }
}
