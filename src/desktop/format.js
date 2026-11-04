export const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const fmtTime = (ms) => new Date(ms).toLocaleString('vi-VN');
export const fmtUptime = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
export const baseName = (p) => p.split('/').filter(Boolean).pop() ?? '/';
export const dirName = (p) => `/${p.split('/').filter(Boolean).slice(0, -1).join('/')}`;
export const PROTECTED = ['/', '/boot', '/bin', '/etc', '/home', '/home/user', '/tmp', '/apps'];
