import { Request } from 'express';

// Cannot import JwtPayload from apps if this is a lib.
// We must define our own User interface or use any.
// Since this is just an interface for casting, we can duplicate the structure safely.

export interface AuthenticatedUser {
    id: string;
    email: string;
    organizationId: string;
    roles: string[];
    permissions?: string[];
    tokenVersion?: number;
    isImpersonating?: boolean;
    originalUserId?: string;
    [key: string]: any;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
