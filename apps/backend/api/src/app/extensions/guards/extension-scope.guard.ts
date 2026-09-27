import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  EXTENSION_ALLOWED_METHODS,
  EXTENSION_REQUEST_HEADER,
  extensionMayRead,
  normalizeExtensionApiPath,
} from '@virteex/shared/util-auth';
import { AuthenticatedUser } from '../../security/principal';
import { ForbiddenError } from '../../i18n/localized.exception';
import { runAsTenantJob } from '../../shared/tenancy/tenant-job';
import { TenantConsent } from '../entities/tenant-consent.entity';
import { PluginStatus } from '../entities/plugin.entity';

interface ExtensionRequest {
  method?: string;
  url?: string;
  user?: AuthenticatedUser;
  headers?: Record<string, string | string[] | undefined>;
}

/**
 * The API-side half of an extension's capability scope.
 *
 * An extension's UI runs in a sandboxed iframe with an opaque origin, so it cannot call the API
 * itself: every request it makes goes through `ExtensionHostComponent`, which stamps it with the
 * `x-virtex-extension` header. The host checks the path against the capabilities the tenant
 * granted — and until now that check was the only one. It compared the path as written while the
 * browser fetched it normalised, so `/sales/%2e%2e/users` passed as a sales read and returned the
 * member list.
 *
 * Here the same rule (`@virteex/shared/util-auth`, one definition for both sides) is applied to
 * the request as it actually arrived, against the capabilities the tenant granted the named
 * extension in the database — not against what the browser claims. A request that names an
 * extension the tenant has not enabled, or that reaches outside what it was granted, is refused.
 *
 * Requests without the header are not extension traffic and pass through untouched; the header
 * can only narrow what a session may do, never widen it.
 */
@Injectable()
export class ExtensionScopeGuard implements CanActivate {
  private readonly logger = new Logger(ExtensionScopeGuard.name);

  constructor(
    @InjectRepository(TenantConsent)
    private readonly consents: Repository<TenantConsent>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<ExtensionRequest>();

    const raw = request.headers?.[EXTENSION_REQUEST_HEADER];
    const extensionName = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!extensionName) return true;

    const deny = (reason: string): never => {
      this.logger.warn(
        {
          event: 'extension_scope_denied',
          reason,
          extension: extensionName.slice(0, 80),
          userId: request.user?.id,
          organizationId: request.user?.organizationId,
        },
        '[SECURITY] Extension request outside its granted scope',
      );
      throw new ForbiddenError('extensions.request_outside_granted_scope');
    };

    if (!request.user?.organizationId) return deny('unauthenticated');
    if (!EXTENSION_ALLOWED_METHODS.includes(String(request.method ?? '').toUpperCase())) {
      return deny('method');
    }

    const path = this.pathWithinApi(request.url ?? '');
    const normalized = path === null ? null : normalizeExtensionApiPath(path);
    if (!normalized) return deny('path_not_canonical');

    const organizationId = request.user.organizationId;
    const consent = await runAsTenantJob(this.dataSource, organizationId, () =>
      this.consents
        .createQueryBuilder('consent')
        .innerJoinAndSelect('consent.plugin', 'plugin')
        .where('consent.organizationId = :organizationId', { organizationId })
        .andWhere('plugin.name = :name', { name: extensionName })
        .andWhere('consent.enabled = true')
        .getOne(),
    );
    if (!consent || consent.plugin?.status === PluginStatus.REVOKED) return deny('not_enabled');

    if (!extensionMayRead(normalized.pathname, consent.grantedCapabilities ?? [])) {
      return deny('outside_capabilities');
    }
    return true;
  }

  /**
   * The request path relative to the API prefix, exactly as received (query included), or null
   * when it is not under the prefix at all.
   */
  private pathWithinApi(url: string): string | null {
    const prefix = `/${this.config.get<string>('API_PREFIX', 'api/v1').replace(/^\/|\/$/g, '')}`;
    if (url !== prefix && !url.startsWith(`${prefix}/`) && !url.startsWith(`${prefix}?`)) {
      return null;
    }
    const rest = url.slice(prefix.length);
    return rest.startsWith('/') ? rest : `/${rest}`;
  }
}
