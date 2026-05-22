
export interface ReportData {
  fileName: string;
  content: string;
  mimeType: string;
}

export interface FiscalReportGenerator {
  generate(organizationId: string, year: number, month: number): Promise<ReportData>;
}