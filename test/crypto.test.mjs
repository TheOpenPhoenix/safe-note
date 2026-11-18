import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../public/crypto.js';

const FAST = 1000;

test('passphrase and recovery key both unlock; wrong ones fail', async () => {
  const { blob, dek, recoveryKey } = await C.createVault('correct horse battery staple', FAST);
  const enc = await C.encryptNote(dek, 'abc12345', { title: 'hi' });
  const viaPass = await C.unlockWithPassphrase(blob, 'correct horse battery staple');
  const viaRec = await C.unlockWithRecoveryKey(blob, recoveryKey);
  assert.deepEqual(await C.decryptNote(viaPass, 'abc12345', enc), { title: 'hi' });
  assert.deepEqual(await C.decryptNote(viaRec, 'abc12345', enc), { title: 'hi' });
  await assert.rejects(C.unlockWithPassphrase(blob, 'wrong'), /Wrong passphrase/);
  await assert.rejects(
    C.unlockWithRecoveryKey(blob, 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA'),
    /Wrong recovery key|wrong length/,
  );
});

test('unwrapped data key is not extractable', async () => {
  const { dek } = await C.createVault('pw-pw-pw-pw-pw', FAST);
  await assert.rejects(crypto.subtle.exportKey('raw', dek));
});

test('ciphertext is bound to note id and padded to buckets', async () => {
  const { dek } = await C.createVault('pw-pw-pw-pw-pw', FAST);
  const a = await C.encryptNote(dek, 'note-aaaa', { body: 'x' });
  const b = await C.encryptNote(dek, 'note-aaaa', { body: 'x'.repeat(500) });
  assert.equal(a.ct.length, b.ct.length, 'short and 500-char notes look the same size');
  await assert.rejects(C.decryptNote(dek, 'note-bbbb', a), 'swapping rows between ids must fail');
  const big = await C.encryptNote(dek, 'note-aaaa', { body: 'x'.repeat(3000) });
  assert.ok(big.ct.length > a.ct.length);
  assert.equal((await C.decryptNote(dek, 'note-aaaa', big)).body.length, 3000);
});

test('unicode round trip and tamper detection', async () => {
  const { dek } = await C.createVault('pw-pw-pw-pw-pw', FAST);
  const n = { title: 'Zażółć 🔐', body: '日本語' };
  const e = await C.encryptNote(dek, 'uni-12345', n);
  assert.deepEqual(await C.decryptNote(dek, 'uni-12345', e), n);
  const raw = C.unb64(e.ct);
  raw[5] ^= 1;
  await assert.rejects(C.decryptNote(dek, 'uni-12345', { iv: e.iv, ct: C.b64(raw) }));
});

test('change passphrase keeps notes readable; recovery key still works', async () => {
  const { blob, dek, recoveryKey } = await C.createVault('old-old-old-old', FAST);
  const e = await C.encryptNote(dek, 'chg-12345', { t: 1 });
  const blob2 = await C.rewrapPassphrase(blob, { passphrase: 'old-old-old-old' }, 'new-new-new-new', FAST);
  await assert.rejects(C.unlockWithPassphrase(blob2, 'old-old-old-old'));
  assert.deepEqual(
    await C.decryptNote(await C.unlockWithPassphrase(blob2, 'new-new-new-new'), 'chg-12345', e),
    { t: 1 },
  );
  assert.deepEqual(await C.decryptNote(await C.unlockWithRecoveryKey(blob2, recoveryKey), 'chg-12345', e), {
    t: 1,
  });
  await assert.rejects(C.rewrapPassphrase(blob, { passphrase: 'nope' }, 'x', FAST));
});

test('rotate recovery key invalidates the old one', async () => {
  const { blob, recoveryKey } = await C.createVault('pw-pw-pw-pw-pw', FAST);
  const r = await C.rotateRecoveryKey(blob, 'pw-pw-pw-pw-pw');
  await C.unlockWithRecoveryKey(r.blob, r.recoveryKey);
  await assert.rejects(C.unlockWithRecoveryKey(r.blob, recoveryKey));
});

test('recovery key encoding round trips', () => {
  const b = crypto.getRandomValues(new Uint8Array(32));
  assert.deepEqual(C.decodeRecoveryKey(C.encodeRecoveryKey(b)), b);
});
