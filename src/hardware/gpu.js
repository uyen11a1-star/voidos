// Software GPU: an RGBA framebuffer with a few drawing primitives.
export const MAX_PIXELS = 1 << 20;

export class GPU {
  constructor(width = 270, height = 480) { this.setResolution(width, height); }

  setResolution(w, h) {
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 32 || h < 32 || w * h > MAX_PIXELS) {
      throw new RangeError(`Resolution must be at least 32x32 and at most ${MAX_PIXELS} pixels`);
    }
    this.width = w; this.height = h;
    this.fb = new Uint8ClampedArray(w * h * 4);
  }

  clear(r = 0, g = 0, b = 0) { this.fillRect(0, 0, this.width, this.height, r, g, b); }

  putPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.fb[i] = r; this.fb[i + 1] = g; this.fb[i + 2] = b; this.fb[i + 3] = a;
  }

  getPixel(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    const i = (y * this.width + x) * 4;
    return [this.fb[i], this.fb[i + 1], this.fb[i + 2], this.fb[i + 3]];
  }

  fillRect(x, y, w, h, r, g, b, a = 255) {
    const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(this.width, x + w), y1 = Math.min(this.height, y + h);
    for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) this.putPixel(i, j, r, g, b, a);
  }

  line(x0, y0, x1, y1, r, g, b) { // Bresenham
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.putPixel(x0, y0, r, g, b);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  // Copy the framebuffer onto a 2D canvas context (browser only).
  present(ctx) { ctx.putImageData(new ImageData(this.fb, this.width, this.height), 0, 0); }
}
