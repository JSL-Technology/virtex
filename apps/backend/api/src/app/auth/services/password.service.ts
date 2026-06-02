
import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthConfig } from '../auth.config';

@Injectable()
export class PasswordService {

    async verify(hash: string, plain: string): Promise<boolean> {
        return argon2.verify(hash, plain);
    }

    async hash(plain: string): Promise<string> {
        // L-12 FIX: apply the configured Argon2id parameters explicitly. Previously the
        // ARGON2_* config was dead code (argon2.hash used library defaults), so operational
        // tuning had no effect.
        return argon2.hash(plain, {
            type: argon2.argon2id,
            memoryCost: AuthConfig.ARGON2_MEMORY_COST,
            timeCost: AuthConfig.ARGON2_TIME_COST,
            parallelism: AuthConfig.ARGON2_PARALLELISM,
        });
    }

    async verifyDummy(plain: string): Promise<void> {
        try {
            await argon2.verify(AuthConfig.DUMMY_PASSWORD_HASH, plain);
        } catch (e) {
            // Ignore error
        }
    }
}
