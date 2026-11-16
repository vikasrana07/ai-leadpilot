import { Global, Module } from '@nestjs/common';
import { ENV } from './tokens.js';
import { loadEnv } from '../config/env.js';

@Global()
@Module({ providers: [{ provide: ENV, useFactory: () => loadEnv() }], exports: [ENV] })
export class ConfigModule {}
