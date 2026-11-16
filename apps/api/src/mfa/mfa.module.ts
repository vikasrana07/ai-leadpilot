import { Global, Module } from '@nestjs/common';
import { MfaController, WorkspaceSecurityController } from './mfa.controller.js';
import { MfaService } from './mfa.service.js';

/** Global: guards in several modules (tenant, platform) consult MFA state. */
@Global()
@Module({ controllers: [MfaController, WorkspaceSecurityController], providers: [MfaService], exports: [MfaService] })
export class MfaModule {}
