export const ONLINE_THRESHOLD_MS = 2 * 60 * 1000;

export function getOnlineSince(now = new Date()): Date {
  return new Date(now.getTime() - ONLINE_THRESHOLD_MS);
}

export function isUserOnline(
  lastSeenAt: Date | null,
  now = new Date(),
): boolean {
  return lastSeenAt !== null && lastSeenAt >= getOnlineSince(now);
}
