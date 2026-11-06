import { describe, it, expect } from 'vitest';
import { keyOk, trendingUrl, searchUrl, detailsUrl, embedUrl, watchUrl, thumbUrl, decodeEntities, parseVideos, apiError, timeAgo, videoIdFrom } from '../src/applications/video-api.js';

const KEY = 'AIzaSyA-1234567890abcdefghijklmnopqrs';
describe('YouTube API helpers', () => {
  it('validates keys', () => {
    expect(keyOk(KEY)).toBe(true);
    for (const bad of ['', 'short', 'has space aaaaaaaaaaaaaaaaaaaa', 'a'.repeat(65), null, 5, 'AIza&key=evil-aaaaaaaaaaaaaaaaaaaa']) expect(keyOk(bad)).toBe(false);
  });
  it('builds properly escaped API urls (trending is the cheap 1-unit call)', () => {
    const t = new URL(trendingUrl(KEY));
    expect(t.origin + t.pathname).toBe('https://www.googleapis.com/youtube/v3/videos');
    expect(Object.fromEntries(t.searchParams)).toMatchObject({ chart: 'mostPopular', regionCode: 'VN', part: 'snippet', key: KEY });
    const s = new URL(searchUrl(KEY, 'a&b=c #d'));
    expect(s.pathname).toBe('/youtube/v3/search');
    expect(s.searchParams.get('q')).toBe('a&b=c #d'); // survives as ONE parameter
    expect(s.searchParams.get('type')).toBe('video');
    expect(new URL(detailsUrl(KEY, 'dQw4w9WgXcQ')).searchParams.get('id')).toBe('dQw4w9WgXcQ');
  });
  it('embed uses the privacy domain and refuses bad ids', () => {
    expect(embedUrl('dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&playsinline=1&rel=0');
    expect(embedUrl('dQw4w9WgXcQ', { autoplay: false })).toContain('autoplay=0');
    expect(() => embedUrl('../../x')).toThrow();
    expect(() => embedUrl('dQw4w9WgXcQ"onload="x')).toThrow();
    expect(watchUrl('dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(() => watchUrl('bad')).toThrow();
    expect(thumbUrl('dQw4w9WgXcQ')).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg');
  });
  it('decodes HTML entities in titles without touching anything else', () => {
    expect(decodeEntities('Tom &amp; Jerry &#39;hay&#39; &quot;nhất&quot; &lt;3 &#x1F600;')).toBe('Tom & Jerry \'hay\' "nhất" <3 😀');
    expect(decodeEntities('&unknown; &#99999999999; &amp;amp;')).toBe('&unknown; &#99999999999; &amp;');
    expect(decodeEntities(null)).toBe('');
  });
  it('parses both response shapes and drops malformed items', () => {
    const search = { items: [{ id: { videoId: 'dQw4w9WgXcQ' }, snippet: { title: 'A &amp; B', channelTitle: 'Kênh', publishedAt: '2026-01-01T00:00:00Z' } }, { id: { videoId: 'bad' } }, { id: { kind: 'youtube#channel' } }, null, { id: 5 }] };
    expect(parseVideos(search)).toEqual([{ id: 'dQw4w9WgXcQ', title: 'A & B', channel: 'Kênh', published: '2026-01-01T00:00:00Z' }]);
    expect(parseVideos({ items: [{ id: 'abcdefghijk', snippet: {} }] })).toEqual([{ id: 'abcdefghijk', title: 'Video', channel: '', published: '' }]);
    for (const junk of [null, {}, { items: 'x' }, []]) expect(parseVideos(junk)).toEqual([]);
    expect(parseVideos({ items: [{ id: 'abcdefghijk', snippet: { title: 'x'.repeat(500) } }] })[0].title.length).toBe(200);
  });
  it('explains API errors in plain Vietnamese', () => {
    expect(apiError(403, { error: { errors: [{ reason: 'quotaExceeded' }] } })).toMatch(/Hết lượt/);
    expect(apiError(400, { error: { errors: [{ reason: 'keyInvalid' }] } })).toMatch(/không đúng/);
    expect(apiError(403, { error: { errors: [{ reason: 'accessNotConfigured' }] } })).toMatch(/chưa bật/);
    expect(apiError(403, { error: { status: 'PERMISSION_DENIED' } })).toMatch(/Referrer/);
    expect(apiError(400, null)).toMatch(/không hợp lệ/);
    expect(apiError(500, null)).toBe('Lỗi từ YouTube (500)');
  });
  it('timeAgo', () => {
    const now = Date.parse('2026-11-06T12:00:00Z');
    expect(timeAgo('2026-11-06T11:59:50Z', now)).toBe('vừa xong');
    expect(timeAgo('2026-11-06T11:30:00Z', now)).toBe('30 phút trước');
    expect(timeAgo('2026-11-05T12:00:00Z', now)).toBe('1 ngày trước');
    expect(timeAgo('2024-11-06T12:00:00Z', now)).toBe('2 năm trước');
    expect(timeAgo('2099-01-01T00:00:00Z', now)).toBe('vừa xong'); // future dates never go negative
    expect(timeAgo('garbage', now)).toBe('');
  });
  it('finds the video id in links, embeds and bare ids; anything else is a search', () => {
    const id = 'dQw4w9WgXcQ';
    for (const t of [id, `https://youtu.be/${id}`, `youtube.com/watch?v=${id}&t=5`, `https://m.youtube.com/watch?v=${id}`, `https://music.youtube.com/watch?v=${id}`, `https://www.youtube.com/shorts/${id}`, `https://www.youtube-nocookie.com/embed/${id}`]) expect(videoIdFrom(t)).toBe(id);
    for (const t of ['nhạc sơn tùng', 'https://example.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=short', 'https://www.youtube.com/', '', 'https://www.youtube.com/watch?v=../../etc/passwd']) expect(videoIdFrom(t)).toBeNull();
  });
});
