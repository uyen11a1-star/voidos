import { describe, it, expect } from 'vitest';
import { GPU } from '../src/hardware/gpu.js';

describe('GPU', () => {
  it('draws pixels, rects, lines; clips out-of-bounds', () => {
    const g = new GPU(40, 40);
    g.clear(1, 2, 3);
    expect(g.getPixel(0, 0)).toEqual([1, 2, 3, 255]);
    g.putPixel(5, 5, 9, 8, 7);
    expect(g.getPixel(5, 5)).toEqual([9, 8, 7, 255]);
    g.putPixel(-1, 0, 1, 1, 1); g.putPixel(40, 0, 1, 1, 1);
    g.fillRect(30, 30, 100, 100, 5, 5, 5); // clipped
    expect(g.getPixel(39, 39)).toEqual([5, 5, 5, 255]);
    g.line(0, 0, 39, 39, 200, 0, 0);
    expect(g.getPixel(20, 20)[0]).toBe(200);
    expect(g.getPixel(99, 99)).toBeNull();
  });
  it('validates resolution and reallocates the framebuffer', () => {
    const g = new GPU(32, 32);
    expect(() => g.setResolution(10, 10)).toThrow();
    expect(() => g.setResolution(5000, 5000)).toThrow();
    expect(() => g.setResolution(1.5, 40)).toThrow();
    g.setResolution(64, 48);
    expect(g.fb.length).toBe(64 * 48 * 4);
  });
});
