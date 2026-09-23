const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

/**
 * Parses `30s`, `10m`, `12h`, `7d` into seconds. Config holds durations as
 * numbers so they can be handed to both jsonwebtoken and cookie maxAge.
 */
export function durationToSeconds(value: string, fallbackSeconds: number): number {
  const match = /^(\d+)\s*([smhd])$/.exec(value.trim());

  if (!match) {
    const asNumber = Number(value);
    return Number.isFinite(asNumber) && asNumber > 0 ? asNumber : fallbackSeconds;
  }

  return Number(match[1]) * UNIT_SECONDS[match[2]];
}
