// Procedural wallpapers drawn with plain Canvas 2D (no image assets, no network).
// Every wallpaper is deterministic for a given size, so it looks the same on every reload.

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)].map(Math.round);

function sky(ctx, w, h, stops) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  for (const [p, c] of stops) g.addColorStop(p, c);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}
function stars(ctx, w, h, r, n, maxY = 1) {
  for (let i = 0; i < n; i++) {
    const x = r() * w, y = r() * h * maxY, s = r();
    ctx.fillStyle = `rgba(255,255,255,${0.25 + s * 0.6})`;
    ctx.beginPath(); ctx.arc(x, y, Math.min(w, h) * (0.0008 + s * 0.0016), 0, 7); ctx.fill();
  }
}
function vignette(ctx, w, h, a = 0.4) {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${a})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}
function ridge(r, w, h, base, rough, detail = 7) { // midpoint displacement
  const n = 1 << detail, pts = new Array(n + 1).fill(0);
  pts[0] = (r() - 0.5) * rough; pts[n] = (r() - 0.5) * rough;
  for (let step = n, amp = rough; step > 1; step >>= 1, amp *= 0.55) {
    for (let i = 0; i < n; i += step) pts[i + step / 2] = (pts[i] + pts[i + step]) / 2 + (r() - 0.5) * amp;
  }
  return pts.map((v, i) => [(i / n) * w, base + v]);
}
function fillRidge(ctx, pts, w, h, fill) {
  ctx.beginPath(); ctx.moveTo(0, h);
  for (const [x, y] of pts) ctx.lineTo(x, y);
  ctx.lineTo(w, h); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
}

function voidGold(ctx, w, h, r) {
  const g = ctx.createRadialGradient(w * 0.78, h * 0.18, 0, w * 0.78, h * 0.18, Math.max(w, h) * 0.95);
  g.addColorStop(0, '#46330c'); g.addColorStop(0.35, '#15110a'); g.addColorStop(1, '#030304');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const gold = [226, 184, 70], lines = 46;
  ctx.lineCap = 'round';
  for (let i = 0; i < lines; i++) {
    const t = i / (lines - 1), bump = Math.pow(1 - Math.abs(t - 0.5) * 2, 1.4);
    const a = 0.22 + 0.7 * bump;
    const lg = ctx.createLinearGradient(0, 0, w, 0);
    lg.addColorStop(0, rgba(gold, 0)); lg.addColorStop(0.2, rgba(gold, a * 0.55)); lg.addColorStop(0.6, rgba(gold, a)); lg.addColorStop(1, rgba(gold, a * 0.15));
    const path = () => {
      ctx.beginPath();
      for (let x = 0; x <= w + 4; x += 4) {
        const u = x / w, env = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, u))), 1.1);
        const y = h * (0.2 + 0.62 * t) + env * h * 0.13 * Math.sin(u * 5.2 + t * 3.4) + env * h * 0.05 * Math.sin(u * 12 - t * 6) + (t - 0.5) * h * 0.22 * env;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    };
    const lw = Math.max(0.8, Math.min(w, h) * (0.0026 + 0.0022 * bump));
    ctx.strokeStyle = lg;
    ctx.globalAlpha = 0.16; ctx.lineWidth = lw * 4; path(); ctx.stroke(); // glow pass
    ctx.globalAlpha = 1; ctx.lineWidth = lw; path(); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 70; i++) { const x = r() * w, y = r() * h; ctx.fillStyle = rgba(gold, 0.05 + r() * 0.25); ctx.beginPath(); ctx.arc(x, y, 0.6 + r() * 1.4, 0, 7); ctx.fill(); }
  ctx.globalCompositeOperation = 'source-over';
  vignette(ctx, w, h, 0.45);
}

