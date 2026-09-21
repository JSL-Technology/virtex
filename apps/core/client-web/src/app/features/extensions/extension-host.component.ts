import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  ViewChild,
  inject,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { NotificationService } from '../../core/services/notification';

export interface RuntimeExtension {
  name: string;
  version: string;
  uiEntry: string;
  contributes?: unknown;
  grantedCapabilities: string[];
}

/**
 * The client-side extension host: mounts one extension's UI inside a sandboxed iframe and brokers a
 * narrow, capability-gated bridge between it and the app.
 *
 * Isolation: the iframe is `sandbox="allow-scripts"` with NO `allow-same-origin`, so its content
 * runs in a unique opaque origin — it cannot read the parent DOM, our cookies, or localStorage, and
 * cannot make same-origin requests. The only channel is `postMessage`, and the parent only honours
 * a fixed set of message types, only from this iframe's own window.
 *
 * The extension code is delivered over `postMessage` (not embedded in the document), so there is no
 * markup-escaping surface, and it runs via `new Function(code)(virtex, root)` inside its own
 * sandbox. `virtex.api(...)` is proxied here using the app's session — the extension never sees a
 * token, and a call is refused unless the tenant granted the matching capability.
 */
@Component({
  selector: 'app-extension-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="ext-host" #container></div>`,
  styles: [
    `
      .ext-host {
        width: 100%;
        min-height: 320px;
      }
      .ext-host iframe {
        width: 100%;
        min-height: 320px;
        border: 0;
        border-radius: 8px;
        background: var(--surface-canvas);
      }
    `,
  ],
})
export class ExtensionHostComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) extension!: RuntimeExtension;
  @Input() context: Record<string, unknown> = {};

  @ViewChild('container', { static: true }) container!: ElementRef<HTMLDivElement>;

  private readonly http = inject(HttpClient);
  private readonly notifications = inject(NotificationService);

  private iframe: HTMLIFrameElement | null = null;
  private listener = (event: MessageEvent) => this.onMessage(event);

  ngAfterViewInit(): void {
    const iframe = document.createElement('iframe');
    // The security boundary. allow-scripts WITHOUT allow-same-origin = opaque origin sandbox.
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('title', `extension:${this.extension.name}`);
    iframe.srcdoc = HARNESS_HTML;
    this.iframe = iframe;
    window.addEventListener('message', this.listener);
    this.container.nativeElement.appendChild(iframe);
  }

  ngOnDestroy(): void {
    window.removeEventListener('message', this.listener);
    if (this.iframe) this.iframe.remove();
    this.iframe = null;
  }

  private post(message: Record<string, unknown>): void {
    this.iframe?.contentWindow?.postMessage({ __vxHost: true, ...message }, '*');
  }

  private async onMessage(event: MessageEvent): Promise<void> {
    // Only ever trust messages from this host's own iframe.
    if (!this.iframe || event.source !== this.iframe.contentWindow) return;
    const data = event.data;
    if (!data || data.__vx !== true) return;

    switch (data.type) {
      case 'ready':
        this.post({
          type: 'init',
          code: this.extension.uiEntry,
          context: {
            ...this.context,
            extension: this.extension.name,
            version: this.extension.version,
            capabilities: this.extension.grantedCapabilities,
          },
        });
        return;

      case 'ui.toast': {
        const level = String(data.payload?.level ?? 'info');
        const message = String(data.payload?.message ?? '');
        if (level === 'error') this.notifications.showError(message);
        else this.notifications.showSuccess(message);
        return;
      }

      case 'api.request': {
        await this.handleApiRequest(data.id, data.payload);
        return;
      }
    }
  }

  /**
   * Which API paths a granted capability actually opens.
   *
   * `api:read` used to be the whole gate, and it opened everything: the only checks were that the
   * method was GET and the path started with a slash. An extension installed to draw a sales
   * heatmap could therefore read `/payroll/runs`, `/users` and `/audit` — with the session of
   * whoever had the screen open, so for an administrator holding `'*'` that is the entire ERP.
   *
   * The consent screen showed the string `api:read`, so what the customer approved did not
   * describe what they were granting.
   *
   * Scoped capabilities fix both halves: the extension declares which areas it needs, the tenant
   * sees those areas by name when consenting, and the bridge refuses anything outside them.
   * `api:read` itself is kept for extensions published before scopes existed, and is deliberately
   * narrowed to the reference data that motivated it rather than left as a skeleton key.
   */
  private static readonly CAPABILITY_SCOPES: Record<string, readonly string[]> = {
    'api:read:sales': ['/invoices', '/sales', '/customers', '/price-lists'],
    'api:read:inventory': ['/inventory', '/products', '/units-of-measure'],
    'api:read:purchasing': ['/suppliers', '/purchasing', '/procurement', '/accounts-payable'],
    'api:read:accounting': ['/chart-of-accounts', '/journal-entries', '/accounting', '/reports'],
    'api:read:projects': ['/projects', '/dimensions'],
    // Legacy grant. Reference data only — never payroll, users, audit, treasury or settings.
    'api:read': ['/currencies', '/taxes', '/units-of-measure', '/localization'],
  };

  /** Every path prefix this extension's granted capabilities allow. */
  private allowedPrefixes(): string[] {
    return this.extension.grantedCapabilities.flatMap(
      (capability) => ExtensionHostComponent.CAPABILITY_SCOPES[capability] ?? [],
    );
  }

  private async handleApiRequest(id: number, payload: any): Promise<void> {
    const path: string = payload?.path ?? '';
    const method: string = (payload?.opts?.method ?? 'GET').toUpperCase();

    if (method !== 'GET') {
      return this.post({ id, error: 'Only GET requests are allowed from extensions' });
    }
    if (typeof path !== 'string' || !path.startsWith('/') || path.includes('..')) {
      return this.post({ id, error: 'Invalid API path' });
    }

    const prefixes = this.allowedPrefixes();
    if (!prefixes.length) {
      return this.post({ id, error: 'This extension has no API read capability' });
    }

    // Prefix match on a SEGMENT boundary: `/users` must not be opened by a grant of `/user`, and
    // `/payroll-summary` must not be opened by a grant of `/payroll`.
    const [pathname] = path.split('?');
    const permitted = prefixes.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
    if (!permitted) {
      return this.post({ id, error: `Path outside the granted capabilities: ${pathname}` });
    }

    try {
      const result = await firstValueFrom(this.http.get(`${environment.apiUrl}${path}`));
      this.post({ id, result });
    } catch (err: any) {
      this.post({ id, error: err?.error?.message ?? err?.message ?? 'Request failed' });
    }
  }
}

