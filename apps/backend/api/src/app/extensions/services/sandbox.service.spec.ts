import { SandboxService } from './sandbox.service';
import { PluginAdmissionService } from './plugin-admission.service';
import { SigningKeyProvider } from './signing-key.provider';

/**
 * These prove the security envelope, not just that code runs: a bad signature is refused, an
 * infinite loop is stopped, a throw is contained with forensics, and egress without the granted
 * capability is denied. Admission and the sandbox share one key provider so a real signature made
 * by the pipeline is what the isolate verifies.
 */
describe('SandboxService', () => {
  let keys: SigningKeyProvider;
  let admission: PluginAdmissionService;
  let sandbox: SandboxService;

  const validSbom = { bomFormat: 'CycloneDX', specVersion: '1.4', components: [] };

  beforeAll(() => {
    process.env.ALLOW_EPHEMERAL_PLUGIN_KEYS = 'true';
    keys = new SigningKeyProvider();
    admission = new PluginAdmissionService(keys);
    sandbox = new SandboxService(keys);
  });

  it('executes valid code with a valid signature', async () => {
    const code = 'const a = 1; const b = 2; log(a + b);';
    const validation = await admission.validatePlugin({ name: 'test', code, sbom: validSbom });
    expect(validation.status).toBe('approved');
    const result = await sandbox.run(code, validation.signature);
    expect(result.success).toBe(true);
  });

  it('refuses code without a valid signature', async () => {
    const result = await sandbox.run('log("hi");', 'not-a-real-signature');
    expect(result.success).toBe(false);
    expect(result.error).toContain('signature');
  });

  it('contains a throw and returns forensics', async () => {
    const code = 'throw new Error("Boom");';
    const validation = await admission.validatePlugin({ name: 'test', code, sbom: validSbom });
    const result = await sandbox.run(code, validation.signature);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Boom');
    expect(result.forensicData).toBeDefined();
  });

  it('stops an infinite loop at the timeout', async () => {
    const code = 'while (true) {}';
    const validation = await admission.validatePlugin({ name: 'test', code, sbom: validSbom });
    const result = await sandbox.run(code, validation.signature, 50);
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
    expect(result.forensicData).toBeDefined();
  });

  it('denies egress without the granted capability', async () => {
    const code = 'await fetch("https://api.taxjar.com/");';
    const validation = await admission.validatePlugin({ name: 'test', code, sbom: validSbom });
    const result = await sandbox.run(code, validation.signature, 1000, []);
    expect(result.success).toBe(false);
    expect(result.logs.join(' ') + (result.error ?? '')).toContain('egress:http');
  });

  it('runs a valid WebAssembly module', async () => {
    const wasmBuffer = Buffer.from([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f,
      0x03, 0x02, 0x01, 0x00,
      0x07, 0x08, 0x01, 0x04, 0x6d, 0x61, 0x69, 0x6e, 0x00, 0x00,
      0x0a, 0x06, 0x01, 0x04, 0x00, 0x41, 0x2a, 0x0b,
    ]);
    const result = await sandbox.runWasm(wasmBuffer, 5000);
    expect(result.success).toBe(true);
    expect(result.logs.some((l) => l.includes('42'))).toBe(true);
  }, 10000);
});
