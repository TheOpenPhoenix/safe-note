const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = globalThis.crypto.subtle;
export const DEFAULT_ITERATIONS = 600_000;

export const b64 = (buf) => {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

async function passphraseKey(pass, salt, iterations) {
  const base = await subtle.importKey('raw', enc.encode(pass.normalize('NFKC')), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function encodeRecoveryKey(bytes) {
  let bits = 0,
    val = 0,
    out = '';
  for (const byte of bytes) {
    val = (val << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(val >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out.match(/.{1,4}/g).join('-');
}
export function decodeRecoveryKey(str) {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0,
    val = 0;
  const out = [];
  for (const ch of clean) {
    val = (val << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  if (out.length !== 32) throw new Error('Recovery key has the wrong length');
  return new Uint8Array(out);
}
const recoveryKeyFromBytes = (bytes) =>
  subtle.importKey('raw', bytes, 'AES-GCM', false, ['wrapKey', 'unwrapKey']);

async function wrap(dek, kek) {
  const iv = rand(12);
  const w = await subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv });
  return { iv: b64(iv), w: b64(w) };
}
const unwrap = (o, kek) =>
  subtle.unwrapKey(
    'raw',
    unb64(o.w),
    kek,
    { name: 'AES-GCM', iv: unb64(o.iv) },
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );

const unwrapForRewrap = (o, kek) =>
  subtle.unwrapKey(
    'raw',
    unb64(o.w),
    kek,
    { name: 'AES-GCM', iv: unb64(o.iv) },
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );

export async function createVault(passphrase, iterations = DEFAULT_ITERATIONS) {
  const dekRaw = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const salt = rand(16);
  const recBytes = rand(32);
  const kek = await passphraseKey(passphrase, salt, iterations);
  const pw = await wrap(dekRaw, kek);
  const rec = await wrap(dekRaw, await recoveryKeyFromBytes(recBytes));
  const blob = { v: 1, kdf: 'PBKDF2-SHA256', iter: iterations, salt: b64(salt), pw, rec };
  return { blob, dek: await unwrap(pw, kek), recoveryKey: encodeRecoveryKey(recBytes) };
}
export async function unlockWithPassphrase(blob, passphrase) {
  try {
    return await unwrap(blob.pw, await passphraseKey(passphrase, unb64(blob.salt), blob.iter));
  } catch {
    throw new Error('Wrong passphrase');
  }
}
export async function unlockWithRecoveryKey(blob, recoveryKey) {
  try {
    return await unwrap(blob.rec, await recoveryKeyFromBytes(decodeRecoveryKey(recoveryKey)));
  } catch {
    throw new Error('Wrong recovery key');
  }
}
export async function rewrapPassphrase(
  blob,
  { passphrase, recoveryKey },
  newPassphrase,
  iterations = DEFAULT_ITERATIONS,
) {
  const kek = recoveryKey
    ? await recoveryKeyFromBytes(decodeRecoveryKey(recoveryKey))
    : await passphraseKey(passphrase, unb64(blob.salt), blob.iter);
  const src = recoveryKey ? blob.rec : blob.pw;
  let dek;
  try {
    dek = await unwrapForRewrap(src, kek);
  } catch {
    throw new Error('Current passphrase / recovery key is wrong');
  }
  const salt = rand(16);
  const pw = await wrap(dek, await passphraseKey(newPassphrase, salt, iterations));
  return { ...blob, iter: iterations, salt: b64(salt), pw };
}

const aad = (id) => enc.encode('safenote:note:' + id);

const BUCKETS = [1024, 4096, 16384, 65536, 262144, 1048576];
function pad(bytes) {
  const need = bytes.length + 4;
  const size = BUCKETS.find((b) => b >= need) ?? Math.ceil(need / 1048576) * 1048576;
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, bytes.length);
  out.set(bytes, 4);
  return out;
}
const unpad = (out) => out.subarray(4, 4 + new DataView(out.buffer, out.byteOffset).getUint32(0));

export async function encryptNote(dek, id, obj) {
  const iv = rand(12);
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(id) },
    dek,
    pad(enc.encode(JSON.stringify(obj))),
  );
  return { iv: b64(iv), ct: b64(ct) };
}
export async function decryptNote(dek, id, { iv, ct }) {
  const pt = await subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(iv), additionalData: aad(id) },
    dek,
    unb64(ct),
  );
  return JSON.parse(dec.decode(unpad(new Uint8Array(pt))));
}
export const newId = () => b64(rand(12)).replace(/\+/g, '-').replace(/\//g, '_');

export async function rotateRecoveryKey(blob, passphrase) {
  let dek;
  try {
    dek = await unwrapForRewrap(blob.pw, await passphraseKey(passphrase, unb64(blob.salt), blob.iter));
  } catch {
    throw new Error('Wrong passphrase');
  }
  const recBytes = rand(32);
  return {
    blob: { ...blob, rec: await wrap(dek, await recoveryKeyFromBytes(recBytes)) },
    recoveryKey: encodeRecoveryKey(recBytes),
  };
}
