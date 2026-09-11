import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plugin, PluginStatus } from './entities/plugin.entity';
import { PluginChannel, PluginVersion } from './entities/plugin-version.entity';
import { TenantConsent } from './entities/tenant-consent.entity';
import { PluginAdmissionService } from './services/plugin-admission.service';
import { SandboxService } from './services/sandbox.service';
import { MeteringService } from './services/metering.service';
import { BillingService, BillingReport } from './services/billing.service';
import { RegisterPluginDto } from './dto/register-plugin.dto';
import { ExecutePluginDto } from './dto/execute-plugin.dto';
import { GrantConsentDto } from './dto/grant-consent.dto';

const EMPTY_SBOM = { bomFormat: 'CycloneDX', specVersion: '1.4', components: [] };

/**
 * Orchestrates the extension lifecycle: catalogue management, per-tenant consent, and metered,
 * consent-gated execution in the sandbox.
 *
 * This is the in-process replacement for the standalone plugin-host's Fastify routes. The same
 * invariants hold: nothing is admitted without passing the admission pipeline; nothing executes
 * without a verified signature; a version's declared capabilities require tenant consent; and every
 * execution is metered.
 */
@Injectable()
export class ExtensionsService {
  private readonly logger = new Logger(ExtensionsService.name);

  constructor(
    @InjectRepository(Plugin) private readonly plugins: Repository<Plugin>,
    @InjectRepository(PluginVersion) private readonly versions: Repository<PluginVersion>,
    @InjectRepository(TenantConsent) private readonly consents: Repository<TenantConsent>,
    private readonly admission: PluginAdmissionService,
    private readonly sandbox: SandboxService,
    private readonly metering: MeteringService,
    private readonly billing: BillingService,
  ) {}