function aurora(ctx, w, h, r) {
  sky(ctx, w, h, [[0, '#04060f'], [0.5, '#0a1a2c'], [1, '#12333b']]);
  stars(ctx, w, h, r, Math.round(w * h / 1800), 0.7);
  const bands = [[[70, 255, 170], 0.2], [[60, 190, 255], 0.31], [[170, 110, 255], 0.38], [[90, 255, 200], 0.26]];
  ctx.globalCompositeOperation = 'lighter';
  bands.forEach(([c, y0], bi) => {
    const ph = r() * 6, f1 = 2 + r() * 2, f2 = 5 + r() * 3, step = Math.max(2, Math.round(w / 220));
    for (let x = 0; x < w; x += step) {
      const u = x / w, edge = Math.sin(Math.PI * u);
      const y = h * y0 + Math.sin(u * f1 * Math.PI + ph) * h * 0.05 + Math.sin(u * f2 * Math.PI + ph * 2) * h * 0.018;
      const len = h * (0.1 + 0.1 * (0.5 + 0.5 * Math.sin(u * 9 + ph + bi))) * (0.4 + 0.6 * edge);
      const g = ctx.createLinearGradient(0, y - len * 0.15, 0, y + len);
      g.addColorStop(0, rgba(c, 0)); g.addColorStop(0.12, rgba(c, 0.13 * edge + 0.02)); g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g; ctx.fillRect(x, y - len * 0.15, step + 1, len * 1.15);
    }
  });
  ctx.globalCompositeOperation = 'source-over';
  fillRidge(ctx, ridge(r, w, h, h * 0.84, h * 0.07), w, h, '#071018');
  fillRidge(ctx, ridge(r, w, h, h * 0.92, h * 0.05), w, h, '#03070b');
  vignette(ctx, w, h, 0.35);
}

function mountains(ctx, w, h, r) {
  sky(ctx, w, h, [[0, '#1a1a3d'], [0.35, '#5b3a6e'], [0.6, '#d9706a'], [0.78, '#f6c28b']]);
  const sun = ctx.createRadialGradient(w * 0.62, h * 0.55, 0, w * 0.62, h * 0.55, Math.max(w, h) * 0.5);
  sun.addColorStop(0, 'rgba(255,238,200,0.95)'); sun.addColorStop(0.08, 'rgba(255,214,150,0.55)'); sun.addColorStop(1, 'rgba(255,170,120,0)');
  ctx.fillStyle = sun; ctx.fillRect(0, 0, w, h);
  stars(ctx, w, h, r, Math.round(w * h / 3500), 0.35);
  const layers = [['#a18fb3', 0.62, 0.08], ['#7d6b9c', 0.68, 0.09], ['#58497a', 0.75, 0.1], ['#352c54', 0.83, 0.1], ['#171229', 0.92, 0.08]];
  layers.forEach(([col, by, rough], i) => {
    fillRidge(ctx, ridge(r, w, h, h * by, h * rough), w, h, col);
    const mist = ctx.createLinearGradient(0, h * by - h * 0.06, 0, h * by + h * 0.1);
    mist.addColorStop(0, 'rgba(255,225,200,0)'); mist.addColorStop(0.5, `rgba(255,225,205,${0.1 + i * 0.015})`); mist.addColorStop(1, 'rgba(255,225,200,0)');
    ctx.fillStyle = mist; ctx.fillRect(0, h * by - h * 0.06, w, h * 0.16);
  });
  vignette(ctx, w, h, 0.3);
}

function nebula(ctx, w, h, r) {
  ctx.fillStyle = '#03030a'; ctx.fillRect(0, 0, w, h);
  const cols = [[130, 60, 210], [50, 110, 235], [225, 65, 165], [40, 185, 205], [255, 140, 90]];
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 16; i++) {
    const c = cols[Math.floor(r() * cols.length)], x = r() * w, y = r() * h, rad = Math.min(w, h) * (0.25 + r() * 0.55);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, rgba(c, 0.2 + r() * 0.12)); g.addColorStop(0.5, rgba(c, 0.07)); g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  for (let i = 0; i < Math.round(w * h / 350); i++) { // dust grains
    const c = cols[Math.floor(r() * cols.length)];
    ctx.fillStyle = rgba(c, 0.04 + r() * 0.14); ctx.fillRect(r() * w, r() * h, 1.2, 1.2);
  }
  for (let i = 0; i < Math.round(w * h / 900); i++) {
    const x = r() * w, y = r() * h, s = r(), rad = 0.5 + s * s * 1.8;
    ctx.fillStyle = `rgba(255,255,255,${0.35 + s * 0.65})`; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
    if (s > 0.93) { const g = ctx.createRadialGradient(x, y, 0, x, y, rad * 9); g.addColorStop(0, 'rgba(200,220,255,0.5)'); g.addColorStop(1, 'rgba(200,220,255,0)'); ctx.fillStyle = g; ctx.fillRect(x - rad * 9, y - rad * 9, rad * 18, rad * 18); }
  }
  ctx.globalCompositeOperation = 'source-over';
  vignette(ctx, w, h, 0.4);
}

