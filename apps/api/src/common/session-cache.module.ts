import { Global, Module } from '@nestjs/common';
import { SessionCacheService } from './session-cache.js';

@Global()
@Module({
  providers: [SessionCacheService],
  exports: [SessionCacheService],
})
export class SessionCacheModule {}
