// Realm-safe check (a plain `instanceof Uint8Array` fails for arrays made in another realm, e.g. jsdom or an iframe).
export const isBytes = (x) => ArrayBuffer.isView(x) && Object.prototype.toString.call(x) === '[object Uint8Array]';
