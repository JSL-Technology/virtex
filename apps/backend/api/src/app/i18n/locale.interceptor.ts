import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor, Optional } from '@nestjs/common';
import { Observable, mergeMap, tap } from 'rxjs';
import { LanguageCode, RegionalFormat, serializeRequestNotices } from '@virtex/shared/types';
import { UserResponseDto, serializedUsersIn } from '../auth/dto/user-response.dto';
import { buildLocaleContext, currentLanguage, preferenceLanguage, setRequestLocale } from './request-locale';
import { I18nService } from './i18n.service';
import { TenantCurrencyPort } from './ports/tenant-currency.port';
import { NOTICES_HEADER, RequestNotice, collectNotices } from './request-notices';

/**
 * Three jobs, all of which have to happen between the guards and the response.
 *
 * **1. Upgrade the request's language once the user is known.** The middleware resolves the
 * language from `Accept-Language` before the guards run, because a failed sign-in must still be
 * answered in a language the reader can read. Once a guard has authenticated somebody, their
 * stored preference is the better answer and replaces it — the header is what their software
 * says, the preference is what they actually chose.
 *
 * **2. Stamp `localeContext` onto every serialised user.** There are more than twenty call sites
 * doing `plainToInstance(UserResponseDto, …)`, and adding the field at each of them would mean
 * twenty places that can forget. Matching on `instanceof UserResponseDto` is exact rather than
 * heuristic: `excludeExtraneousValues` produces real instances, so nothing else can be mistaken
 * for one.
 *
 * **3. Resolve `messageKey` into `message`.** The error path was translated by the exception
 * filter; the success path was not, so "El período contable ... ha sido cerrado exitosamente."
 * reached a Portuguese reader verbatim. A service returns the key and the parameters, the edge
 * turns them into prose — the same division of labour as the filter, and the reason no service
 * has to inject `I18nService` or thread a language argument through its signature just to say
 * "saved".
 *
 * **4. Send the request's notices.** What a service learned that the reader should know about a
 * request that succeeded (`request-notices.ts`) goes back in the `Virtex-Notices` header, as keys
 * with their parameters and the sentence in the reader's language beside them.
 *
 * The context has to be computed server-side because the browser cannot: it knows its own
 * timezone and locale, and an ERP needs the tenant's.
 */
/** What a tenant decides about formatting for every member: its books currency and its format. */
interface TenantDefaults {
  currency: string | null;
  format: RegionalFormat | null;
}

