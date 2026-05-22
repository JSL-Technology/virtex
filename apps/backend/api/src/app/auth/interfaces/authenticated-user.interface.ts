import { User } from '../../users/entities/user.entity/user.entity';

export interface SafeUser extends Partial<Omit<User, 'password' | 'twoFactorSecret'>> {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  organizationId: string;
  roles: any[]; // Or strict Role type
  permissions: string[];
  organization?: any;
  isTwoFactorEnabled?: boolean;
}

export interface AuthenticatedUser extends SafeUser {
  isImpersonating?: boolean;
  originalUserId?: string;
}