function lowPoly(ctx, w, h, r) {
  const cols = 8, size = w / cols, rows = Math.ceil(h / size) + 1;
  const pts = [];
  for (let j = 0; j <= rows; j++) { pts.push([]); for (let i = 0; i <= cols; i++) pts[j].push([i * size + (i > 0 && i < cols ? (r() - 0.5) * size * 0.7 : 0), j * size + (j > 0 && j < rows ? (r() - 0.5) * size * 0.7 : 0)]); }
  const stops = [[18, 22, 56], [58, 40, 120], [150, 55, 150], [236, 110, 120]];
  const colorAt = (t) => { const x = Math.min(0.999, Math.max(0, t)) * (stops.length - 1), i = Math.floor(x); return mix(stops[i], stops[i + 1], x - i); };
  const tri = (a, b, c) => {
    const t = ((a[0] + b[0] + c[0]) / 3 / w) * 0.45 + ((a[1] + b[1] + c[1]) / 3 / h) * 0.75, k = 0.9 + r() * 0.2;
    const col = colorAt(t).map((v) => Math.min(255, Math.round(v * k)));
    ctx.fillStyle = `rgb(${col})`; ctx.strokeStyle = `rgba(${col},0.9)`; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...c); ctx.closePath(); ctx.fill(); ctx.stroke();
  };
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = pts[j][i], b = pts[j][i + 1], c = pts[j + 1][i], d = pts[j + 1][i + 1];
    if ((i + j) % 2 === 0) { tri(a, b, c); tri(b, d, c); } else { tri(a, b, d); tri(a, d, c); }
  }
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,255,255,0.08)'); g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

function ocean(ctx, w, h, r) {
  const hz = h * 0.56;
  sky(ctx, w, hz + 1, [[0, '#14143a'], [0.45, '#6a2a62'], [0.8, '#f0624d'], [1, '#ffc371']]);
  stars(ctx, w, h, r, Math.round(w * h / 5000), 0.2);
  const sx = w * 0.5, glow = ctx.createRadialGradient(sx, hz, 0, sx, hz, Math.max(w, h) * 0.55);
  glow.addColorStop(0, 'rgba(255,240,200,0.9)'); glow.addColorStop(0.1, 'rgba(255,200,130,0.5)'); glow.addColorStop(1, 'rgba(255,140,100,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, w, hz);
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, hz); ctx.clip();
  ctx.fillStyle = '#fff6df'; ctx.beginPath(); ctx.arc(sx, hz, Math.min(w, h) * 0.12, 0, 7); ctx.fill(); ctx.restore();
  for (let i = 0; i < 6; i++) { // soft clouds
    const y = h * (0.12 + r() * 0.3), x = r() * w, cw = w * (0.3 + r() * 0.4);
    const g = ctx.createRadialGradient(x, y, 0, x, y, cw / 2); g.addColorStop(0, 'rgba(255,170,150,0.28)'); g.addColorStop(1, 'rgba(255,170,150,0)');
    ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.16); ctx.translate(-x, -y); ctx.fillStyle = g; ctx.fillRect(x - cw / 2, y - cw / 2, cw, cw); ctx.restore();
  }
  const sea = ctx.createLinearGradient(0, hz, 0, h); sea.addColorStop(0, '#5a2a58'); sea.addColorStop(0.15, '#2a1840'); sea.addColorStop(1, '#07050f');
  ctx.fillStyle = sea; ctx.fillRect(0, hz, w, h - hz);
  for (let y = hz + 2; y < h; y += Math.max(2, h * 0.006)) { // sun reflection shimmer
    const d = (y - hz) / (h - hz), half = w * (0.04 + d * 0.16) * (0.4 + r());
    ctx.fillStyle = `rgba(255,205,140,${0.55 * (1 - d) * (0.3 + r() * 0.7)})`; ctx.fillRect(sx - half, y, half * 2, Math.max(1, h * 0.0025));
  }
  ctx.lineWidth = 1;
  for (let i = 0; i < 16; i++) { // wave lines
    const d = i / 15, y0 = hz + (h - hz) * Math.pow(d, 1.5) + 4; ctx.strokeStyle = `rgba(255,190,150,${0.05 + d * 0.06})`; ctx.beginPath();
    for (let x = 0; x <= w; x += 5) { const y = y0 + Math.sin(x * (0.03 - d * 0.015) + i * 2) * (1 + d * 3); if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
  }
  vignette(ctx, w, h, 0.35);
}

