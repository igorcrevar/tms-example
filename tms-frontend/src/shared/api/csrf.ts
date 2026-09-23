/** The readable half of the double-submit pair; the session cookies are HttpOnly. */
export function readCsrfToken(cookieName: string): string | null {
  const match = new RegExp(`(?:^|;\\s*)${cookieName}=([^;]*)`).exec(document.cookie);

  return match ? decodeURIComponent(match[1]) : null;
}
