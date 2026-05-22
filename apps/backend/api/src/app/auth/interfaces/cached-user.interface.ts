import { User } from '../../users/entities/user.entity/user.entity';

export interface CachedUser extends User {
  _cachedPermissions?: string[];
}
