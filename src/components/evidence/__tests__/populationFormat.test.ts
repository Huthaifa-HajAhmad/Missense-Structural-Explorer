import { afterEach, describe, expect, it } from 'vitest';
import { formatClinicalDate } from '../population/populationFormat';

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = ORIGINAL_TZ;
});

describe('formatClinicalDate', () => {
  // A calendar day must read the same wherever the reader is. West of UTC, midnight UTC is still the day before.
  it.each(['America/New_York', 'America/Los_Angeles', 'UTC', 'Asia/Tokyo', 'Pacific/Kiritimati'])('shows a date-only value as that day in %s', zone => {
    process.env.TZ = zone;
    expect(formatClinicalDate('2014-04-01')).toBe('1 Apr 2014');
    expect(formatClinicalDate('2026-06-28')).toBe('28 Jun 2026');
  });

  it('proves the zone switch took effect, so the cases above can fail', () => {
    process.env.TZ = 'America/New_York';
    expect(new Date('2014-04-01').getDate()).toBe(31);
  });

  it('keeps day-month-year order and returns null for nothing or nonsense', () => {
    expect(formatClinicalDate('2024-03-12')).toBe('12 Mar 2024');
    expect(formatClinicalDate('')).toBeNull();
    expect(formatClinicalDate(null)).toBeNull();
    expect(formatClinicalDate(undefined)).toBeNull();
    expect(formatClinicalDate('not a date')).toBeNull();
  });
});
