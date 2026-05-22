import { Invoice } from '../entities/invoice.entity';

export interface EInvoiceResponse {
    success: boolean;
    providerId?: string;
    message?: string;
}

export abstract class EInvoiceProvider {
    abstract sendInvoice(invoice: Invoice): Promise<EInvoiceResponse>;
    abstract getStatus(providerId: string): Promise<string>;
}