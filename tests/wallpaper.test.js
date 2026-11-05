// node environment on purpose: real Canvas 2D via @napi-rs/canvas, so the drawing code really runs.
import { describe, it, expect } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { WALLPAPERS, renderWallpaper, drawCover } from '../src/desktop/wallpaper.js';
import { ICON_IDS, iconSvg, renderIcon } from '../src/desktop/icons.js';

const pixels = (id, w, h) => { const c = createCanvas(w, h); renderWallpaper(id, c, w, h); return c.getContext('2d').getImageData(0, 0, w, h).data; };
const stats = (d) => { let sum = 0, sum2 = 0, n = 0, dark = 0; for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += l; sum2 += l * l; n++; if (l < 6) dark++; } const mean = sum / n; return { mean, sd: Math.sqrt(sum2 / n - mean * mean), dark: dark / n }; };

describe('procedural wallpapers', () => {
  for (const wp of WALLPAPERS) {
    it(`${wp.name}: draws a real picture (not blank, not flat, not all black)`, () => {
      const s = stats(pixels(wp.id, 180, 320));
      expect(s.sd).toBeGreaterThan(8); // has contrast/detail
      expect(s.mean).toBeGreaterThan(8); // not black
      expect(s.mean).toBeLessThan(245); // not blown out
      expect(s.dark).toBeLessThan(0.97);
    });
  }
  it('is deterministic for a given size and different across wallpapers', () => {
    expect(Buffer.from(pixels('aurora', 90, 160)).equals(Buffer.from(pixels('aurora', 90, 160)))).toBe(true);
    expect(Buffer.from(pixels('aurora', 90, 160)).equals(Buffer.from(pixels('nebula', 90, 160)))).toBe(false);
  });
  it('works for tiny, wide, tall and very large canvases without throwing', () => {
    for (const wp of WALLPAPERS) for (const [w, h] of [[64, 64], [640, 360], [200, 900], [1000, 1800]]) {
      const c = createCanvas(w, h);
      expect(renderWallpaper(wp.id, c, w, h)).toBe(true);
    }
  });
  it('unknown id falls back to the first wallpaper; a canvas without 2D context reports false', () => {
    expect(Buffer.from(pixels('does-not-exist', 60, 100)).equals(Buffer.from(pixels(WALLPAPERS[0].id, 60, 100)))).toBe(true); // falls back to the default picture
    expect(renderWallpaper('aurora', { getContext: () => null }, 10, 10)).toBe(false);
  });
  it('renders 1000x1800 within a sane time budget (CPU-bound, generous limit)', () => {
    const t = performance.now(); pixels('nebula', 1000, 1800); pixels('city', 1000, 1800);
    expect(performance.now() - t).toBeLessThan(4000);
  });
  it('cover-fit keeps a photo filling the screen', () => {
    const src = createCanvas(400, 100); const sc = src.getContext('2d'); sc.fillStyle = '#f00'; sc.fillRect(0, 0, 400, 100);
    const c = createCanvas(100, 200);
    expect(drawCover(c, src, 100, 200)).toBe(true);
    const d = c.getContext('2d').getImageData(0, 0, 100, 200).data;
    expect(d[0]).toBeGreaterThan(150); expect(d[1]).toBeLessThan(60); // red everywhere (slightly darkened), no empty bars
    expect(d[d.length - 4 + 3]).toBe(255);
  });
});

describe('icons', () => {
  it('every icon id has a tile and glyph and renders an svg', () => {
    expect(ICON_IDS.length).toBe(10);
    for (const id of ICON_IDS) { const svg = iconSvg(id); expect(svg).toContain('<svg'); expect(svg).toContain(`vi-${id}`); expect(svg).not.toContain('undefined'); }
  });
});
