import { describe, it, expect } from 'vitest';
import { evaluate, formatResult, CalcError } from '../src/applications/calc-engine.js';
import { resolveInput, hostOf, isEmbedFriendly } from '../src/applications/url-utils.js';

const ev = (s) => evaluate(s);
const err = (s) => { try { evaluate(s); } catch (e) { if (e instanceof CalcError) return e.message; throw e; } return null; };

describe('calculator engine', () => {
  it('respects precedence, associativity and parentheses', () => {
    expect(ev('2+3*4')).toBe(14);
    expect(ev('(2+3)*4')).toBe(20);
    expect(ev('10-4-3')).toBe(3);
    expect(ev('100/10/5')).toBe(2);
    expect(ev('2^3^2')).toBe(512); // right associative
    expect(ev('-2^2')).toBe(4); // unary binds tighter, like most pocket calculators
    expect(ev('2*-3')).toBe(-6);
    expect(ev('--3')).toBe(3);
  });
  it('accepts × ÷ − symbols, decimal comma, spaces and exponents', () => {
    expect(ev('6 × 7')).toBe(42);
    expect(ev('9 ÷ 3 − 1')).toBe(2);
    expect(ev('1,5+1,5')).toBe(3);
    expect(ev('.5+.5')).toBe(1);
    expect(ev('1e3+1')).toBe(1001);
  });
  it('percent is /100', () => {
    expect(ev('50%')).toBe(0.5);
    expect(ev('200*10%')).toBe(20);
  });
  it('floating point output is tidy', () => {
    expect(formatResult(ev('0.1+0.2'))).toBe('0.3');
    expect(formatResult(ev('1/3'))).toBe('0.333333333333');
    expect(formatResult(1e21)).toBe('1e+21');
    expect(formatResult(0)).toBe('0');
    expect(formatResult(NaN)).toBe('Lỗi');
    expect(formatResult(-12.5)).toBe('-12.5');
  });
  it('reports errors in Vietnamese instead of throwing weird exceptions', () => {
    expect(err('1/0')).toBe('Chia cho 0');
    expect(err('')).toBe('Trống');
    expect(err('2+')).toMatch(/chưa đầy đủ/);
    expect(err('(2+3')).toMatch(/Thiếu dấu \)/);
    expect(err('2+3)')).toMatch(/không hợp lệ/);
    expect(err('abc')).toMatch(/không hợp lệ/);
    expect(err('9^9^9^9')).toMatch(/quá lớn/);
    expect(err('1..2')).toMatch(/không hợp lệ/);
  });
  it('code can never be injected', () => {
    for (const bad of ['alert(1)', 'process.exit()', '1;2', '"x"', '[1]', '{}', 'constructor', '`1`', '1+__proto__']) expect(err(bad)).not.toBeNull();
  });
  it('limits length and nesting so it cannot hang or overflow the stack', () => {
    expect(err('1+'.repeat(150) + '1')).toMatch(/quá dài/);
    expect(err('('.repeat(60) + '1' + ')'.repeat(60))).toMatch(/lồng nhau/);
    expect(ev('('.repeat(30) + '7' + ')'.repeat(30))).toBe(7);
  });
});

describe('address bar', () => {
  it('empty input and internal pages', () => {
    expect(resolveInput('')).toEqual({ type: 'void', page: 'newtab' });
    expect(resolveInput('void://bookmarks')).toEqual({ type: 'void', page: 'bookmarks' });
    expect(resolveInput('void://evil').type).toBe('invalid');
  });
  it('urls: https kept, http upgraded, bare domains completed', () => {
    expect(resolveInput('https://example.com/a?b=1')).toEqual({ type: 'web', url: 'https://example.com/a?b=1' });
    expect(resolveInput('http://example.com').url).toBe('https://example.com/');
    expect(resolveInput('vi.wikipedia.org/wiki/Hà_Nội').url).toMatch(/^https:\/\/vi\.wikipedia\.org\/wiki\//);
    expect(resolveInput('example.com:8080/x').url).toBe('https://example.com:8080/x');
    expect(resolveInput('localhost:3000')).toMatchObject({ type: 'web', search: true }); // no dot: treated as a search, not a scheme
  });
  it('dangerous or unsupported schemes are refused', () => {
    for (const s of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'file:///etc/passwd', 'blob:abc', 'ftp://x.com', 'chrome://settings', 'JaVaScRiPt:alert(1)']) {
      expect(resolveInput(s).type).toBe('invalid');
    }
  });
  it('credentials in the url (phishing trick) are refused', () => {
    expect(resolveInput('https://google.com@evil.com/').type).toBe('invalid');
    expect(resolveInput('https://user:pw@example.com').type).toBe('invalid');
  });
  it('YouTube links become the official embed player; bad ids are rejected', () => {
    const id = 'dQw4w9WgXcQ';
    for (const u of [`https://www.youtube.com/watch?v=${id}`, `https://youtu.be/${id}`, `https://m.youtube.com/watch?v=${id}&t=10`, `https://www.youtube.com/shorts/${id}`, `youtube.com/embed/${id}`]) {
      expect(resolveInput(u)).toEqual({ type: 'web', url: `https://www.youtube-nocookie.com/embed/${id}`, embed: true });
    }
    expect(resolveInput('https://www.youtube.com/watch?v=short').type).toBe('invalid');
    expect(resolveInput('https://www.youtube.com/watch?v=../../x').type).toBe('invalid');
    expect(resolveInput('https://www.youtube.com/').type).toBe('web'); // home page: no id, loaded as is
  });
  it('plain text is a search: Wikipedia in the page, other engines in a real tab', () => {
    const w = resolveInput('thời tiết hà nội');
    expect(w).toMatchObject({ type: 'web', search: true });
    expect(w.url).toBe(`https://vi.wikipedia.org/w/index.php?search=${encodeURIComponent('thời tiết hà nội')}`);
    const g = resolveInput('a&b=c d', 'google');
    expect(g.type).toBe('external');
    expect(g.url).toBe('https://www.google.com/search?q=a%26b%3Dc%20d');
    expect(resolveInput('x', 'unknown-engine').type).toBe('web'); // falls back to the default engine
  });
  it('local files', () => {
    expect(resolveInput('vfs:///home/user/a.html')).toEqual({ type: 'file', path: '/home/user/a.html' });
    expect(resolveInput('/home/user/a.html')).toEqual({ type: 'file', path: '/home/user/a.html' });
  });
  it('helpers', () => {
    expect(hostOf('https://www.example.com/x')).toBe('example.com');
    expect(hostOf('garbage')).toBe('garbage');
    expect(isEmbedFriendly('https://vi.wikipedia.org/')).toBe(true);
    expect(isEmbedFriendly('https://www.youtube-nocookie.com/embed/x')).toBe(true);
    expect(isEmbedFriendly('https://google.com/')).toBe(false);
  });
});