  async list() {
    const plugins = await this.plugins.find({ relations: { versions: true } });
    return plugins.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      description: p.description,
      author: p.author,
      versionCount: p.versions?.length ?? 0,
    }));
  }

  async getByName(name: string) {
    const plugin = await this.plugins.findOne({ where: { name }, relations: { versions: true } });
    if (!plugin) throw new NotFoundException('Plugin not found');
    return plugin;
  }

  async register(dto: RegisterPluginDto) {
    let plugin = await this.plugins.findOne({ where: { name: dto.name } });
    if (!plugin) {
      plugin = this.plugins.create({
        name: dto.name,
        description: dto.description ?? null,
        author: dto.author ?? null,
        status: PluginStatus.ACTIVE,
      });
      plugin = await this.plugins.save(plugin);
    }

    const admission = await this.admission.validatePlugin({
      name: dto.name,
      code: dto.code,
      dependencies: dto.dependencies,
      sbom: dto.sbom,
      requestedEgress: dto.requestedEgress,
    });

    if (admission.status === 'rejected') {
      throw new ForbiddenException({
        error: 'Plugin rejected by admission policy during registration',
        reason: admission.reason,
        details: admission.details,
      });
    }

    const version = this.versions.create({
      pluginId: plugin.id,
      version: dto.version,
      code: dto.code,
      capabilities: dto.capabilities ?? null,
      sbom: dto.sbom,
      signature: admission.signature ?? null,
      channel: PluginChannel.STABLE,
    });
    await this.versions.save(version);

    return {
      status: 'success',
      admission: admission.status,
      message: `Plugin ${dto.name} v${dto.version} registered.`,
      id: plugin.id,
    };
  }

  async revoke(name: string) {
    const plugin = await this.plugins.findOne({ where: { name } });
    if (!plugin) throw new NotFoundException('Plugin not found');
    plugin.status = PluginStatus.REVOKED;
    await this.plugins.save(plugin);
    return { status: 'revoked', plugin: name };
  }

  async setConsent(organizationId: string, name: string, dto: GrantConsentDto) {
    const plugin = await this.plugins.findOne({ where: { name } });
    if (!plugin) throw new NotFoundException('Plugin not found');

    let consent = await this.consents.findOne({
      where: { organizationId, pluginId: plugin.id },
    });
    if (!consent) {
      consent = this.consents.create({
        organizationId,
        pluginId: plugin.id,
        grantedCapabilities: [],
        enabled: true,
      });
    }
    if (dto.grantedCapabilities) consent.grantedCapabilities = dto.grantedCapabilities;
    if (dto.enabled !== undefined) consent.enabled = dto.enabled;
    await this.consents.save(consent);
    return {
      status: 'ok',
      plugin: name,
      grantedCapabilities: consent.grantedCapabilities,
      enabled: consent.enabled,
    };
  }

  async listConsents(organizationId: string) {
    const consents = await this.consents.find({
      where: { organizationId },
      relations: { plugin: true },
    });
    return consents.map((c) => ({
      plugin: c.plugin?.name,
      pluginId: c.pluginId,
      grantedCapabilities: c.grantedCapabilities,
      enabled: c.enabled,
    }));
  }

  private async resolveVersion(pluginName: string, version?: string): Promise<PluginVersion> {
    const plugin = await this.plugins.findOne({
      where: { name: pluginName },
      relations: { versions: true },
    });
    if (!plugin) throw new NotFoundException(`Plugin ${pluginName} not found`);
    if (plugin.status === PluginStatus.REVOKED) throw new ForbiddenException('Plugin is revoked');

    const items = plugin.versions ?? [];
    const resolved = version
      ? items.find((v) => v.version === version)
      : [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (!resolved) throw new NotFoundException('Version not found');
    resolved.plugin = plugin;
    return resolved;
  }

  async execute(organizationId: string, dto: ExecutePluginDto) {
    let codeToRun = dto.code;
    let signature: string | undefined;
    let pluginId = 'ephemeral';
    let pluginVersion = '0.0.0-direct';
    let requiredCapabilities: string[] = [];

    if (dto.pluginName) {
      const version = await this.resolveVersion(dto.pluginName, dto.version);
      codeToRun = version.code;
      signature = version.signature ?? undefined;
      pluginId = dto.pluginName;
      pluginVersion = version.version;
      requiredCapabilities = version.capabilities ?? [];
    }

    if (!codeToRun) {
      throw new BadRequestException('Code or a valid pluginName is required');
    }

    // Direct code is re-validated and re-signed every time — never trusted just for being inline.
    if (dto.code) {
      const admission = await this.admission.validatePlugin({
        name: 'ephemeral',
        code: codeToRun,
        sbom: dto.sbom ?? EMPTY_SBOM,
      });
      if (admission.status === 'rejected') {
        throw new ForbiddenException('Direct code rejected by admission policy');
      }
      signature = admission.signature;
    }

    // Consent enforcement: every declared capability must be granted by this tenant.
    let authorizedCapabilities: string[] = [];
    if (dto.pluginName && requiredCapabilities.length > 0) {
      const plugin = await this.plugins.findOne({ where: { name: dto.pluginName } });
      const consent = await this.consents.findOne({
        where: { organizationId, pluginId: plugin!.id },
      });
      if (!consent?.enabled) {
        throw new ForbiddenException('Extension is not enabled for this tenant');
      }
      const granted = consent?.grantedCapabilities ?? [];
      const missing = requiredCapabilities.filter((cap) => !granted.includes(cap));
      if (missing.length > 0) {
        throw new ForbiddenException({
          error: 'Tenant consent missing for required capabilities',
          missingCapabilities: missing,
        });
      }
      authorizedCapabilities = granted;
    }

    const result = await this.sandbox.run(codeToRun, signature, undefined, authorizedCapabilities);

    const meteringId = await this.metering.recordExecution({
      organizationId,
      pluginId,
      version: pluginVersion,
      executionTimeMs: result.executionTimeMs || 0,
      memoryBytes: result.metrics?.memoryBytes || 0,
      egressCount: result.metrics?.egressCount || 0,
      success: result.success,
    });

    return {
      status: result.success ? 'success' : 'execution_failed',
      logs: result.logs,
      error: result.error,
      executionTimeMs: result.executionTimeMs,
      meteringId,
    };
  }

  async reconciliation(organizationId: string): Promise<BillingReport> {
    const end = new Date();
    const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    return this.billing.generateReconciliationReport(organizationId, start, end);
  }
}
