import { Injectable, InternalServerErrorException, Logger, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as handlebars from 'handlebars';
import * as puppeteer from 'puppeteer';
import * as QRCode from 'qrcode';
import { Invoice, InvoiceType } from '../entities/invoice.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { EcfSubmission } from '../../einvoicing/entities/ecf-submission.entity';
import { minorUnitsFor } from '../../currencies/currency-catalogue';

/** Everything the template needs, resolved before rendering. */
export interface InvoiceRenderContext {
  invoice: Invoice;
  organization: Organization;
  submission?: EcfSubmission | null;
  /** ISO 4217 symbol/format hints for the document currency. */
  locale?: string;
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
    const locale = context.locale ?? 'es-DO';

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
      title: this.documentTitle(invoice),
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
      throw new InternalServerErrorException(
        `No se encontró la plantilla de impresión de facturas (${resolved}): ${(error as Error).message}`,
      );
    }

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

  private documentTitle(invoice: Invoice): string {
    switch (invoice.type) {
      case InvoiceType.CREDIT_NOTE:
        return 'NOTA DE CRÉDITO';
      case InvoiceType.DEBIT_NOTE:
        return 'NOTA DE DÉBITO';
      default:
        return invoice.fiscalDocumentType === 'E32' ? 'FACTURA DE CONSUMO' : 'FACTURA';
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
