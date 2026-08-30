import type { HttpRequest as Request } from '../../common/http/http.types';
import { User } from '../../users/entities/user.entity/user.entity';

export interface RequestWithUser extends Request {
  user: User;
}
