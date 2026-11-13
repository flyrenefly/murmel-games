import { createHmac, timingSafeEqual } from 'node:crypto';

/** What the game reports: a level was started or solved. */
export type StatType = 'start' | 'solve';

export interface StatEvent {
  /** Calendar day in Berlin, YYYY-MM-DD. */
  day: string;
  ip: string;
  userAgent: string;
  type: StatType;
  /** Level id, e.g. "enigma:ralf_pento1". */
  level: string;
}

export interface StatDay {
  day: string;
  players: number;
  starts: number;
  solved: number;
}

export interface StatLevel {
  level: string;
  starts: number;
  solved: number;
}

export interface Statistics {
  days: StatDay[];
  levels: StatLevel[];
}

/** Level ids as the game writes them (pack:name, letters, digits, a few separators). */
export const LEVEL_ID = "^[A-Za-z0-9 _:./'()!,&+-]{1,100}$";

/** The calendar day in Berlin (the counters switch at local midnight). */
export function berlinDay(now: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(now);
}

/**
 * The anonymous player of a day: HMAC of IP and browser with that day's secret salt. The salt is
 * deleted the next day, after which the value can no longer be linked to anyone.
 */
export function playerKey(salt: Buffer, ip: string, userAgent: string): Buffer {
  return createHmac('sha256', salt).update(ip).update('\n').update(userAgent).digest().subarray(0, 16);
}

/** Compares a bearer token in constant time; false when no token is configured. */
export function tokenMatches(expected: string | undefined, header: string | undefined): boolean {
  if (!expected || !header?.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
