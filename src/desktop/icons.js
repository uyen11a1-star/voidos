// App icons: rounded gradient tile + line glyph (static, trusted SVG markup).
const TILES = {
  terminal: ['#4b5563', '#111827'], files: ['#fbbf24', '#f97316'], editor: ['#60a5fa', '#2563eb'], monitor: ['#34d399', '#059669'],
  settings: ['#94a3b8', '#475569'], browser: ['#38bdf8', '#6366f1'], music: ['#f472b6', '#9333ea'], photos: ['#fb923c', '#e11d48'],
  calculator: ['#64748b', '#1e293b'], program: ['#a78bfa', '#6d28d9'],
};
const GLYPHS = {
  terminal: '<path d="M5 7l5 5-5 5"/><path d="M12 18h7"/>',
  files: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  editor: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  monitor: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  browser: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  photos: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M3 17l5-5 4 4 3-3 6 5"/>',
  calculator: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h2M14 12h2M8 16h2M14 16h2"/>',
  program: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4"/>',
};

export const iconSvg = (id) => {
  const [a, b] = TILES[id];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true"><defs><linearGradient id="vi-${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#vi-${id})"/><g transform="translate(4 4)" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[id]}</g></svg>`;
};

// icon = known app id -> SVG tile; anything else (emoji) -> plain text.
export function renderIcon(icon, cls = 'app-icon') {
  const el = document.createElement('span');
  el.className = cls;
  if (Object.prototype.hasOwnProperty.call(GLYPHS, icon)) {
    const t = document.createElement('template');
    t.innerHTML = iconSvg(icon);
    el.append(t.content.firstElementChild);
  } else el.textContent = icon;
  return el;
}
export const ICON_IDS = Object.keys(GLYPHS);
