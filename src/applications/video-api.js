// Helpers for the Video app: YouTube Data API v3 requests/responses and the official embed player.
// The API key belongs to the user (free from Google Cloud); nothing here talks to any other service.
export const YT_BASE = 'https://www.googleapis.com/youtube/v3';
export const VIDEO_ID = /^[\w-]{11}$/;
export const keyOk = (k) => typeof k === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(k);

const url = (path, params) => {
  const u = new URL(`${YT_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.href;
};
// videos.list?chart=mostPopular costs 1 quota unit; search.list costs 100.
export const trendingUrl = (key, region = 'VN', max = 24) => url('videos', { part: 'snippet', chart: 'mostPopular', regionCode: region, maxResults: max, key });
export const searchUrl = (key, q, max = 24) => url('search', { part: 'snippet', type: 'video', maxResults: max, q, regionCode: 'VN', relevanceLanguage: 'vi', safeSearch: 'moderate', key });
export const detailsUrl = (key, id) => url('videos', { part: 'snippet', id, key });

export function embedUrl(id, { autoplay = true } = {}) {
  if (!VIDEO_ID.test(id)) throw new Error('Mã video không hợp lệ');
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=${autoplay ? 1 : 0}&playsinline=1&rel=0`;
}
export const watchUrl = (id) => { if (!VIDEO_ID.test(id)) throw new Error('Mã video không hợp lệ'); return `https://www.youtube.com/watch?v=${id}`; };
export const thumbUrl = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`; // built from the id, never taken from the API response

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
// Titles come back HTML-escaped (&amp; &#39;...). Decode to plain text; the UI only ever uses textContent.
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') { const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m; }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

// search.list items have id.videoId, videos.list items have a plain id. Bad entries are dropped.
export function parseVideos(json) {
  const out = [];
  for (const it of Array.isArray(json?.items) ? json.items : []) {
    const id = typeof it?.id === 'string' ? it.id : it?.id?.videoId;
    if (typeof id !== 'string' || !VIDEO_ID.test(id)) continue;
    const sn = it.snippet ?? {};
    out.push({ id, title: decodeEntities(sn.title).slice(0, 200) || 'Video', channel: decodeEntities(sn.channelTitle).slice(0, 100), published: typeof sn.publishedAt === 'string' ? sn.publishedAt : '' });
  }
  return out;
}

// Turn Google's error replies into something the user can act on.
export function apiError(status, json) {
  const reason = json?.error?.errors?.[0]?.reason ?? json?.error?.status ?? '';
  if (reason === 'quotaExceeded' || reason === 'rateLimitExceeded') return 'Hết lượt dùng YouTube trong hôm nay (Google giới hạn), thử lại ngày mai';
  if (reason === 'keyInvalid' || reason === 'API_KEY_INVALID') return 'API key không đúng, hãy kiểm tra lại trong Cài đặt';
  if (reason === 'accessNotConfigured' || reason === 'SERVICE_DISABLED') return 'Key này chưa bật "YouTube Data API v3" trong Google Cloud';
  if (reason === 'ipRefererBlocked' || reason === 'forbidden' || reason === 'PERMISSION_DENIED') return 'Google chặn key này (kiểm tra giới hạn Referrer của key)';
  if (status === 400) return 'Yêu cầu không hợp lệ (kiểm tra API key)';
  return `Lỗi từ YouTube (${status})`;
}

export function timeAgo(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  const units = [[31536000, 'năm'], [2592000, 'tháng'], [86400, 'ngày'], [3600, 'giờ'], [60, 'phút']];
  for (const [sec, name] of units) if (s >= sec) return `${Math.floor(s / sec)} ${name} trước`;
  return 'vừa xong';
}

// What the user typed -> a video id (link, embed link or bare id), or null (then it is a search).
export function videoIdFrom(text) {
  const t = String(text ?? '').trim();
  if (VIDEO_ID.test(t)) return t;
  let u;
  try { u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else { const m = /^\/(shorts|embed|live)\/([^/?#]+)/.exec(u.pathname); id = m ? m[2] : null; }
  }
  return id && VIDEO_ID.test(id) ? id : null;
}
