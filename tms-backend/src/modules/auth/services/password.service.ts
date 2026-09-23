import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/** OWASP Password Storage Cheat Sheet minimums for Argon2id. */
const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class PasswordService {
  private dummyHash: string | null = null;

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2_OPTIONS);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /**
   * Burns the same CPU as a real verify so response time does not reveal
   * whether an account exists.
   */
  async verifyDummy(plain: string): Promise<void> {
    this.dummyHash ??= await this.hash(randomBytes(32).toString('hex'));
    await this.verify(this.dummyHash, plain);
  }
}
