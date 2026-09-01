import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { LanguageCode } from '@virteex/shared/types';
import { UserResponseDto } from '../auth/dto/user-response.dto';
import { buildLocaleContext, currentLanguage, preferenceLanguage, setRequestLocale } from './request-locale';
import { I18nService } from './i18n.service';

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
 * The context has to be computed server-side because the browser cannot: it knows its own
 * timezone and locale, and an ERP needs the tenant's.
 */
@Injectable()
export class LocaleInterceptor implements NestInterceptor {
  constructor(private readonly i18n: I18nService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<{
      user?: { preferredLanguage?: string | null };
    }>();

    const preferred = preferenceLanguage(request?.user?.preferredLanguage);
    if (preferred) setRequestLocale({ language: preferred });

    const language = currentLanguage();
    return next.handle().pipe(map((body) => this.stamp(this.localize(body, language), language)));
  }

  /**
   * Walk one level of the response for serialised users.
   *
   * One level is enough for every shape the API actually returns — the DTO itself, `{ user }`,
   * and `{ data: User[] }` — and a full deep walk over an arbitrary payload would be a cost paid
   * on every request to catch a case that does not exist.
   */
  private stamp(body: unknown, language: LanguageCode): unknown {
    if (body === null || typeof body !== 'object') return body;

    if (body instanceof UserResponseDto) return this.withContext(body, language);

    if (Array.isArray(body)) {
      for (const item of body) if (item instanceof UserResponseDto) this.withContext(item, language);
      return body;
    }

    for (const value of Object.values(body as Record<string, unknown>)) {
      if (value instanceof UserResponseDto) {
        this.withContext(value, language);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (item instanceof UserResponseDto) this.withContext(item, language);
        }
      }
    }
    return body;
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

  private withContext(user: UserResponseDto, language: LanguageCode): UserResponseDto {
    user.localeContext = buildLocaleContext(language, user.organization);
    return user;
  }
}
