import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, mergeMap } from 'rxjs';
import { EntitlementsPort } from '../saas/contracts/entitlements.contract';
import type { SaasFeatureKey } from '@virtex/shared/types';
import { serializedUsersIn } from './dto/user-response.dto';

/**
 * Stamps what the active company's plan includes onto every serialised user's organization.
 *
 * The client offered every screen to every plan because it had no way to know the plan: a company
 * on the entry plan saw AI, consolidation and the manager's report in its menu, and each page
 * answered 403 — one on every page, from the AI panel alone (IA-01, IA-02). The session is where
 * the client learns what it may offer (permissions, the company, its locale), and it is re-read on
 * every load and every company switch, so the plan's features travel with it: one source, in step
 * with the permissions it is combined with, and no second request to keep in sync.
 *
 * At the edge, like `LocaleInterceptor`'s `localeContext`, because twenty call sites serialise a
 * user and any one of them could forget. One lookup per company in the response, cached by the
 * company's billing generation (`EntitlementsPort.features`), so a plan change shows on the next
 * load. A failed lookup offers nothing gated: the API decides every request anyway, and offering a
 * door it would close is the defect this exists to remove.
 */
@Injectable()
export class PlanFeaturesInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PlanFeaturesInterceptor.name);

  constructor(private readonly entitlements: EntitlementsPort) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    return next.handle().pipe(mergeMap((body) => this.stamp(body)));
  }

  private async stamp(body: unknown): Promise<unknown> {
    const organizations = serializedUsersIn(body)
      .map((user) => user.organization)
      .filter((organization): organization is NonNullable<typeof organization> => Boolean(organization?.id));
    if (organizations.length === 0) return body;

    const ids = [...new Set(organizations.map((organization) => organization.id))];
    const features = new Map<string, SaasFeatureKey[]>(
      await Promise.all(
        ids.map(async (id): Promise<[string, SaasFeatureKey[]]> => [
          id,
          await this.entitlements.features(id).catch((error: Error) => {
            this.logger.warn(`Could not read the plan features of ${id}: ${error.message}`);
            return [];
          }),
        ]),
      ),
    );
    for (const organization of organizations) organization.features = features.get(organization.id) ?? [];
    return body;
  }
}