function city(ctx, w, h, r) {
  sky(ctx, w, h, [[0, '#080a1c'], [0.5, '#27143f'], [0.85, '#7a3a6c'], [1, '#c8628a']]);
  stars(ctx, w, h, r, Math.round(w * h / 2800), 0.45);
  const moon = ctx.createRadialGradient(w * 0.72, h * 0.16, 0, w * 0.72, h * 0.16, w * 0.35);
  moon.addColorStop(0, 'rgba(255,245,225,0.55)'); moon.addColorStop(0.15, 'rgba(255,240,215,0.2)'); moon.addColorStop(1, 'rgba(255,240,215,0)');
  ctx.fillStyle = moon; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fff4e0'; ctx.beginPath(); ctx.arc(w * 0.72, h * 0.16, Math.min(w, h) * 0.035, 0, 7); ctx.fill();
  const layers = [{ base: 0.7, hMax: 0.2, col: '#3a2150', win: 0, wmin: 0.05, wmax: 0.1 }, { base: 0.78, hMax: 0.26, col: '#1b1030', win: 0.18, wmin: 0.06, wmax: 0.12 }, { base: 0.9, hMax: 0.3, col: '#08050f', win: 0.32, wmin: 0.07, wmax: 0.14 }];
  for (const L of layers) {
    let x = -w * 0.02;
    while (x < w) {
      const bw = w * (L.wmin + r() * (L.wmax - L.wmin)), bh = h * (0.04 + r() * L.hMax), y = h * L.base - bh + h * 0.12;
      ctx.fillStyle = L.col; ctx.fillRect(x, y, bw + 1, h - y);
      if (L.win) {
        const ww = Math.max(2, w * 0.011), gap = ww * 1.9;
        for (let wy = y + gap; wy < h * L.base + h * 0.08; wy += gap) for (let wx = x + gap * 0.6; wx < x + bw - ww; wx += gap) if (r() < L.win) { ctx.fillStyle = r() < 0.8 ? 'rgba(255,214,140,0.85)' : 'rgba(150,215,255,0.8)'; ctx.fillRect(wx, wy, ww, ww * 1.3); }
      }
      if (r() < 0.12) { ctx.fillStyle = L.col; ctx.fillRect(x + bw / 2, y - h * 0.03, 1.5, h * 0.03); ctx.fillStyle = 'rgba(255,70,70,0.9)'; ctx.beginPath(); ctx.arc(x + bw / 2 + 0.7, y - h * 0.03, 1.6, 0, 7); ctx.fill(); }
      x += bw + w * 0.004;
    }
  }
  vignette(ctx, w, h, 0.3);
}

function bokeh(ctx, w, h, r) {
  const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#0a0a14'); g.addColorStop(0.55, '#1a1030'); g.addColorStop(1, '#0c1a26');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const cols = [[226, 184, 70], [70, 190, 210], [160, 110, 255], [240, 110, 150]];
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 70; i++) {
    const c = cols[Math.floor(r() * cols.length)], x = r() * w, y = r() * h, rad = Math.min(w, h) * (0.02 + Math.pow(r(), 2) * 0.13), a = 0.05 + r() * 0.13;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, rad);
    rg.addColorStop(0, rgba(c, a * 0.7)); rg.addColorStop(0.85, rgba(c, a)); rg.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  vignette(ctx, w, h, 0.45);
}

export const WALLPAPERS = [
  { id: 'voidgold', name: 'Void Gold', draw: voidGold },
  { id: 'aurora', name: 'Cực quang', draw: aurora },
  { id: 'mountains', name: 'Hoàng hôn núi', draw: mountains },
  { id: 'nebula', name: 'Tinh vân', draw: nebula },
  { id: 'lowpoly', name: 'Low-poly', draw: lowPoly },
  { id: 'ocean', name: 'Biển chiều', draw: ocean },
  { id: 'city', name: 'Thành phố đêm', draw: city },
  { id: 'bokeh', name: 'Bokeh', draw: bokeh },
];
export const DEFAULT_WALLPAPER = 'gen:voidgold';

// Draw wallpaper `id` into a canvas of w*h pixels. Returns false if the canvas has no 2D context.
export function renderWallpaper(id, canvas, w, h) {
  const wp = WALLPAPERS.find((x) => x.id === id) ?? WALLPAPERS[0];
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return false;
  let seed = 7; for (const ch of `${wp.id}${w}x${h}`) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  ctx.save(); wp.draw(ctx, w, h, rng(seed)); ctx.restore();
  return true;
}

// Cover-fit an already loaded image (user photo) into the canvas.
export function drawCover(canvas, img, w, h) {
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return false;
  const s = Math.max(w / img.width, h / img.height), dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(0,0,0,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); // keeps icons readable on bright photos
  return true;
}
