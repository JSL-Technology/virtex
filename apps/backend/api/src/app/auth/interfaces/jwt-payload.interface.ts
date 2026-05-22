

export interface JwtPayload {
    id: string;
    email: string;
    organizationId: string;
    roles: string[];
    permissions?: string[];
    tokenVersion?: number;


    isImpersonating?: boolean;
    originalUserId?: string;

}