@Injectable()
export class LocaleInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LocaleInterceptor.name);

  constructor(
    private readonly i18n: I18nService,
    // Optional so the interceptor still works in a slice of the application without the
    // organizations module; the application always binds it.
    @Optional() private readonly tenantCurrency?: TenantCurrencyPort,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<{
      user?: { preferredLanguage?: string | null };
    }>();

    const preferred = preferenceLanguage(request?.user?.preferredLanguage);
    if (preferred) setRequestLocale({ language: preferred });

    const language = currentLanguage();
    const notices: RequestNotice[] = [];
    // Subscribed INSIDE the collecting context, so the handler — which runs on subscription, not on
    // `next.handle()` — and everything it awaits write to this request's list.
    return new Observable<unknown>((subscriber) =>
      collectNotices(notices, () =>
        next
          .handle()
          .pipe(
            mergeMap((body) => this.stamp(this.localize(body, language), language)),
            tap(() => this.sendNotices(context, notices, language)),
          )
          .subscribe(subscriber),
      ),
    );
  }

  /** The request's notices as a header: each one's key, parameters, code and sentence. */
  private sendNotices(context: ExecutionContext, notices: RequestNotice[], language: LanguageCode): void {
    // The reply is reached for only when there is something to say: most requests have nothing.
    if (notices.length === 0) return;
    const response = context.switchToHttp().getResponse<HttpReply | undefined>();
    if (!response) return;
    const payload = notices.map((notice) => ({
      code: notice.code,
      messageKey: notice.messageKey,
      messageParams: notice.messageParams ?? {},
      message: this.i18n.translate(notice.messageKey, language, notice.messageParams ?? {}),
    }));
    setResponseHeader(response, NOTICES_HEADER, serializeRequestNotices(payload));
  }

  /** Stamp the tenant's locale context on every serialised user in the response. */
  private async stamp(body: unknown, language: LanguageCode): Promise<unknown> {
    const users = serializedUsersIn(body);
    if (users.length === 0) return body;
    const defaults = await this.tenantDefaults(users);
    for (const user of users) this.withContext(user, language, defaults);
    return body;
  }

  /** One lookup per tenant in the response, never one per user: its currency and its format. */
  private async tenantDefaults(users: UserResponseDto[]): Promise<Map<string, TenantDefaults>> {
    const ids = [...new Set(users.map((u) => u.organization?.id).filter((id): id is string => !!id))];
    const entries = await Promise.all(
      ids.map(async (id): Promise<[string, TenantDefaults]> => {
        if (!this.tenantCurrency) return [id, { currency: null, format: null }];
        const [currency, format] = await Promise.all([
          this.tenantCurrency.functionalCurrency(id).catch((error: Error) => {
            // The session is still served; only its formatting falls back.
            this.logger.warn(`Could not read the functional currency of ${id}: ${error.message}`);
            return null;
          }),
          this.tenantCurrency.regionalFormat(id).catch((error: Error) => {
            this.logger.warn(`Could not read the regional format of ${id}: ${error.message}`);
            return null;
          }),
        ]);
        return [id, { currency, format }];
      }),
    );
    return new Map(entries);
  }

  /**
   * Replace `{ messageKey, messageParams }` with `{ message }`, in place, one level deep.
   *
   * One level matches where the field is actually written: the top of a command response
   * (`{ messageKey, period }`) and inside a single nested envelope (`{ data: { messageKey } }`).
   * `messageKey` is left alone when it does not name a real key, so an unknown key surfaces as
   * itself in the response rather than being silently deleted.
   */
  private localize(body: unknown, language: LanguageCode): unknown {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return body;

    const record = body as Record<string, unknown>;
    this.resolveMessage(record, language);
    for (const value of Object.values(record)) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        this.resolveMessage(value as Record<string, unknown>, language);
      }
    }
    return body;
  }

  private resolveMessage(record: Record<string, unknown>, language: LanguageCode): void {
    const key = record['messageKey'];
    if (typeof key !== 'string' || !this.i18n.has(key)) return;

    const params = record['messageParams'];
    record['message'] = this.i18n.translate(
      key,
      language,
      params !== null && typeof params === 'object' ? (params as Record<string, unknown>) : {},
    );
    delete record['messageKey'];
    delete record['messageParams'];
  }

  private withContext(
    user: UserResponseDto,
    language: LanguageCode,
    defaults: Map<string, TenantDefaults>,
  ): UserResponseDto {
    const organization = user.organization;
    const tenant = organization ? defaults.get(organization.id) : undefined;
    if (organization) {
      // The books currency, from the tenant's settings: the DTO declared `currency` and nothing
      // ever set it, so every tenant was formatted in the `USD` fallback (QA A-12).
      organization.currency = tenant?.currency ?? organization.currency ?? null;
    }
    user.localeContext = buildLocaleContext(language, organization, {
      company: tenant?.format ?? null,
      personal: user.regionalFormat ?? null,
    });
    return user;
  }
}

/**
 * The reply of either HTTP adapter: Fastify's (`header`, `sent`) — what the application runs on —
 * or Express's (`setHeader`, `headersSent`), which a slice of the application under test may use.
 */
interface HttpReply {
  header?: (name: string, value: string) => unknown;
  sent?: boolean;
  setHeader?: (name: string, value: string) => unknown;
  headersSent?: boolean;
}

function setResponseHeader(reply: HttpReply, name: string, value: string): void {
  if (reply.sent || reply.headersSent) return;
  if (typeof reply.header === 'function') reply.header(name, value);
  else if (typeof reply.setHeader === 'function') reply.setHeader(name, value);
}
