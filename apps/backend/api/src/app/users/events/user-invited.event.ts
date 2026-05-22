
import { User } from '../entities/user.entity/user.entity';

export class UserInvitedEvent {
  constructor(
    public readonly user: User,
    public readonly token: string
  ) {}
}
