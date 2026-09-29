import { describe, expect, it } from 'vitest';
import {
  getOnlineSince,
  isUserOnline,
  ONLINE_THRESHOLD_MS,
} from './presence.util.js';

describe('user presence helpers', () => {
  const now = new Date('2026-09-29T12:00:00.000Z');

  it('uses a single two-minute threshold', () => {
    expect(ONLINE_THRESHOLD_MS).toBe(120_000);
    expect(getOnlineSince(now)).toEqual(new Date('2026-09-29T11:58:00.000Z'));
  });

  it('treats the threshold boundary as online and older/null values as offline', () => {
    expect(isUserOnline(new Date('2026-09-29T11:58:00.000Z'), now)).toBe(true);
    expect(isUserOnline(new Date('2026-09-29T11:57:59.999Z'), now)).toBe(false);
    expect(isUserOnline(null, now)).toBe(false);
  });
});
