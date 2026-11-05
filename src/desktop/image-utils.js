export const IMAGE_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' };
export const imageExt = (p) => { const b = p.split('/').pop(); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
export const isImageFile = (p) => Object.prototype.hasOwnProperty.call(IMAGE_EXT, imageExt(p));

export function readAsBytes(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result));
    r.onerror = () => reject(new Error('Không đọc được tệp'));
    r.readAsArrayBuffer(file);
  });
}

const extFromType = (t) => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg' }[t] ?? '');

// Photos from a phone are often 5-10 MB: shrink to maxSide and re-encode as JPEG so they fit the virtual disk.
export async function processImageFile(file, { maxSide = 1600, quality = 0.86 } = {}) {
  const raw = await readAsBytes(file);
  const ext = extFromType(file.type) || imageExt(file.name ?? '');
  if (!IMAGE_EXT[ext]) throw new Error(`${file.name ?? 'Tệp'}: không phải ảnh được hỗ trợ`);
  if (ext === 'svg' || ext === 'gif' || typeof createImageBitmap !== 'function') return { bytes: raw, ext }; // keep animations / vectors untouched
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { return { bytes: raw, ext }; }
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  if (scale === 1 && raw.length <= 700_000) { bmp.close?.(); return { bytes: raw, ext }; }
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext('2d');
  if (!ctx) { bmp.close?.(); return { bytes: raw, ext }; }
  ctx.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', quality));
  if (!blob) return { bytes: raw, ext };
  return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'jpg' };
}

export function bytesToDataUrl(bytes, mime) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}
