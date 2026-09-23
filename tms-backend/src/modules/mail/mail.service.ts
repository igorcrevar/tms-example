import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

import { AppConfig, Environment } from '../../config/app-config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter!: Transporter;
  private devDir: string | null = null;

  constructor(private readonly config: AppConfig) {}

  onModuleInit(): void {
    const { host, port, secure, user, password } = this.config.mail;
    const isProduction = this.config.app.env === Environment.Production;

    if (!host) {
      // A silently dropped invitation is worse than a refusal to start.
      if (isProduction) {
        throw new Error('MAIL_HOST must be configured in production');
      }

      this.devDir = resolve(this.config.mail.devDir);
      this.transporter = nodemailer.createTransport({ streamTransport: true, buffer: true });
      this.logger.warn(`No MAIL_HOST set; messages will be written to ${this.devDir}`);

      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass: password } : undefined,
    });
  }

  async send(message: MailMessage): Promise<void> {
    // The recipient address is never logged; CLAUDE.md requires ids, not emails.
    this.logger.log(`Sending "${message.subject}"`);

    const info = (await this.transporter.sendMail({
      from: this.config.mail.from,
      ...message,
    })) as { message?: Buffer; messageId?: string };

    if (this.devDir && info.message) {
      await mkdir(this.devDir, { recursive: true });
      const name = `${Date.now()}-${message.to.replace(/[^a-z0-9]/gi, '_')}.eml`;
      await writeFile(join(this.devDir, name), info.message);
      // Filename carries the recipient address, so only the directory is logged.
      this.logger.log(`Wrote a development message to ${this.devDir}`);
    }
  }
}
