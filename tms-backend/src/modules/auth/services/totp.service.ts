import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';

import { AppConfig } from '../../../config/app-config';

@Injectable()
export class TotpService {
  private readonly otp: typeof authenticator;
  private readonly issuer: string;

  constructor(config: AppConfig) {
    // Cloned rather than configured globally so other consumers keep defaults.
    this.otp = authenticator.clone({ window: config.auth.totpWindow });
    this.issuer = config.auth.totpIssuer;
  }

  generateSecret(): string {
    return this.otp.generateSecret();
  }

  buildUri(accountName: string, secret: string): string {
    return this.otp.keyuri(accountName, this.issuer, secret);
  }

  buildQrDataUrl(uri: string): Promise<string> {
    return QRCode.toDataURL(uri);
  }

  verify(secret: string, token: string): boolean {
    try {
      return this.otp.check(token, secret);
    } catch {
      return false;
    }
  }
}
