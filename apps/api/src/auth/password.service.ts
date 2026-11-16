import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

const OPTS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  // Verified against when the account does not exist, so response time does not reveal account existence.
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return argon2.hash(password, OPTS);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try { return await argon2.verify(hash, password); } catch { return false; }
  }

  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= argon2.hash('dummy-password-for-timing', OPTS);
    await this.verify(await this.dummyHash, password);
  }
}
