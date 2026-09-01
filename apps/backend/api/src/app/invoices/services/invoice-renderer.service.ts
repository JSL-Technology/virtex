import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as handlebars from 'handlebars';
import * as puppeteer from 'puppeteer';
import * as QRCode from 'qrcode';
import { Invoice, InvoiceType } from '../entities/invoice.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { EcfSubmission } from '../../einvoicing/entities/ecf-submission.entity';
import { minorUnitsFor } from '../../currencies/currency-catalogue';
import { InternalServerError } from '../../i18n/localized.exception';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_DIRECTION,
  LanguageCode,
  isLanguageCode,
  matchLanguage,
  resolveLocale,
} from '@virteex/shared/types';
import { I18nService } from '../../i18n/i18n.service';
import { findCountryProfile } from '../../localization/fiscal/country-profiles';
import { languageOfCountry } from '../../localization/fiscal/country-language';

/** Everything the template needs, resolved before rendering. */
export interface InvoiceRenderContext {
  invoice: Invoice;
  organization: Organization;
  submission?: EcfSubmission | null;
  /**
   * Overrides the language and locale the document is written in.
   *
   * Left unset for the ordinary case: a document follows its RECIPIENT, and the renderer works
   * that out from the customer's stated preference, then their country, then the tenant's books
   * language. A Dominican company invoicing a Brazilian customer sends Portuguese. Set this only
   * when the caller genuinely knows better — a preview the issuer asked to see in their own
   * language, for instance.
   */
  locale?: string;
  language?: LanguageCode;
}

/**
 * Renders the legally required printed representation of a fiscal document.
 *
 * ## Why this is its own service
 *
 * The previous implementation lived inside `InvoicesService` and had two separate problems.
 *
 * **It was not compliant.** The template printed an internal number, dates, parties, lines and
 * totals — and none of the elements the Dominican norm requires on the *representación impresa* of
 * an e-CF: the e-NCF itself, the six-character security code, the date and time of the digital
 * signature, and the QR code that lets anyone verify the document against the DGII. It also
 * hardcoded a `$` sign and formatted every amount with `en-US`, so an invoice in Dominican pesos
 * printed as dollars.
 *
 * **It could not survive load.** `puppeteer.launch()` ran per request, with no pooling, no
 * concurrency limit, and no `finally` — so a failure inside `page.pdf()` leaked a Chromium process
 * for the life of the server. On a route that carried no permission check at all, a handful of
 * concurrent downloads exhausted memory.
 *
 * One browser is launched lazily and reused; pages are opened and closed per document and always
 * released. The QR is rendered to a data URI at build time so the page needs no network access.
 */
@Injectable()
export class InvoiceRendererService implements OnModuleDestroy {
  private readonly logger = new Logger(InvoiceRendererService.name);
  private template?: HandlebarsTemplateDelegate;
  private browserPromise?: Promise<puppeteer.Browser>;
  /** Concurrency gate: rendering is memory-hungry and unbounded parallelism is what kills the box. */
  private readonly queue: Array<() => void> = [];
  private active = 0;
  private static readonly MAX_CONCURRENT_RENDERS = 4;

  constructor(private readonly i18n: I18nService) {}

