import { Injectable } from '@angular/core';

/**
 * Prints a self-contained HTML document — a ticket, a shift report — and nothing else on the page.
 *
 * Through a hidden iframe rather than `window.open`: the web client's till opened a pop-up, which
 * every browser blocks unless the click is fresh, and a cashier who had just charged a customer was
 * told to unblock pop-ups instead of getting the receipt. An iframe needs no permission, prints the
 * document alone, and is removed once the print dialog is done with it.
 */
@Injectable({ providedIn: 'root' })
export class PrinterService {
  print(html: string): Promise<void> {
    return new Promise((resolve) => {
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      Object.assign(frame.style, {
        position: 'fixed',
        right: '0',
        bottom: '0',
        width: '0',
        height: '0',
        border: '0',
      });
      frame.srcdoc = html;
      frame.onload = () => {
        const win = frame.contentWindow;
        const cleanup = () => {
          frame.remove();
          resolve();
        };
        if (!win) return cleanup();
        win.addEventListener('afterprint', () => setTimeout(cleanup, 0), {
          once: true,
        });
        win.focus();
        win.print();
        // Browsers that print synchronously never fire `afterprint` on an iframe.
        setTimeout(cleanup, 60_000);
      };
      document.body.appendChild(frame);
    });
  }
}
