import { Request } from 'express';
import { User } from '../../users/entities/user.entity/user.entity';

export interface RequestWithUser extends Request {
  user: User;
}
