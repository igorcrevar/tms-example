import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/** Where the backend's development transport writes .eml files (its MAIL_DEV_DIR default). */
const MAIL_DIR = resolve('../tms-backend/storage/dev-mail');
const ACCEPT_LINK = /\/admin\/accept-invite\?token=([A-Za-z0-9_-]+)/;
const POLL_MS = 100;
const TIMEOUT_MS = 10_000;

/** The names already on disk, so a later read can tell a new message from a predecessor. */
export async function mailboxSnapshot(): Promise<Set<string>> {
  return new Set(await mailboxNames());
}

/** Polls for an invitation mailed to `email` after `seen` was taken and returns its token. */
export async function readInvitationToken(
  email: string,
  seen: ReadonlySet<string>,
): Promise<string> {
  const deadline = Date.now() + TIMEOUT_MS;

  for (;;) {
    const token = await findToken(email, seen);

    if (token) {
      return token;
    }

    if (Date.now() >= deadline) {
      throw new Error(`No invitation for ${email} in ${MAIL_DIR}`);
    }

    await delay(POLL_MS);
  }
}

async function mailboxNames(): Promise<string[]> {
  try {
    return await readdir(MAIL_DIR);
  } catch {
    // The directory only exists once something has been sent.
    return [];
  }
}

async function findToken(email: string, seen: ReadonlySet<string>): Promise<string | null> {
  const suffix = `-${email.replace(/[^a-z0-9]/gi, '_')}.eml`;
  const names = await mailboxNames();

  // Names are `${Date.now()}-${marker}.eml`, so sorting puts the newest match last.
  const candidates = names.filter((name) => !seen.has(name) && name.endsWith(suffix)).sort();

  for (const name of candidates.reverse()) {
    const raw = await readFile(join(MAIL_DIR, name), 'utf8');
    // The transport writes quoted-printable, which splits the link across lines.
    const match = ACCEPT_LINK.exec(raw.replace(/=\r?\n/g, '').replace(/=3D/g, '='));

    if (match) {
      return match[1];
    }
  }

  return null;
}
