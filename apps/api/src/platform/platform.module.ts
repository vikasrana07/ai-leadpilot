import { Module } from '@nestjs/common';
import { MfaModule } from '../mfa/mfa.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PlatformController } from './platform.controller.js';
import { PlatformGuard, PlatformTokens } from './platform-auth.js';
import { PlatformService } from './platform.service.js';

@Module({ imports: [AuthModule, MfaModule], controllers: [PlatformController], providers: [PlatformService, PlatformTokens, PlatformGuard] })
export class PlatformModule {}
