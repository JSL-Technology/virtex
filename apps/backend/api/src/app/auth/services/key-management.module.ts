import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KeyManagementService } from './key-management.service';

// @Global so a single KeyManagementService instance is shared across the whole app.
// This is critical: in development the RS256 key pair is generated in-memory at startup
// (ephemeral). A second instance would generate a *different* key, so tokens signed by one
// instance could never be verified by another (e.g. the WebSocket gateway). One instance only.
@Global()
@Module({
  imports: [ConfigModule],
  providers: [KeyManagementService],
  exports: [KeyManagementService],
})
export class KeyManagementModule {}
