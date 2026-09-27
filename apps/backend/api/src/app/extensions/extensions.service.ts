import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
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
import { BadRequestError, ForbiddenError, NotFoundError } from '../i18n/localized.exception';
import { PluginSummaryDto } from './dto/plugin-catalogue.dto';
import { PLATFORM_PERMISSIONS, hasPlatformPermission } from '../security/platform-permissions';

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

  /**
   * How a plugin is described to a tenant, without handing over its source.
   *
   * `getByName` used to return the entity as the repository loaded it, versions included — so
   * `code` (what runs in the isolate), `uiEntry` (what runs in a browser) and `signature` (the
   * platform's attestation) all travelled to anyone with `extensions:view`, which the `'*'` of
   * every tenant ADMINISTRATOR satisfies. Every vendor's proprietary source, readable by every
   * customer, and the reconnaissance step for publishing a look-alike version.
   */
  private toSummary(plugin: Plugin, viewerOrganizationId: string, withVersions: boolean): PluginSummaryDto {
    const publisher: PluginSummaryDto['publisher'] = !plugin.publisherOrganizationId
      ? 'platform'
      : plugin.publisherOrganizationId === viewerOrganizationId
        ? 'organization'
        : 'third_party';

    const summary: PluginSummaryDto = {
      id: plugin.id,
      name: plugin.name,
      status: plugin.status,
      description: plugin.description,
      author: plugin.author,
      publisher,
      versionCount: plugin.versions?.length ?? 0,
    };

    if (withVersions) {
      summary.versions = (plugin.versions ?? [])
        .slice()
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((version) => ({
          id: version.id,
          version: version.version,
          channel: version.channel,
          createdAt: version.createdAt,
          capabilities: version.capabilities,
          contributes: version.contributes,
          // Whether it has a UI and whether it is signed, never the UI or the signature.
          hasUi: Boolean(version.uiEntry),
          signed: Boolean(version.signature),
        }));
    }

    return summary;
  }

  async list(viewerOrganizationId: string): Promise<PluginSummaryDto[]> {
    const plugins = await this.plugins.find({ relations: { versions: true } });
    return plugins.map((plugin) => this.toSummary(plugin, viewerOrganizationId, false));
  }

  async getByName(name: string, viewerOrganizationId: string): Promise<PluginSummaryDto> {
    const plugin = await this.plugins.findOne({ where: { name }, relations: { versions: true } });
    if (!plugin) throw new NotFoundError('extensions.plugin_not_found');
    return this.toSummary(plugin, viewerOrganizationId, true);
  }

  /**
   * Publish an extension, or a new version of one.
   *
   * ## Two checks that were not here
   *
   * **Who may publish at all.** The route now requires `platform:extensions:publish`, a permission
   * no tenant role can carry (`RolesService.assertAssignablePermissions`). It used to require
   * `extensions:manage`, which the `'*'` of every tenant's ADMINISTRATOR role satisfies — so any
   * customer could write to the catalogue every other customer reads.
   *
   * **Who may publish under THIS NAME.** The lookup is by name, and if a plugin existed the old
   * code simply appended a version to it. A name is an identity: appending to somebody else's
   * plugin is publishing as them, and since the newest version is what executes, it is also
   * publishing INTO every tenant that installed it. `publisherOrganizationId` makes the name
   * ownable and this check enforces it.
   *
   * A new version does not take effect anywhere on its own. Tenants pin the version they
   * consented to, so this records a proposal; `setConsent` is where a tenant accepts it.
   */
  async register(dto: RegisterPluginDto, publisherOrganizationId: string | null) {
    let plugin = await this.plugins.findOne({ where: { name: dto.name } });

    if (plugin) {
      // Publishing under a name that is already taken is only allowed for its owner. A platform
      // principal publishing a first-party extension (publisherOrganizationId === null) owns the
      // rows that have no tenant publisher.
      if ((plugin.publisherOrganizationId ?? null) !== publisherOrganizationId) {
        this.logger.warn(
          {
            event: 'plugin_publish_name_conflict',
            plugin: dto.name,
            attemptedBy: publisherOrganizationId ?? 'platform',
          },
          '[SECURITY] Refused to publish under an extension name owned by somebody else',
        );
        throw new ForbiddenError('extensions.name_belongs_another_publisher');
      }
    } else {
      plugin = this.plugins.create({
        name: dto.name,
        description: dto.description ?? null,
        author: dto.author ?? null,
        status: PluginStatus.ACTIVE,
        publisherOrganizationId,
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
      uiEntry: dto.uiEntry ?? null,
      contributes: dto.contributes ?? null,
      channel: PluginChannel.STABLE,
    });
    await this.versions.save(version);

    // Every tenant running this extension is OFFERED the new version. None of them is moved onto
    // it: `pendingVersionId` is a proposal, `consentedVersionId` is what executes. Before version
    // pinning, publishing a version WAS deploying it to every tenant that had ever installed the
    // extension, under the capabilities they had granted the version they actually reviewed.
    const offered = await this.consents.update(
      { pluginId: plugin.id },
      { pendingVersionId: version.id },
    );

    this.logger.log(
      {
        event: 'plugin_version_published',
        plugin: dto.name,
        version: dto.version,
        publisher: publisherOrganizationId ?? 'platform',
        tenantsOffered: offered.affected ?? 0,
      },
      'Extension version published and offered to the tenants that have it installed',
    );

    return {
      status: 'success',
      admission: admission.status,
      message: `Plugin ${dto.name} v${dto.version} registered.`,
      id: plugin.id,
      versionId: version.id,
      tenantsOffered: offered.affected ?? 0,
    };
  }

  /**
   * Withdraw an extension from every tenant at once.
   *
   * Platform-wide by nature, which is exactly why it now requires `platform:extensions:revoke`.
   * With `extensions:manage` this was a denial-of-service any customer could aim at any extension
   * in the marketplace.
   */
  async revoke(name: string) {
    const plugin = await this.plugins.findOne({ where: { name } });
    if (!plugin) throw new NotFoundError('extensions.plugin_not_found');
    plugin.status = PluginStatus.REVOKED;
    await this.plugins.save(plugin);
    this.logger.warn(
      { event: 'plugin_revoked', plugin: name },
      'Extension revoked for every tenant',
    );
    return { status: 'revoked', plugin: name };
  }

  async setConsent(organizationId: string, name: string, dto: GrantConsentDto) {
    const plugin = await this.plugins.findOne({ where: { name } });
    if (!plugin) throw new NotFoundError('extensions.plugin_not_found');

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

    // Which version this tenant is agreeing to run.
    //
    // Consent used to be to a NAME, and execution resolved "the newest version" — so a version
    // published afterwards inherited the consent AND the capabilities granted to the version the
    // tenant had actually reviewed. Pinning is what makes a release a proposal instead of a
    // deployment into somebody else's tenant.
    if (dto.versionId) {
      const target = await this.versions.findOne({
        where: { id: dto.versionId, pluginId: plugin.id },
      });
      // Scoped to this plugin on purpose: a version id from another extension must not become
      // what this consent points at.
      if (!target) throw new NotFoundError('extensions.version_not_found');
      consent.consentedVersionId = target.id;
      if (consent.pendingVersionId === target.id) consent.pendingVersionId = null;
    } else if (!consent.consentedVersionId) {
      // First consent, or a row written before pinning existed: pin what is current now, so the
      // tenant keeps running what it runs today and the next publish becomes a proposal.
      const latest = await this.latestVersion(plugin.id);
      consent.consentedVersionId = latest?.id ?? null;
    }

    await this.consents.save(consent);
    return {
      status: 'ok',
      plugin: name,
      grantedCapabilities: consent.grantedCapabilities,
      enabled: consent.enabled,
      consentedVersionId: consent.consentedVersionId,
      pendingVersionId: consent.pendingVersionId,
    };
  }

  /** The most recently published version of a plugin, or null if it has none. */
  private async latestVersion(pluginId: string): Promise<PluginVersion | null> {
    return this.versions.findOne({ where: { pluginId }, order: { createdAt: 'DESC' } });
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
      // Surfaced so a tenant can see what it is running and what is waiting for its decision.
      consentedVersionId: c.consentedVersionId,
      pendingVersionId: c.pendingVersionId,
    }));
  }

  /**
   * The version THIS TENANT runs — not "the newest one".
   *
   * The old rule was `sort by createdAt desc, take the first`, which meant whoever could add a
   * version to the catalogue decided what executed in every tenant that had the extension
   * installed, under the capabilities those tenants had granted to a version they had reviewed and
   * this one had merely replaced.
   *
   * ## Why a pinned `version` is no longer honoured on its own
   *
   * `if (version) resolved = items.find(...)` came FIRST, before the consent row was even read.
   * The tenant consented to version X and `{"pluginName":"...","version":"Y"}` ran Y. The
   * capability check further down still applied, so the blast radius was bounded by what the
   * tenant had already granted — but "this organization approved THIS code" stopped being true,
   * and that sentence is the entire purpose of `consentedVersionId`.
   *
   * A pin is now a filter over the consented choice rather than a replacement for it: it is
   * accepted only when it names the very version the tenant consented to, which keeps the
   * legitimate use (a client that pins what it was told to run, so a catalogue update cannot
   * change it mid-flight) and removes the bypass.
   *
   * The order of preference is therefore:
   *  1. the version this tenant consented to — and if the caller pinned one, it must be that one;
   *  2. the newest, ONLY when there is no consent row at all, which is the case for a plugin that
   *     declares no capabilities and therefore needs none.
   */
  private async resolveVersion(
    pluginName: string,
    organizationId: string,
    version?: string,
  ): Promise<PluginVersion> {
    const plugin = await this.plugins.findOne({
      where: { name: pluginName },
      relations: { versions: true },
    });
    if (!plugin) throw new NotFoundError('extensions.named_plugin_not_found', { pluginName });
    if (plugin.status === PluginStatus.REVOKED) throw new ForbiddenError('extensions.plugin_revoked');

    const items = plugin.versions ?? [];
    const newest = [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

    const consent = await this.consents.findOne({
      where: { organizationId, pluginId: plugin.id },
    });

    const consented = consent?.consentedVersionId
      ? items.find((v) => v.id === consent.consentedVersionId)
      : undefined;

    const resolved = consented ?? newest;

    if (!resolved) throw new NotFoundError('extensions.version_not_found');

    // A consent ROW that exists but carries no pin is the legacy shape the migration left
    // behind: "no consent at all" and "consented, but never pinned" both read as `undefined`
    // above and both fell through to `newest`, which is exactly the automatic-upgrade behaviour
    // `consentedVersionId` exists to remove. Only the first of those two should keep floating —
    // a plugin with no capabilities needs no pin. The second is pinned NOW, to the version
    // resolved today, so a version published tomorrow does not silently become "consented" the
    // next time this tenant's code runs.
    if (consent && !consent.consentedVersionId) {
      consent.consentedVersionId = resolved.id;
      await this.consents.save(consent);
    }

    // A pin that disagrees with the consented version is refused rather than obeyed.
    if (version && resolved.version !== version) {
      this.logger.warn(
        {
          event: 'plugin_version_pin_refused',
          organizationId,
          pluginName,
          requested: version,
          consented: resolved.version,
        },
        '[SECURITY] Refused a pinned extension version the tenant has not consented to',
      );
      throw new ForbiddenError('extensions.version_not_consented', { version });
    }

    resolved.plugin = plugin;
    return resolved;
  }

  async execute(
    organizationId: string,
    dto: ExecutePluginDto,
    callerPermissions: readonly string[] = [],
  ) {
    // Inline code is a platform capability, not a tenant one.
    //
    // `dto.code` is an arbitrary string that this process compiles and runs. The isolate contains
    // it, and that containment is real — but it was the only thing standing between every tenant
    // administrator and the API process, reachable with `extensions:execute`, which `'*'` grants.
    // A development and incident-response tool should not be one isolate escape away from every
    // customer.
    if (dto.code && !hasPlatformPermission(callerPermissions, PLATFORM_PERMISSIONS.EXTENSIONS_RUN_ARBITRARY_CODE)) {
      this.logger.warn(
        { event: 'inline_code_denied', organizationId },
        '[SECURITY] Inline extension code refused: caller holds no platform run permission',
      );
      throw new ForbiddenError('extensions.inline_code_requires_platform_permission');
    }

    let codeToRun = dto.code;
    let signature: string | undefined;
    let pluginId = 'ephemeral';
    let pluginVersion = '0.0.0-direct';
    let requiredCapabilities: string[] = [];

    if (dto.pluginName) {
      const version = await this.resolveVersion(dto.pluginName, organizationId, dto.version);
      codeToRun = version.code;
      signature = version.signature ?? undefined;
      pluginId = dto.pluginName;
      pluginVersion = version.version;
      requiredCapabilities = version.capabilities ?? [];
    }

    if (!codeToRun) {
      throw new BadRequestError('extensions.code_or_valid_pluginname_required');
    }

    // Direct code is re-validated and re-signed every time — never trusted just for being inline.
    //
    // It also requires `platform:extensions:run_arbitrary_code`, enforced on the route. The
    // admission pipeline is not a trust boundary for code somebody chose: its heuristic scan is
    // six regular expressions (`eval\(` does not see `globalThis['ev'+'al']`), so what actually
    // contains this is the V8 isolate. That is a real defence, and it is the wrong thing to have
    // standing between every tenant administrator and the server process — one isolate escape
    // away from arbitrary execution, reachable with a permission every customer holds.
    if (dto.code) {
      const admission = await this.admission.validatePlugin({
        name: 'ephemeral',
        code: codeToRun,
        sbom: dto.sbom ?? EMPTY_SBOM,
      });
      if (admission.status === 'rejected') {
        throw new ForbiddenError('extensions.direct_code_rejected_by_admission_policy');
      }
      signature = admission.signature;
    }

    // Consent enforcement.
    //
    // The guard used to be `if (dto.pluginName && requiredCapabilities.length > 0)`, so an
    // extension declaring `capabilities: []` skipped the block entirely — including the
    // `consent?.enabled` check. Any tenant could therefore run any extension in the catalogue
    // without having installed it. What such an extension can do is limited to `log`, so the
    // blast radius was small; but "is this extension enabled for this tenant" is not a question
    // whose answer should depend on how many capabilities it happens to declare.
    //
    // Installation is now checked whenever a catalogue extension is named. The capability
    // comparison stays inside its own condition, because an extension needing none has nothing
    // to compare.
    let authorizedCapabilities: string[] = [];
    if (dto.pluginName) {
      const plugin = await this.plugins.findOne({ where: { name: dto.pluginName } });
      const consent = await this.consents.findOne({
        where: { organizationId, pluginId: plugin!.id },
      });
      if (!consent?.enabled) {
        throw new ForbiddenError('extensions.extension_not_enabled_for_this_tenant');
      }

      const granted = consent.grantedCapabilities ?? [];
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

  /**
   * The UI extensions this tenant has enabled — what the client-side extension host mounts. For
   * each enabled, non-revoked extension that ships a UI, returns its latest UI-bearing version plus
   * the capabilities the tenant granted (which the host bridge enforces at runtime).
   */
  async runtime(organizationId: string) {
    const consents = await this.consents.find({
      where: { organizationId, enabled: true },
      relations: { plugin: true },
    });

    const out: Array<{
      name: string;
      version: string;
      uiEntry: string;
      contributes: unknown;
      grantedCapabilities: string[];
    }> = [];

    for (const consent of consents) {
      if (!consent.plugin || consent.plugin.status === PluginStatus.REVOKED) continue;

      // The UI this tenant CONSENTED to, not the newest one in the catalogue.
      //
      // This used to take `versions.find(v => !!v.uiEntry)` over a `createdAt DESC` list, so the
      // most recently published UI was mounted in every tenant that had the extension enabled —
      // `new Function(code)(virtex, root)` in the browser of whoever had the screen open, with the
      // capabilities that tenant had granted. Publishing a version WAS shipping client-side code
      // into other people's sessions.
      const uiVersion = consent.consentedVersionId
        ? await this.versions.findOne({
            where: { id: consent.consentedVersionId, pluginId: consent.pluginId },
          })
        : await this.versions.findOne({
            where: { pluginId: consent.pluginId },
            order: { createdAt: 'DESC' },
          });

      if (!uiVersion || !uiVersion.uiEntry) continue;
      out.push({
        name: consent.plugin.name,
        version: uiVersion.version,
        uiEntry: uiVersion.uiEntry,
        contributes: uiVersion.contributes,
        grantedCapabilities: consent.grantedCapabilities ?? [],
      });
    }
    return out;
  }

  async reconciliation(organizationId: string): Promise<BillingReport> {
    const end = new Date();
    const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    return this.billing.generateReconciliationReport(organizationId, start, end);
  }
}
