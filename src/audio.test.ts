import { describe, expect, it } from 'vitest';
import { enigmaSample } from './audio';

describe('enigmaSample (data/sound-defaults.lua soundtable_enigma)', () => {
  it('maps the sound events levels name to Enigma\'s samples', () => {
    expect(enigmaSample('cloth')).toEqual({ sample: 'st-thud', volume: 1 });
    expect(enigmaSample('bomb_black')).toEqual({ sample: 'explosion1', volume: 1 });
    expect(enigmaSample('coinsloton')).toEqual({ sample: 'st-coinslot', volume: 1 });
    expect(enigmaSample('itemtransform')).toEqual({ sample: 'st-magic', volume: 1 });
    expect(enigmaSample('rubberband')).toEqual({ sample: 'boing', volume: 1 });
    expect(enigmaSample('switchplayer')).toEqual({ sample: 'switch', volume: 1 });
    expect(enigmaSample('fakeoxyd')).toEqual({ sample: 'st-fakeoxyd', volume: 0.3 });
  });

  it('is silent for empty, missing or unknown events', () => {
    expect(enigmaSample('')).toBeNull();
    expect(enigmaSample('scissors')).toBeNull(); // "" in the table
    expect(enigmaSample('doorclose')).toBeNull(); // file missing in Enigma
    expect(enigmaSample('nonsense')).toBeNull();
  });
});
