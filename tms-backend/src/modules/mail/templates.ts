import { escapeHtml } from '../../common/utils/escape-html';

export function invitationEmail(params: {
  firstName: string;
  acceptUrl: string;
  expiresAt: Date;
}): { subject: string; text: string; html: string } {
  const expires = params.expiresAt.toISOString();

  return {
    subject: 'Your TMS invitation',
    text: [
      `Hello ${params.firstName},`,
      '',
      'You have been invited to the Transport Management System.',
      'Open the link below to set your password and activate your account:',
      '',
      params.acceptUrl,
      '',
      `The link is single-use and expires at ${expires}.`,
    ].join('\n'),
    html: [
      `<p>Hello ${escapeHtml(params.firstName)},</p>`,
      '<p>You have been invited to the Transport Management System.</p>',
      `<p><a href="${escapeHtml(params.acceptUrl)}">Set your password and activate your account</a></p>`,
      `<p>The link is single-use and expires at ${escapeHtml(expires)}.</p>`,
    ].join('\n'),
  };
}

export function passwordResetEmail(params: {
  firstName: string;
  resetUrl: string;
  expiresAt: Date;
}): { subject: string; text: string; html: string } {
  const expires = params.expiresAt.toISOString();

  return {
    subject: 'Reset your TMS password',
    text: [
      `Hello ${params.firstName},`,
      '',
      'Someone asked to reset the password on your Transport Management System account.',
      'Open the link below to choose a new one:',
      '',
      params.resetUrl,
      '',
      `The link is single-use and expires at ${expires}.`,
      'If this was not you, ignore this message; nothing has changed.',
      'Your authenticator app is unaffected and is still required to sign in.',
    ].join('\n'),
    html: [
      `<p>Hello ${escapeHtml(params.firstName)},</p>`,
      '<p>Someone asked to reset the password on your Transport Management System account.</p>',
      `<p><a href="${escapeHtml(params.resetUrl)}">Choose a new password</a></p>`,
      `<p>The link is single-use and expires at ${escapeHtml(expires)}.</p>`,
      '<p>If this was not you, ignore this message; nothing has changed. Your authenticator app is unaffected and is still required to sign in.</p>',
    ].join('\n'),
  };
}

/** An admin-composed notice: the body is plain text and is escaped into the HTML part. */
export function adminNoticeEmail(params: { firstName: string; subject: string; body: string }): {
  subject: string;
  text: string;
  html: string;
} {
  return {
    subject: params.subject,
    text: [`Hello ${params.firstName},`, '', params.body].join('\n'),
    html: [
      `<p>Hello ${escapeHtml(params.firstName)},</p>`,
      ...params.body
        .split(/\n{2,}/)
        .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`),
    ].join('\n'),
  };
}
