import { User } from '../../users/entities/user.entity/user.entity';
import type { Organization } from '../../organizations/entities/organization.entity';

export interface SafeUser extends Partial<Omit<User, 'password' | 'twoFactorSecret'>> {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  organizationId: string;
  roles: any[];
  permissions: string[];
  organization?: Organization;
  isTwoFactorEnabled?: boolean;
}

export interface AuthenticatedUser extends SafeUser {
  isImpersonating?: boolean;
  originalUserId?: string;
  sessionId?: string;
}
