// Set before anything reads it: signing keys are resolved lazily on first use, and this guarantees
// the ephemeral-key path regardless of test-file ordering within a worker.
process.env.ALLOW_EPHEMERAL_PLUGIN_KEYS = 'true';

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

  /**
   * SSRF: el destino que se comprueba tiene que ser el destino al que se conecta.
   *
   * La implementación anterior hacía `dns.lookup` para validar una dirección y después entregaba
   * la URL a `https.get`, que la resuelve otra vez por su cuenta. Entre las dos resoluciones un
   * nombre que el atacante controla puede devolver otra cosa —DNS rebinding, y con TTL cero no
   * hace falta ni suerte—. Validar una resolución que nadie usa después no es un control.
   *
   * Y la lista de rangos privados eran cuatro prefijos de texto: `127.`, `10.`, `192.168.` y
   * `172.16.`. Lo que dejaba fuera importaba más que lo que cubría — sobre todo
   * `169.254.169.254`, el servicio de metadatos de AWS, GCP y Azure, que entrega credenciales de
   * instancia y es el destino más valioso de cualquier SSRF en la nube.
   */
  describe('clasificación de direcciones', () => {
    /** El clasificador real, sin red de por medio. */
    const assertRoutable = (address: string) =>
      (sandbox as unknown as { assertGloballyRoutable: (a: string) => void })
        .assertGloballyRoutable(address);

    it('admite una dirección pública', () => {
      expect(() => assertRoutable('93.184.216.34')).not.toThrow();
      expect(() => assertRoutable('2606:2800:220:1:248:1893:25c8:1946')).not.toThrow();
    });

    it('bloquea el servicio de metadatos de la nube', () => {
      // El rango que faltaba por completo, y el que más importa.
      expect(() => assertRoutable('169.254.169.254')).toThrow(/linkLocal/);
    });

    it('bloquea la red puente por defecto de Docker', () => {
      // `172.16.` cubría una de las dieciséis /16 del rango 172.16.0.0/12. Docker usa 172.17.
      expect(() => assertRoutable('172.17.0.1')).toThrow(/private/);
      expect(() => assertRoutable('172.31.255.254')).toThrow(/private/);
    });

    it('bloquea los rangos privados clásicos y el bucle local', () => {
      for (const address of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '::1']) {
        expect(() => assertRoutable(address)).toThrow();
      }
    });

    it('bloquea CGNAT y la dirección sin especificar', () => {
      expect(() => assertRoutable('100.64.0.1')).toThrow(/carrierGradeNat/);
      expect(() => assertRoutable('0.0.0.0')).toThrow();
    });

    it('bloquea IPv6 de ámbito local', () => {
      expect(() => assertRoutable('fd00::1')).toThrow(/uniqueLocal/);
      expect(() => assertRoutable('fe80::1')).toThrow(/linkLocal/);
    });

    it('juzga una IPv4 envuelta en IPv6 por la dirección que lleva dentro', () => {
      // `::ffff:169.254.169.254` es el metadato de la nube con otro traje.
      expect(() => assertRoutable('::ffff:169.254.169.254')).toThrow();
      expect(() => assertRoutable('::ffff:127.0.0.1')).toThrow();
      expect(() => assertRoutable('::ffff:93.184.216.34')).not.toThrow();
    });

    it('rechaza lo que no sabe interpretar en vez de dejarlo pasar', () => {
      expect(() => assertRoutable('no-es-una-ip')).toThrow(/unparseable/);
    });
  });

  describe('política de egreso', () => {
    const fetchThrough = (url: string) =>
      (sandbox as unknown as { doSecureFetch: (u: string) => Promise<string> })
        .doSecureFetch(url);

    it('rechaza un host que la política no permite', async () => {
      await expect(fetchThrough('https://evil.example.com/')).rejects.toThrow(/not allowed/);
    });

    it('rechaza cualquier esquema que no sea https', async () => {
      // Sin esto, `file:` y `http:` llegaban al parser de URL y pasaban la comprobación de host.
      await expect(fetchThrough('http://api.taxjar.com/')).rejects.toThrow(/only https/);
      await expect(fetchThrough('file:///etc/passwd')).rejects.toThrow(/only https/);
    });
  });
});
