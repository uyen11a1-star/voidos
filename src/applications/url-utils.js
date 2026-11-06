// Turns what the user typed in the address bar into something the browser can show.
// Only http(s) pages, local virtual-disk files and internal void:// pages are ever loaded.
export const ENGINES = [
  { id: 'wikipedia', name: 'Wikipedia', url: 'https://vi.wikipedia.org/w/index.php?search=%s', framable: true },
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=%s', framable: false },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=%s', framable: false },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', framable: false },
];
export const QUICK_LINKS = [
  { title: 'Wikipedia', url: 'https://vi.wikipedia.org/', embed: true },
  { title: 'YouTube', app: 'video' },
  { title: 'Google', url: 'https://www.google.com/' },
  { title: 'GitHub', url: 'https://github.com/' },
  { title: 'Facebook', url: 'https://www.facebook.com/' },
  { title: 'Gmail', url: 'https://mail.google.com/' },
];
export const INTERNAL_PAGES = ['newtab', 'bookmarks', 'history'];

const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const VIDEO_ID = /^[\w-]{11}$/;

function youtubeId(u) {
  const host = u.hostname.toLowerCase();
  if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0];
  if (!YT_HOSTS.has(host)) return null;
  if (u.pathname === '/watch') return u.searchParams.get('v');
  const m = /^\/(shorts|embed|live)\/([^/?#]+)/.exec(u.pathname);
  return m ? m[2] : null;
}

function parseWeb(text) {
  let u;
  try { u = new URL(text); } catch { return { type: 'invalid', message: 'Địa chỉ không hợp lệ' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { type: 'invalid', message: 'Chỉ hỗ trợ trang http(s)' };
  if (u.username || u.password) return { type: 'invalid', message: 'Địa chỉ có tên đăng nhập kèm theo bị chặn (dễ bị lừa đảo)' };
  if (!u.hostname) return { type: 'invalid', message: 'Địa chỉ không hợp lệ' };
  const id = youtubeId(u);
  if (id !== null) {
    if (!VIDEO_ID.test(id)) return { type: 'invalid', message: 'Không nhận ra mã video YouTube' };
    return { type: 'web', url: `https://www.youtube-nocookie.com/embed/${id}`, embed: true };
  }
  u.protocol = 'https:'; // http pages cannot be shown inside an https page (mixed content)
  return { type: 'web', url: u.href };
}

export function resolveInput(input, engineId = 'wikipedia') {
  const text = String(input ?? '').trim();
  if (!text) return { type: 'void', page: 'newtab' };
  const internal = /^void:\/\/([a-z]+)\/?$/i.exec(text);
  if (internal) return INTERNAL_PAGES.includes(internal[1].toLowerCase()) ? { type: 'void', page: internal[1].toLowerCase() } : { type: 'invalid', message: 'Trang void:// không tồn tại' };
  const vfs = /^vfs:\/\/(\/.*)$/i.exec(text);
  if (vfs) return { type: 'file', path: vfs[1] };
  if (text.startsWith('/') && !/\s/.test(text)) return { type: 'file', path: text };
  if (/^https?:\/\//i.test(text)) return parseWeb(text);
  const hostPort = /^[^\s/:]+:\d+(\/|$)/.test(text);
  if (!hostPort && /^[a-z][a-z0-9+.-]*:/i.test(text)) return { type: 'invalid', message: 'Giao thức này không được hỗ trợ' };
  if (!/\s/.test(text) && /^(?:[\w-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i.test(text)) return parseWeb(`https://${text}`);
  const engine = ENGINES.find((e) => e.id === engineId) ?? ENGINES[0];
  const url = engine.url.replace('%s', encodeURIComponent(text));
  return engine.framable ? { type: 'web', url, search: true } : { type: 'external', url };
}

export const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
// Pages known to allow framing (verified): Wikipedia reading/search pages and YouTube embeds.
export const isEmbedFriendly = (url) => { try { const h = new URL(url).hostname; return /(^|\.)wikipedia\.org$/.test(h) || h === 'www.youtube-nocookie.com'; } catch { return false; } };
