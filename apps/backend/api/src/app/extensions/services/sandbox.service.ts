import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as https from 'https';
import { lookup as dnsLookup } from 'dns/promises';
import * as ipaddr from 'ipaddr.js';
import { PLUGIN_POLICY } from '../config/plugin-policy.config';
import { SigningKeyProvider } from './signing-key.provider';

/** Every address a hostname resolves to, in one call, in the order the resolver returned them. */
const lookupAll = (hostname: string): Promise<Array<{ address: string; family: number }>> =>
  dnsLookup(hostname, { all: true, verbatim: true });

export interface SandboxResult {
  success: boolean;
  logs: string[];
  error?: string;
  executionTimeMs?: number;
  forensicData?: {
    code: string;
    stack?: string;
    memoryUsage?: number;
  };
  metrics?: {
    memoryBytes: number;
    egressCount: number;
  };
}

interface SyscallEnvelope {
  op: string;
  payload: any;
}

/**
 * Runs untrusted extension code inside a hardened V8 isolate.
 *
 * Ported from the standalone `plugin-host` service. The `isolated-vm` native addon is loaded
 * lazily so the API still boots on a host that cannot compile it — execution then fails with a
 * clear error instead of the whole process refusing to start.
 *
 * Defences layered here, in order of the guarantees they give:
 *  - a real V8 isolate with a hard memory limit and an execution timeout (not a `vm` context,
 *    which shares the host heap and can be escaped);
 *  - a signature check before any code runs, so only artefacts the admission pipeline signed
 *    execute at all;
 *  - a narrow syscall bridge — the isolate has no ambient `require`, `fetch`, or globals; it can
 *    only `log` and, if the tenant granted `egress:http`, `fetch` a host on the egress allowlist;
 *  - SSRF protection on that fetch, in three parts: https only, an EXACT host match against the
 *    allow-list (a suffix match opened every subdomain, including ones somebody else controls),
 *    and a single DNS resolution whose every address must be globally routable unicast — then the
 *    connection is pinned to it, so `https.get` cannot resolve the name a second time and reach
 *    somewhere else. Classification is by range rather than by a list of private prefixes, which
 *    is how `169.254.169.254` — the cloud metadata service — came to be reachable.
 */
@Injectable()
export class SandboxService {
  private readonly MEMORY_LIMIT_MB = PLUGIN_POLICY.limits.memoryMb || 128;
  private readonly DEFAULT_TIMEOUT_MS = PLUGIN_POLICY.limits.timeoutMs || 1000;
  private readonly logger = new Logger(SandboxService.name);

  // Typed as `any` on purpose: the native addon is optional at build/boot time.
  private ivm: any = null;

  constructor(private readonly signingKeys: SigningKeyProvider) {}