  async renderPdf(context: InvoiceRenderContext): Promise<Buffer> {
    const html = await this.renderHtml(context);
    return this.withSlot(async () => {
      const browser = await this.browser();
      const page = await browser.newPage();
      try {
        await page.setContent(html, { waitUntil: 'load' });
        const pdf = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' },
        });
        return Buffer.from(pdf);
      } finally {
        await page.close().catch(() => undefined);
      }
    });
  }

  /** The same document as HTML — used by the PDF path and served directly for on-screen printing. */
  async renderHtml(context: InvoiceRenderContext): Promise<string> {
    const template = this.compiledTemplate();
    const { invoice, organization, submission } = context;

    const qrDataUri = submission?.qrUrl ? await this.qrDataUri(submission.qrUrl) : null;
    const decimals = minorUnitsFor(invoice.currencyCode);

    /*
     * A fiscal document is written in the language of its RECIPIENT.
     *
     * Not the issuer's, and not the language of whoever pressed the button. `'es-DO'` as a fixed
     * default is one market's format shown to nineteen: it prints `15/01/2026` to a reader in
     * Ohio and groups an Argentine figure with the wrong separator. The FORMAT still follows the
     * issuer's country, because the amounts are in the issuer's books and the tax authority reads
     * them — only the WORDS follow the reader.
     */
    const language =
      context.language ??
      matchLanguage(invoice.customer?.preferredLanguage) ??
      languageOfCountry(invoice.customer?.country) ??
      matchLanguage(organization.booksLanguage) ??
      DEFAULT_LANGUAGE;

    const issuerCountry = (organization.country ?? 'DO').toUpperCase();
    const locale = context.locale ?? resolveLocale(language, issuerCountry);
    const profile = findCountryProfile(issuerCountry);

    const format = (value: number): string =>
      new Intl.NumberFormat(locale, {
        style: 'decimal',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(Number(value) || 0);

    return template({
      organization,
      invoice,
      lines: (invoice.lineItems ?? [])
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((line, index) => ({
          number: index + 1,
          description: line.description,
          quantity: trimTrailingZeros(line.quantity),
          unitOfMeasure: line.unitOfMeasure ?? '',
          price: format(line.price),
          discount: line.discountAmount > 0 ? format(line.discountAmount) : null,
          taxRate: line.taxRate > 0 ? `${(line.taxRate * 100).toFixed(2).replace(/\.00$/, '')}%` : 'E',
          amount: format(line.lineSubtotal),
        })),
      language,
      // The country's own name for its tax identifier. The template carried the Dominican "RNC:"
      // for every market, so a Mexican tenant's document showed its RFC under a Dominican heading.
      taxIdLabel: profile?.taxId.label ?? 'ID',
      customerTaxIdLabel: profile?.individualDocument?.label ?? profile?.taxId.label ?? 'ID',
      title: this.i18n.translate(this.documentTitleKey(invoice), language),
      currencyCode: invoice.currencyCode,
      issueDate: formatDate(invoice.issueDate, locale),
      dueDate: formatDate(invoice.dueDate, locale),
      totals: {
        subtotal: format(invoice.subtotal),
        discount: invoice.discountTotal > 0 ? format(invoice.discountTotal) : null,
        taxed: format(invoice.taxedTotal),
        exempt: invoice.exemptTotal > 0 ? format(invoice.exemptTotal) : null,
        tax: format(invoice.tax),
        serviceCharge: invoice.serviceCharge > 0 ? format(invoice.serviceCharge) : null,
        taxWithheld: invoice.taxWithheld > 0 ? format(invoice.taxWithheld) : null,
        incomeTaxWithheld:
          invoice.incomeTaxWithheld > 0 ? format(invoice.incomeTaxWithheld) : null,
        total: format(invoice.total),
        netReceivable:
          invoice.netReceivable !== invoice.total ? format(invoice.netReceivable) : null,
      },
      fiscal: {
        ncf: invoice.ncfNumber,
        documentType: invoice.fiscalDocumentType,
        validUntil: invoice.ncfExpiresAt ? formatDate(invoice.ncfExpiresAt, locale) : null,
        securityCode: submission?.securityCode ?? null,
        signedAt: submission?.sentAt ? formatDateTime(submission.sentAt, locale) : null,
        status: submission?.status ?? null,
        qrDataUri,
        qrUrl: submission?.qrUrl ?? null,
        isDraft: !invoice.ncfNumber,
      },
    });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private compiledTemplate(): HandlebarsTemplateDelegate {
    if (this.template) return this.template;

    const templatePath = path.join(__dirname, 'templates', 'invoice.hbs');
    const fallbackPath = path.join(process.cwd(), 'templates', 'invoice.hbs');
    const resolved = fs.existsSync(templatePath) ? templatePath : fallbackPath;

    let source: string;
    try {
      source = fs.readFileSync(resolved, 'utf8');
    } catch (error) {
      throw new InternalServerError('INVOICES.NO_ENCONTRO_PLANTILLA_IMPRESION_FACTURAS', { resolved, p2: (error as Error).message });
    }

    /*
     * The template's own helpers, registered once alongside the compilation.
     *
     * `t` reads the language off the render context, so one template serves every market — the
     * alternative was one `.hbs` per language, which for a document this precise means three
     * copies of the DGII layout drifting apart.
     */
    handlebars.registerHelper('t', (key: unknown, options: handlebars.HelperOptions) => {
      if (typeof key !== 'string') return '';
      const root = options?.data?.root as { language?: unknown } | undefined;
      const language = isLanguageCode(root?.language) ? root.language : DEFAULT_LANGUAGE;
      return this.i18n.translate(key, language, { ...(options?.hash ?? {}) });
    });

    handlebars.registerHelper('dir', (options: handlebars.HelperOptions) => {
      const root = options?.data?.root as { language?: unknown } | undefined;
      return LANGUAGE_DIRECTION[isLanguageCode(root?.language) ? root.language : DEFAULT_LANGUAGE];
    });

    this.template = handlebars.compile(source);
    return this.template;
  }

  private async qrDataUri(url: string): Promise<string | null> {
    try {
      return await QRCode.toDataURL(url, { margin: 0, width: 240, errorCorrectionLevel: 'M' });
    } catch (error) {
      // A missing QR must not stop the document from printing; the URL is still shown as text.
      this.logger.warn(`No se pudo generar el código QR del comprobante: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * The document's own name, as a catalogue key.
   *
   * `NOTA DE CRÉDITO` printed on a document sent to a reader who does not read Spanish is not a
   * fiscal requirement, it is an untranslated string: the Dominican norm prescribes the e-NCF and
   * the document-type code, both of which are printed separately and unchanged.
   */
  private documentTitleKey(invoice: Invoice): string {
    switch (invoice.type) {
      case InvoiceType.CREDIT_NOTE:
        return 'INVOICE.PDF.TYPE.CREDIT_NOTE';
      case InvoiceType.DEBIT_NOTE:
        return 'INVOICE.PDF.TYPE.DEBIT_NOTE';
      default:
        return 'INVOICE.PDF.TYPE.INVOICE';
    }
  }

  private async browser(): Promise<puppeteer.Browser> {
    if (!this.browserPromise) {
      this.browserPromise = puppeteer
        .launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        })
        .catch((error) => {
          // Clear the memo so the next request retries instead of inheriting a rejected promise.
          this.browserPromise = undefined;
          throw error;
        });
    }
    const browser = await this.browserPromise;
    if (!browser.connected) {
      this.browserPromise = undefined;
      return this.browser();
    }
    return browser;
  }

  /** Run `work` with at most MAX_CONCURRENT_RENDERS in flight. */
  private async withSlot<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= InvoiceRendererService.MAX_CONCURRENT_RENDERS) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await work();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.browserPromise) return;
    const browser = await this.browserPromise.catch(() => null);
    await browser?.close().catch(() => undefined);
  }
}

function trimTrailingZeros(value: number): string {
  const text = Number(value).toFixed(6);
  return text.replace(/\.?0+$/, '') || '0';
}

function formatDate(value: string | Date, locale: string): string {
  const date = value instanceof Date ? value : new Date(`${String(value).split('T')[0]}T12:00:00Z`);
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(date);
}

function formatDateTime(value: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(value);
}
