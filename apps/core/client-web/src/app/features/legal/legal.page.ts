import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { catchError, map, of } from 'rxjs';
import { LEGAL_DOCUMENTS, LegalDocumentEdition, LegalDocumentId } from '@virteex/shared/types';
import { AuthLayoutComponent } from '../auth/components/auth-layout/auth-layout.component';
import { LanguageService } from '../../core/services/language';
import { environment } from '../../../environments/environment';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';

/** Which public page this is. The three documents plus the contact page. */
export type LegalPageId = LegalDocumentId | 'contact';

/** How many numbered sections each document has in the catalogue (`legal.<doc>.s<n>.title|body`). */
const SECTION_COUNT: Readonly<Record<LegalDocumentId, number>> = { terms: 10, privacy: 10, security: 6 };

/** Topics the contact form offers, in the order shown. */
const CONTACT_TOPICS = ['support', 'billing', 'privacy', 'security', 'sales'] as const;

interface LegalInfoResponse {
  supportEmail: string;
  documents: Record<LegalDocumentId, LegalDocumentEdition>;
}

/**
 * Terms, Privacy, Security and Contact (QA C-08).
 *
 * The footer of every public screen and the signup's acceptance box linked to four pages that did
 * not exist: `/terms` and the rest fell through to the sign-in page. People were asked to accept
 * documents they could not read, and the only help channel led nowhere.
 *
 * One component for the four because they are one kind of page: a title, the edition in force
 * with its effective date, numbered sections, and a way to ask a question. The text lives in the
 * catalogue under `legal.*`, so each page is in the reader's language; the edition comes from
 * `LEGAL_DOCUMENTS`, the same constant the signup sends and the server checks, so the version a
 * person reads is the version recorded when they accept.
 *
 * Mounted under the language prefix (`/es/terms`), like every public page, and reachable signed in
 * or not. The support address is the server's (`SUPPORT_EMAIL`), not a literal here.
 */
@Component({
  selector: 'app-legal-page',
  standalone: true,
  imports: [AuthLayoutComponent, RouterLink, TranslateModule, FormsModule, ...VX_FORM_A11Y],
  templateUrl: './legal.page.html',
  styleUrls: ['./legal.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LegalPage {
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);
  private readonly translate = inject(TranslateService);
  readonly language = inject(LanguageService);

  readonly page = toSignal(
    this.route.data.pipe(map((data) => (data['legalPage'] as LegalPageId) ?? 'terms')),
    { initialValue: (this.route.snapshot.data['legalPage'] as LegalPageId) ?? 'terms' },
  );

  /** The other pages, for the navigation strip. */
  readonly pages: readonly LegalPageId[] = ['terms', 'privacy', 'security', 'contact'];

  readonly isDocument = computed(() => this.page() !== 'contact');

  readonly edition = computed<LegalDocumentEdition | null>(() => {
    const page = this.page();
    return page === 'contact' ? null : LEGAL_DOCUMENTS[page];
  });

  /** The effective date, written the way the reader's locale writes dates. */
  readonly effectiveDate = computed(() => {
    const edition = this.edition();
    if (!edition) return '';
    const [y, m, d] = edition.effectiveDate.split('-').map(Number);
    return new Intl.DateTimeFormat(this.language.currentLocale(), { dateStyle: 'long', timeZone: 'UTC' }).format(
      new Date(Date.UTC(y, m - 1, d)),
    );
  });

  readonly sections = computed(() => {
    const page = this.page();
    if (page === 'contact') return [];
    return Array.from({ length: SECTION_COUNT[page] }, (_, i) => `legal.${page}.s${i + 1}`);
  });

  /** Where customers write. The server's answer; never empty, because the server falls back too. */
  readonly supportEmail = toSignal(
    this.http.get<LegalInfoResponse>(`${environment.apiUrl}/legal/info`).pipe(
      map((info) => info.supportEmail),
      catchError(() => of(null)),
    ),
    { initialValue: null },
  );

  readonly appName = computed(() => this.translate.instant('app_title'));

  // ── Contact form ─────────────────────────────────────────────────────────────
  readonly topics = CONTACT_TOPICS;
  name = '';
  replyTo = '';
  topic: (typeof CONTACT_TOPICS)[number] | '' = '';
  message = '';
  readonly formError = signal(false);
  readonly copied = signal(false);

  /**
   * Compose the message in the reader's own email app.
   *
   * A `mailto:` and not a server-side form on purpose: the reply has to come from a real inbox the
   * person controls, the conversation then lives where they read their email, and the product does
   * not become an unauthenticated relay that sends mail to a fixed address on anybody's behalf.
   */
  composeEmail(): void {
    const to = this.supportEmail();
    if (!to || !this.topic || !this.message.trim()) {
      this.formError.set(true);
      return;
    }
    this.formError.set(false);
    const subject = `[${this.appName()}] ${this.translate.instant(`legal.contact.topics.${this.topic}`)}`;
    const from =
      this.name.trim() || this.replyTo.trim()
        ? `\n\n—\n${this.translate.instant('legal.contact.mail_from', { name: this.name.trim(), email: this.replyTo.trim() })}`
        : '';
    const href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(this.message.trim() + from)}`;
    window.location.href = href;
  }

  async copyEmail(): Promise<void> {
    const email = this.supportEmail();
    if (!email) return;
    try {
      await navigator.clipboard.writeText(email);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Clipboard denied: the address is on screen and selectable, which is enough.
    }
  }
}
