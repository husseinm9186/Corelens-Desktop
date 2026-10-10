import { describe, expect, it } from 'vitest';

import { SAMPLES } from './samples';
import { isSeed, mapProjectName, sampleThumb } from './startScreen';

const when = new Date(2026, 9, 10, 12);

describe('mapProjectName', () => {
  it('names a project after the seed address\'s /24 and the date', () => {
    expect(mapProjectName('192.0.2.1', when)).toBe('192.0.2.0/24 — 10 Oct 2026');
  });

  it('uses the first of several seeds, and a hostname as it is', () => {
    expect(mapProjectName('198.51.100.7, 198.51.100.9', when)).toBe('198.51.100.0/24 — 10 Oct 2026');
    expect(mapProjectName('core-sw1.example.test', when)).toBe('core-sw1.example.test — 10 Oct 2026');
  });

  it('still has a name with no seed', () => {
    expect(mapProjectName('', when)).toBe('New network — 10 Oct 2026');
  });
});

describe('isSeed', () => {
  it('takes an address or a name', () => {
    expect(isSeed('192.0.2.1')).toBe(true);
    expect(isSeed(' core-sw1.example.test ')).toBe(true);
  });

  it('refuses what is neither', () => {
    expect(isSeed('')).toBe(false);
    expect(isSeed('192.0.2.300')).toBe(false);
    expect(isSeed('two words')).toBe(false);
    expect(isSeed('-bad-')).toBe(false);
  });
});

describe('sampleThumb', () => {
  it('draws every sample from its own devices and links, inside the card', () => {
    for (const s of SAMPLES) {
      const thumb = sampleThumb(s.build());
      expect(thumb.dots.length, s.name).toBeGreaterThan(3);
      expect(thumb.lines.length, s.name).toBeGreaterThan(2);
      for (const d of thumb.dots) {
        expect(d.x).toBeGreaterThanOrEqual(0);
        expect(d.x).toBeLessThanOrEqual(280);
        expect(d.y).toBeGreaterThanOrEqual(0);
        expect(d.y).toBeLessThanOrEqual(120);
      }
    }
  });

  it('gives each device its family', () => {
    const thumb = sampleThumb(SAMPLES[1]!.build());
    expect(new Set(thumb.dots.map((d) => d.family)).size).toBeGreaterThan(1);
  });

  it('is different for different samples', () => {
    const a = JSON.stringify(sampleThumb(SAMPLES[1]!.build()));
    const b = JSON.stringify(sampleThumb(SAMPLES[2]!.build()));
    expect(a).not.toBe(b);
  });
});
