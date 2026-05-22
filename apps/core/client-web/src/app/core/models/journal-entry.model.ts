export interface JournalEntry {
    id: string;
    date: string;
    description: string;
    status: JournalEntryStatus;
    lines: JournalEntryLine[];
    totalDebit: number;
    totalCredit: number;
    organizationId: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface JournalEntryLine {
    accountId: string;
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
    description?: string;
}

export enum JournalEntryStatus {
    DRAFT = 'Draft',
    POSTED = 'Posted',
}