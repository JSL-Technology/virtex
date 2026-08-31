import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { LanguageCode } from '@virteex/shared/types';
import { UserResponseDto } from '../auth/dto/user-response.dto';
import { buildLocaleContext, currentLanguage, preferenceLanguage, setRequestLocale } from './request-locale';

/**
 * Two jobs, both of which have to happen between the guards and the response.
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
 * The context has to be computed server-side because the browser cannot: it knows its own
 * timezone and locale, and an ERP needs the tenant's.
 */
@Injectable()
export class LocaleInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<{
      user?: { preferredLanguage?: string | null };
    }>();

    const preferred = preferenceLanguage(request?.user?.preferredLanguage);
    if (preferred) setRequestLocale({ language: preferred });

    const language = currentLanguage();
    return next.handle().pipe(map((body) => this.stamp(body, language)));
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

  private withContext(user: UserResponseDto, language: LanguageCode): UserResponseDto {
    user.localeContext = buildLocaleContext(language, user.organization);
    return user;
  }
}