  private loadIvm(): any {
    if (this.ivm) return this.ivm;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.ivm = require('isolated-vm');
      return this.ivm;
    } catch (err: any) {
      this.logger.error(
        `isolated-vm is not available (${err?.message}). Extension execution is disabled on this host.`,
      );
      throw new Error(
        'Extension sandbox unavailable: the isolated-vm native addon failed to load.',
      );
    }
  }

  /**
   * Execute a WebAssembly module inside the isolate. Extensions compiled to WASM run under the same
   * memory limit and timeout as JS, with a minimal `env` (log/abort) and nothing else — no
   * filesystem, no network, no host functions.
   */
  async runWasm(wasmBuffer: Buffer, timeout = this.DEFAULT_TIMEOUT_MS): Promise<SandboxResult> {
    const start = Date.now();
    let ivm: any;
    try {
      ivm = this.loadIvm();
    } catch (err: any) {
      return { success: false, logs: [], error: String(err?.message ?? err), executionTimeMs: 0 };
    }

    let isolate: any = null;
    let context: any = null;
    const logs: string[] = [];

    try {
      isolate = new ivm.Isolate({ memoryLimit: this.MEMORY_LIMIT_MB });
      context = isolate.createContextSync();
      const jail = context.global;
      jail.setSync('global', jail.derefInto());

      const logRef = new ivm.Reference((val: any) => {
        logs.push(String(val));
      });
      jail.setSync('__logRaw', logRef);

      const wasmUint8 = new Uint8Array(wasmBuffer);
      const wasmCopy = new ivm.ExternalCopy(
        wasmUint8.buffer.slice(wasmUint8.byteOffset, wasmUint8.byteOffset + wasmUint8.byteLength),
      );

      await context.evalClosure(
        `
        const logRef = __logRaw;
        const log = (val) => logRef.applySync(undefined, [val]);
        const wasm = $0;
        const module = new WebAssembly.Module(wasm);
        const instance = new WebAssembly.Instance(module, {
          env: {
            log: (val) => { log(val); },
            abort: () => { throw new Error('Wasm aborted'); }
          }
        });
        if (instance.exports.main) {
          const res = instance.exports.main();
          log('Wasm result: ' + res);
          return res;
        }
        throw new Error('No main function');
        `,
        [wasmCopy.copyInto()],
        { timeout, promise: true },
      );

      return { success: true, logs, executionTimeMs: Date.now() - start };
    } catch (err: any) {
      return {
        success: false,
        logs,
        error: `Hardened Wasm Error: ${err.message}`,
        executionTimeMs: Date.now() - start,
      };
    } finally {
      if (context) context.release();
      if (isolate && !isolate.isDisposed) isolate.dispose();
    }
  }

  async run(
    code: string,
    signature?: string,
    timeout = this.DEFAULT_TIMEOUT_MS,
    capabilities: string[] = [],
  ): Promise<SandboxResult> {
    const start = Date.now();
    if (!this.verifyCodeSignature(code, signature)) {
      return {
        success: false,
        logs: [],
        error: 'Security Error: Invalid or missing digital signature.',
        executionTimeMs: 0,
      };
    }

    let ivm: any;
    try {
      ivm = this.loadIvm();
    } catch (err: any) {
      return { success: false, logs: [], error: String(err?.message ?? err), executionTimeMs: 0 };
    }

    let isolate: any = null;
    let context: any = null;
    const logs: string[] = [];
    let egressCount = 0;

    try {
      isolate = new ivm.Isolate({ memoryLimit: this.MEMORY_LIMIT_MB, inspector: false });
      context = isolate.createContextSync();
      const jail = context.global;
      jail.setSync('global', jail.derefInto());

      const syscallRef = new ivm.Reference(async (op: string, payloadJson: string) => {
        try {
          if (op === 'fetch') egressCount++;
          const res = await this.handleSyscall(
            { op, payload: JSON.parse(payloadJson) },
            logs,
            capabilities,
          );
          return JSON.stringify(res);
        } catch (e: any) {
          return JSON.stringify({ ok: false, error: e.message });
        }
      });
      jail.setSync('__syscallRaw', syscallRef);

      context.evalSync(`
        const syscallRef = __syscallRaw;
        global.__syscall = (op, payload) => {
          return syscallRef.apply(undefined, [op, JSON.stringify(payload)], { result: { promise: true, copy: true } });
        };
        global.log = (...args) => {
          const msg = args.map(String).join(' ');
          __syscall('log', msg);
        };
        global._fetch = async (url) => {
          const resJson = await __syscall('fetch', { url });
          const res = JSON.parse(resJson);
          if (!res.ok) throw new Error(res.error);
          return res.result;
        };
        global.fetch = global._fetch;
      `);

      const wrappedCode = `(async () => {
        try {
          ${code}
        } catch (e) {
          log('Uncaught Plugin Error: ' + e.message);
          throw e;
        }
      })()`;

      const script = isolate.compileScriptSync(wrappedCode);
      await script.run(context, { timeout, promise: true });

      const memoryUsage = isolate ? isolate.getHeapStatisticsSync().total_heap_size : 0;
      return {
        success: true,
        logs,
        executionTimeMs: Date.now() - start,
        metrics: { memoryBytes: memoryUsage, egressCount },
      };
    } catch (err: any) {
      const memoryUsage = isolate ? isolate.getHeapStatisticsSync().total_heap_size : 0;
      return {
        success: false,
        logs,
        error: String(err),
        executionTimeMs: Date.now() - start,
        forensicData: { code, stack: err?.stack || String(err), memoryUsage },
        metrics: { memoryBytes: memoryUsage, egressCount },
      };
    } finally {
      if (context) context.release();
      if (isolate && !isolate.isDisposed) isolate.dispose();
    }
  }

  private async handleSyscall(
    envelope: SyscallEnvelope,
    logs: string[],
    capabilities: string[] = [],
  ): Promise<{ ok: boolean; result?: any; error?: string }> {
    switch (envelope.op) {
      case 'log':
        if (logs.length < 100) logs.push(String(envelope.payload));
        return { ok: true };
      case 'fetch':
        if (!capabilities.includes('egress:http')) {
          return { ok: false, error: 'Security Exception: Plugin missing "egress:http" capability.' };
        }
        try {
          const result = await this.doSecureFetch(envelope.payload.url);
          return { ok: true, result };
        } catch (e: any) {
          return { ok: false, error: e.message };
        }
      default:
        return { ok: false, error: 'Unknown op' };
    }
  }

  /**
   * Refuse any address that is not globally routable unicast.
   *
   * The previous check was four string prefixes — `127.`, `10.`, `192.168.`, `172.16.` — and what
   * it left out mattered more than what it caught:
   *
   *  - `169.254.0.0/16`, which holds the cloud metadata service at 169.254.169.254. That endpoint
   *    hands out instance credentials and is the single most valuable target of any SSRF in a
   *    hosted environment. It was not covered.
   *  - Fifteen sixteenths of `172.16.0.0/12`: only `172.16.` matched, so `172.17.`–`172.31.` were
   *    allowed — and `172.17.0.0/16` is Docker's default bridge network.
   *  - `100.64.0.0/10` (carrier-grade NAT), `0.0.0.0/8`, broadcast, multicast, and every reserved
   *    range.
   *  - All of IPv6, including `::1` and unique-local `fc00::/7`; `{ family: 4 }` constrained the
   *    lookup but not the connection.
   *
   * Classifying with `ipaddr.js` — already a dependency, already used for IP masking — replaces
   * the deny-list of things somebody remembered with an ALLOW-list of one value: `unicast`. Every
   * special-use range the library knows about is rejected by construction, including ones added to
   * the registry after this code was written.
   */
  private assertGloballyRoutable(address: string): void {
    let parsed: ipaddr.IPv4 | ipaddr.IPv6;
    try {
      parsed = ipaddr.parse(address);
    } catch {
      throw new Error(`Security Exception: unparseable address ${address}.`);
    }

    // An IPv4-mapped IPv6 address (::ffff:169.254.169.254) must be judged by the address it
    // actually carries, not by the wrapper.
    if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
      parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    }

    const range = parsed.range();
    if (range !== 'unicast') {
      throw new Error(
        `Security Exception: egress to ${address} blocked (${range} address, not globally routable).`,
      );
    }
  }

  private async doSecureFetch(url: string): Promise<string> {
    const parsedUrl = new URL(url);

    // Only HTTPS. Without this, `file:`, `http:` and `gopher:` reached the URL parser and the
    // allow-list check passed on hostname alone.
    if (parsedUrl.protocol !== 'https:') {
      throw new Error(`Security Exception: only https is permitted (got ${parsedUrl.protocol}).`);
    }

    // Exact host match, not a suffix match.
    //
    // `hostname.endsWith('.' + allowed)` admitted EVERY subdomain of an allowed host, which is a
    // much larger surface than the list reads as: an allowed `api.taxjar.com` also permitted
    // `anything.api.taxjar.com`, including a name whose DNS somebody else controls. Combined with
    // the DNS re-resolution that used to happen below, that was the whole SSRF path.
    //
    // A wildcard is still expressible, and now it has to be written down: an entry of the form
    // `*.example.com` opts into subdomains explicitly, so the breadth of the policy is visible in
    // the policy.
    const host = parsedUrl.hostname.toLowerCase();
    const isAllowed = PLUGIN_POLICY.egress.allowlist.some((allowed) => {
      const entry = allowed.toLowerCase();
      if (entry.startsWith('*.')) {
        const suffix = entry.slice(1); // '.example.com'
        return host.endsWith(suffix) && host.length > suffix.length;
      }
      return host === entry;
    });
    if (!isAllowed) {
      throw new Error(`Security Exception: Egress to ${parsedUrl.hostname} is not allowed by policy.`);
    }

    // Resolve ONCE, and connect to what was resolved.
    //
    // The previous implementation called `dns.lookup` to validate an address and then handed the
    // URL to `https.get`, which resolves the name again on its own. Between the two resolutions a
    // hostname the attacker controls can return a different address — classic DNS rebinding, and
    // with a zero-second TTL it needs no timing luck at all. Validating a resolution nobody
    // subsequently uses is not a control.
    //
    // `all: true` because a name with several A/AAAA records must be judged on every one of them:
    // validating the first and letting the agent pick another is the same bug one level down.
    const resolved = await lookupAll(parsedUrl.hostname).catch((error: Error) => {
      throw new Error(`DNS lookup failed: ${error.message}`);
    });
    if (!resolved.length) {
      throw new Error(`DNS lookup for ${parsedUrl.hostname} returned no addresses.`);
    }
    for (const entry of resolved) {
      this.assertGloballyRoutable(entry.address);
    }

    const pinned = resolved[0];

    return new Promise((resolve, reject) => {
      const req = https.get(
        url,
        {
          timeout: 5000,
          minVersion: 'TLSv1.2',
          rejectUnauthorized: true,
          // Pin the connection to the address we validated. The Host header and the TLS SNI still
          // come from the URL, so certificate verification is unaffected and the request is
          // indistinguishable from an ordinary one to the legitimate server.
          lookup: (_hostname, _options, callback) =>
            callback(null, pinned.address as never, pinned.family),
        },
        (res) => {
          // `https.get` does not follow redirects, so a 3xx simply lands here. Rejecting every
          // non-2xx keeps it that way: a redirect to an internal address is never followed.
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            res.resume();
            return reject(new Error(`Status ${res.statusCode}`));
          }
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
            if (data.length > 2 * 1024 * 1024) {
              req.destroy();
              reject(new Error('Too large'));
            }
          });
          res.on('end', () => resolve(data));
        },
      );
      req.on('error', (err) => reject(new Error(err.message)));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
    });
  }

  /**
   * Verify the admission pipeline's attestation over the exact source about to run.
   *
   * There used to be a first line here reading
   * `if (process.env['NODE_ENV'] === 'test' && signature === 'valid-signature') return true;`
   * — a literal string in the repository standing in for an RSA signature, on the one check that
   * decides whether untrusted code executes. It is gone. Tests inject a `SigningKeyProvider` with
   * an ephemeral key pair and sign for real, so the production path has no branch a test can take.
   */
  private verifyCodeSignature(code: string, signature?: string): boolean {
    if (!signature) return false;
    let publicKey: string;
    try {
      publicKey = this.signingKeys.getPublicKey();
    } catch {
      return false;
    }
    if (!publicKey) return false;
    try {
      const verify = crypto.createVerify('SHA256');
      verify.update(code);
      verify.end();
      return verify.verify(publicKey, signature, 'hex');
    } catch {
      return false;
    }
  }
}