/**
 * The static harness loaded into the sandboxed iframe. It contains no extension code — it waits for
 * the parent to post the code, runs it with a `virtex` bridge and a `root` element, and forwards
 * `virtex.api` / `virtex.toast` calls to the parent over postMessage.
 */
const HARNESS_HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0}
  body{font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:12px;color:#111}
  @media (prefers-color-scheme: dark){ body{background:#141414;color:#e7e9ee} }
  #root{min-height:280px}
  .vx-err{color:#ef4444;font-size:.85rem;white-space:pre-wrap}
</style></head><body><div id="root"></div>
<script>
(function(){
  var seq=0, pending={};
  function send(m){ parent.postMessage(Object.assign({__vx:true}, m), '*'); }
  function call(type, payload){ return new Promise(function(res,rej){ var id=++seq; pending[id]={res:res,rej:rej}; send({type:type,id:id,payload:payload}); }); }
  var virtex = {
    api:function(path, opts){ return call('api.request', {path:path, opts:opts||{}}); },
    toast:function(level, message){ send({type:'ui.toast', payload:{level:level, message:message}}); },
    context:{}
  };
  window.addEventListener('message', function(e){
    var d=e.data; if(!d || d.__vxHost!==true) return;
    if(d.type==='init'){
      virtex.context = d.context || {};
      try { (new Function('virtex','root', d.code))(virtex, document.getElementById('root')); }
      catch(err){ var el=document.getElementById('root'); el.innerHTML=''; var p=document.createElement('pre'); p.className='vx-err'; p.textContent='Extension error: '+(err&&err.message||err); el.appendChild(p); }
    } else if(d.id && pending[d.id]){
      var pr=pending[d.id]; delete pending[d.id];
      if(d.error) pr.rej(new Error(d.error)); else pr.res(d.result);
    }
  });
  send({type:'ready'});
})();
</script></body></html>`;
