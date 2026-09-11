import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { SigningKeyProvider } from './signing-key.provider';

export interface AdmissionResult {
  status: 'approved' | 'rejected' | 'pending';
  riskScore: number;
  reason?: string;
  details?: unknown;
  signature?: string;
}

type DastResult = {
  verdict: 'clean' | 'quarantine' | 'malicious';
  riskScore: number;
  scanId?: string;
  details?: string;
};

export interface PluginPackage {
  name: string;
  code: string;
  dependencies?: Record<string, string>;
  sbom?: any;
  requestedEgress?: string[];
}

/**
 * The gate every extension passes before it is admitted to the catalogue.
 *
 * Ported from the standalone `plugin-host` service and adapted to run in-process. The pipeline is
 * defence-in-depth: SBOM presence, an OPA policy decision, static analysis (SonarQube quality
 * gate), software-composition analysis, a heuristic source scan, and dynamic analysis (DAST).
 * Only if all pass does it sign the artefact — the signature the sandbox later verifies.
 *
 * The external integrations (OPA, Sonar, DAST) are environment-gated so a developer can admit an
 * extension locally without standing up that infrastructure, while production keeps them
 * mandatory. The pure checks (SBOM, SCA, heuristics) always run.
 */
@Injectable()
export class PluginAdmissionService {
  private readonly logger = new Logger(PluginAdmissionService.name);
  private readonly nodeEnv = process.env['NODE_ENV'] ?? 'development';
  private readonly sonarUrl = process.env['SONAR_HOST_URL'] || 'http://localhost:9000';
  private readonly sonarToken = process.env['SONAR_TOKEN'] || '';
  private readonly dastUrl = process.env['PLUGIN_DAST_URL'] || '';
  private readonly dastToken = process.env['PLUGIN_DAST_TOKEN'] || '';
  private readonly requireDast =
    (process.env['PLUGIN_DAST_MODE'] ?? (this.nodeEnv === 'production' ? 'required' : 'best-effort')) ===
    'required';
  private readonly opaBin = process.env['OPA_BIN'] || path.join(process.cwd(), 'tools', 'opa');
  private readonly opaPolicy =
    process.env['PLUGIN_OPA_POLICY'] ||
    path.join(process.cwd(), 'platform', 'policies', 'security', 'plugin_admission.rego');

  constructor(private readonly signingKeys: SigningKeyProvider) {}

