export interface RegisterPayload {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    organizationName: string;
    fiscalRegionId?: string | null;
    taxId?: string; // Renamed from rnc
    recaptchaToken?: string;
    plan?: string;
    industry?: string;
    companySize?: string;
    address?: string;
}
