import { describe, expect, it } from 'vitest';
import { reportEvent, statsAllowed } from './stats';

describe('anonymous statistics', () => {
  it('sends start and solve as JSON to /api/event', async () => {
    const sent: [string, Blob][] = [];
    reportEvent('start', 'enigma:ralf_pento1', { hostname: 'murmel.games', sendBeacon: (u, b) => (sent.push([u, b]), true) });
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe('/api/event');
    expect(sent[0][1].type).toBe('application/json');
    expect(JSON.parse(await sent[0][1].text())).toEqual({ type: 'start', level: 'enigma:ralf_pento1' });
  });

  it('stays silent in development and when the player opts out (Do Not Track, GPC)', () => {
    expect(statsAllowed({ hostname: 'localhost' })).toBe(false);
    expect(statsAllowed({ hostname: 'murmel.games', doNotTrack: '1' })).toBe(false);
    expect(statsAllowed({ hostname: 'murmel.games', globalPrivacyControl: true })).toBe(false);
    expect(statsAllowed({ hostname: 'murmel.games' })).toBe(true);
    const sent: string[] = [];
    reportEvent('solve', 'x', { hostname: 'murmel.games', doNotTrack: '1', sendBeacon: (u) => (sent.push(u), true) });
    expect(sent).toEqual([]);
  });

  it('does not count levels from links (editor)', () => {
    const sent: string[] = [];
    reportEvent('start', 'link:0a1b2c3d', { hostname: 'murmel.games', sendBeacon: (u) => (sent.push(u), true) });
    expect(sent).toEqual([]);
  });

  it('never throws, even when the browser refuses', () => {
    expect(() =>
      reportEvent('start', 'x', {
        hostname: 'murmel.games',
        sendBeacon: () => {
          throw new Error('blocked');
        },
      }),
    ).not.toThrow();
  });
});
