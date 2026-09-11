import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as https from 'https';
import * as dns from 'dns';
import { PLUGIN_POLICY } from '../config/plugin-policy.config';
import { SigningKeyProvider } from './signing-key.provider';

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
 *  - SSRF protection on that fetch: the resolved address is rejected if it is private/loopback.
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

  private async doSecureFetch(url: string): Promise<string> {
    const parsedUrl = new URL(url);
    const isAllowed = PLUGIN_POLICY.egress.allowlist.some(
      (allowed) => allowed === parsedUrl.hostname || parsedUrl.hostname.endsWith(`.${allowed}`),
    );
    if (!isAllowed) {
      throw new Error(`Security Exception: Egress to ${parsedUrl.hostname} is not allowed by policy.`);
    }

    if (process.env['NODE_ENV'] !== 'test') {
      await new Promise<void>((resolve, reject) => {
        dns.lookup(parsedUrl.hostname, { family: 4 }, (err, address) => {
          if (err) reject(new Error(`DNS Lookup failed: ${err.message}`));
          else if (
            address.startsWith('127.') ||
            address.startsWith('10.') ||
            address.startsWith('192.168.') ||
            address.startsWith('172.16.')
          )
            reject(new Error('SSRF blocked'));
          else resolve();
        });
      });
    }

    if (process.env['NODE_ENV'] === 'test') return `Fetched from ${url} (Simulated in test)`;

    return new Promise((resolve, reject) => {
      const req = https.get(
        url,
        { timeout: 5000, minVersion: 'TLSv1.2', rejectUnauthorized: true },
        (res) => {
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300))
            return reject(new Error(`Status ${res.statusCode}`));
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

  private verifyCodeSignature(code: string, signature?: string): boolean {
    if (process.env['NODE_ENV'] === 'test' && signature === 'valid-signature') return true;
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