  async validatePlugin(pkg: PluginPackage): Promise<AdmissionResult> {
    try {
      if (!this.isValidSbom(pkg.sbom)) {
        return { status: 'rejected', riskScore: 100, reason: 'Missing or Invalid SBOM' };
      }

      const opaResult = this.evaluateOpaPolicy(pkg);
      if (!opaResult.allow) {
        return { status: 'rejected', riskScore: 100, reason: 'OPA Policy Violation', details: opaResult.reasons };
      }

      const sastResult = await this.performSastScan(pkg.name);
      if (!sastResult.valid) {
        return { status: 'rejected', riskScore: 100, reason: 'SAST Violation', details: sastResult.details };
      }

      const scaResult = this.performScaScan(pkg.dependencies);
      if (!scaResult.valid) {
        return { status: 'rejected', riskScore: 90, reason: 'SCA Violation', details: scaResult.details };
      }

      const heuristicResult = this.performHeuristicScan(pkg.code);
      if (!heuristicResult.valid) {
        return { status: 'rejected', riskScore: 80, reason: heuristicResult.reason, details: 'Heuristic check failed' };
      }

      const dastResult = await this.performDastScan(pkg);
      if (dastResult.verdict === 'malicious') {
        return { status: 'rejected', riskScore: dastResult.riskScore, reason: 'DAST Violation', details: dastResult };
      }
      if (dastResult.verdict === 'quarantine') {
        return { status: 'pending', riskScore: dastResult.riskScore, reason: 'DAST Quarantine', details: dastResult };
      }

      const signature = this.signPackage(pkg.code);
      return { status: 'approved', riskScore: 0, signature };
    } catch (error) {
      return {
        status: 'rejected',
        riskScore: 100,
        reason: 'Pipeline Error',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private performHeuristicScan(code: string): { valid: boolean; reason?: string } {
    const forbiddenPatterns = [
      { pattern: /eval\(/, reason: 'Use of eval()' },
      { pattern: /new Function\(/, reason: 'Use of new Function()' },
      { pattern: /process\.exit/, reason: 'Use of process.exit' },
      { pattern: /require\(['"]child_process['"]\)/, reason: 'Access to child_process' },
      { pattern: /require\(['"]fs['"]\)/, reason: 'Access to fs module' },
      { pattern: /__proto__/, reason: 'Prototype pollution vector' },
    ];
    for (const check of forbiddenPatterns) {
      if (check.pattern.test(code)) {
        return { valid: false, reason: `Unsafe pattern detected: ${check.reason}` };
      }
    }
    return { valid: true };
  }

  private async performSastScan(pluginName: string): Promise<{ valid: boolean; details?: unknown }> {
    if (!this.sonarToken) {
      if (this.nodeEnv === 'production') {
        return { valid: false, details: 'SONAR_TOKEN is required in production for SAST admission.' };
      }
      return { valid: true, details: 'SONAR_TOKEN not configured; SAST skipped in non-production.' };
    }
    try {
      const response = await axios.get(`${this.sonarUrl}/api/qualitygates/project_status`, {
        params: { projectKey: `plugin:${pluginName}` },
        auth: { username: this.sonarToken, password: '' },
        timeout: 5000,
      });
      const status = response.data?.projectStatus?.status;
      if (status === 'OK') return { valid: true };
      return { valid: false, details: response.data?.projectStatus ?? 'Unknown quality gate status' };
    } catch (error) {
      return { valid: false, details: error instanceof Error ? error.message : 'SAST service unavailable' };
    }
  }

  private performScaScan(dependencies?: Record<string, string>): { valid: boolean; details?: string } {
    const unsafeDependencies = new Set(['shelljs', 'child_process', 'fs', 'net', 'http', 'https']);
    const violations = Object.keys(dependencies || {}).filter((dep) => unsafeDependencies.has(dep));
    if (violations.length > 0) {
      return { valid: false, details: `Forbidden dependencies: ${violations.join(', ')}` };
    }
    return { valid: true };
  }

  private isValidSbom(sbom: any): boolean {
    if (!sbom) return false;
    return sbom.bomFormat === 'CycloneDX' && parseFloat(sbom.specVersion) >= 1.4;
  }

  private evaluateOpaPolicy(plugin: PluginPackage): { allow: boolean; reasons?: string[] } {
    // OPA is optional: if the binary or policy is absent, admission proceeds (dev-friendly), but
    // any OPA *failure* while it is present is fatal — a present policy that errors is not skipped.
    if (!fs.existsSync(this.opaBin) || !fs.existsSync(this.opaPolicy)) {
      if (this.nodeEnv === 'production') {
        return { allow: false, reasons: ['OPA binary/policy not available in production'] };
      }
      return { allow: true };
    }
    const input = {
      plugin: {
        name: plugin.name,
        is_signed: true,
        signature_valid: true,
        sbom: plugin.sbom,
        requested_egress: plugin.requestedEgress || [],
      },
    };
    const inputPath = path.join(os.tmpdir(), `virtex-opa-input-${crypto.randomBytes(8).toString('hex')}.json`);
    try {
      fs.writeFileSync(inputPath, JSON.stringify(input));
      const result = execFileSync(this.opaBin, [
        'eval',
        '--data',
        this.opaPolicy,
        '--input',
        inputPath,
        'data.virtex.security.plugins.allow',
      ]).toString();
      const parsed = JSON.parse(result);
      const allow = parsed.result?.[0]?.expressions?.[0]?.value === true;
      return { allow };
    } catch (e: any) {
      return { allow: false, reasons: [e.message] };
    } finally {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    }
  }

  private async performDastScan(pkg: PluginPackage): Promise<DastResult> {
    if (!this.requireDast) {
      return { verdict: 'clean', riskScore: 0, details: 'DAST disabled for this environment.' };
    }
    if (!this.dastUrl || !this.dastToken) {
      return {
        verdict: 'malicious',
        riskScore: 100,
        details: 'DAST integration is required: configure PLUGIN_DAST_URL and PLUGIN_DAST_TOKEN.',
      };
    }
    try {
      const response = await axios.post(
        `${this.dastUrl.replace(/\/$/, '')}/scan`,
        {
          pluginName: pkg.name,
          codeHash: crypto.createHash('sha256').update(pkg.code).digest('hex'),
          source: pkg.code,
        },
        { headers: { Authorization: `Bearer ${this.dastToken}` }, timeout: 10_000 },
      );
      const verdict = response.data?.verdict as DastResult['verdict'] | undefined;
      const riskScore = Number(response.data?.riskScore ?? 100);
      const scanId = response.data?.scanId as string | undefined;
      const details = response.data?.details as string | undefined;
      if (verdict === 'clean') return { verdict, riskScore: Math.max(0, riskScore), scanId, details };
      if (verdict === 'quarantine') return { verdict, riskScore: Math.max(1, riskScore), scanId, details };
      return {
        verdict: 'malicious',
        riskScore: Math.max(70, riskScore),
        scanId,
        details: details ?? 'DAST rejected plugin.',
      };
    } catch (error) {
      return {
        verdict: 'malicious',
        riskScore: 100,
        details: `DAST request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  private signPackage(code: string): string {
    const sign = crypto.createSign('SHA256');
    sign.update(code);
    sign.end();
    return sign.sign(this.signingKeys.getKeys().private, 'hex');
  }
}
