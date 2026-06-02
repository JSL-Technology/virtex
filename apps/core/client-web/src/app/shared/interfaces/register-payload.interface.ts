export interface RegisterPayload {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    organizationName: string;
    fiscalRegionId?: string | null;
    taxId?: string;
    recaptchaToken?: string;
    plan?: string;
    industry?: string;
    companySize?: string;
    address?: string;
    phone?: string;
    emailVerificationCode?: string;
    phoneVerificationCode?: string;
}
