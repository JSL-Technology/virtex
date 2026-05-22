
import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthConfig } from '../auth.config';

@Injectable()
export class PasswordService {

    async verify(hash: string, plain: string): Promise<boolean> {
        return argon2.verify(hash, plain);
    }

    async hash(plain: string): Promise<string> {
        return argon2.hash(plain);
    }

    async verifyDummy(plain: string): Promise<void> {
        try {
            await argon2.verify(AuthConfig.DUMMY_PASSWORD_HASH, plain);
        } catch (e) {
            // Ignore error
        }
    }
}
