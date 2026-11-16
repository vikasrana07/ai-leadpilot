import { Module } from '@nestjs/common';
import { MfaModule } from '../mfa/mfa.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

@Module({
  imports: [TenantsModule, MfaModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService],
  exports: [TokenService, PasswordService],
})
export class AuthModule {}
