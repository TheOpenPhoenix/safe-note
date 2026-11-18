import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker, { handle, ownerOf, verifyAccess } from '../src/worker.js';

function fakeD1() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  sql.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    first: async () => sql.prepare(q).get(...args) ?? null,
    run: async () => ({ meta: { changes: Number(sql.prepare(q).run(...args).changes) } }),
    all: async () => ({ results: sql.prepare(q).all(...args) }),
    _exec: () => (/^\s*select/i.test(q) ? { results: sql.prepare(q).all(...args) } : { meta: { changes: Number(sql.prepare(q).run(...args).changes) } }),
  });
  return { prepare: (q) => stmt(q), batch: async (list) => list.map((s) => s._exec()), sql };
}

const req = (method, path, body) => new Request('https://app.test' + path, {
  method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
});
const call = async (env, owner, ...a) => { const r = await handle(req(...a), env, owner); return [r.status, await r.json()]; };
const B64 = 'AAAAAAAAAAAAAAAA';

test('vault create, update with version guard, and stale write refused', async () => {
  const env = { DB: fakeD1() };
  assert.deepEqual((await call(env, 'o1', 'GET', '/api/vault'))[1], { exists: false });
  assert.equal((await call(env, 'o1', 'PUT', '/api/vault', { key_blob: { a: 1 }, expect_version: 0 }))[0], 200);
  assert.equal((await call(env, 'o1', 'PUT', '/api/vault', { key_blob: { a: 1 }, expect_version: 0 }))[0], 409, 'cannot create twice');
  assert.deepEqual((await call(env, 'o1', 'PUT', '/api/vault', { key_blob: { a: 2 }, expect_version: 1 }))[1], { key_version: 2 });
  assert.equal((await call(env, 'o1', 'PUT', '/api/vault', { key_blob: { a: 3 }, expect_version: 1 }))[0], 409, 'stale version');
  assert.equal((await call(env, 'o1', 'PUT', '/api/vault', { key_blob: { a: 3 }, expect_version: '1' }))[0], 400);
  assert.equal((await call(env, 'o1', 'PUT', '/api/vault', { key_blob: [] , expect_version: 2 }))[0], 400);
});

test('notes: sync order, conflict detection, tombstones, per-owner isolation', async () => {
  const env = { DB: fakeD1() };
  for (const o of ['o1', 'o2']) await call(env, o, 'PUT', '/api/vault', { key_blob: {}, expect_version: 0 });
  const put = (o, id, base) => call(env, o, 'PUT', `/api/notes/${id}`, { iv: B64, ct: B64, base_seq: base });

  assert.deepEqual((await put('o1', 'note-0001', 0))[1], { seq: 1 });
  assert.deepEqual((await put('o1', 'note-0002', 0))[1], { seq: 2 });
  assert.equal((await put('o1', 'note-0001', 0))[0], 409, 'stale base_seq is refused');
  assert.deepEqual((await put('o1', 'note-0001', 1))[1], { seq: 4 }, 'refused write still burns a seq; fine, seq only orders');

  const [, since2] = await call(env, 'o1', 'GET', '/api/notes?since=2');
  assert.deepEqual(since2.notes.map((n) => n.id), ['note-0001']);

  const [st, del] = await call(env, 'o1', 'DELETE', '/api/notes/note-0002?base_seq=2');
  assert.equal(st, 200);
  const [, all] = await call(env, 'o1', 'GET', '/api/notes?since=0');
  const tomb = all.notes.find((n) => n.id === 'note-0002');
  assert.equal(tomb.ct, null, 'deleted note keeps only a tombstone');
  assert.equal(tomb.seq, del.seq);

  assert.equal((await call(env, 'o2', 'GET', '/api/notes?since=0'))[1].notes.length, 0, 'other owner sees nothing');
  assert.equal((await call(env, 'ghost', 'GET', '/api/notes'))[0], 404, 'no vault');
  assert.equal((await put('ghost', 'note-0009', 0))[0], 409, 'cannot write without a vault');
});

test('input validation', async () => {
  const env = { DB: fakeD1() };
  await call(env, 'o1', 'PUT', '/api/vault', { key_blob: {}, expect_version: 0 });
  assert.equal((await call(env, 'o1', 'PUT', '/api/notes/x', { iv: B64, ct: B64 }))[0], 400, 'short id');
  assert.equal((await call(env, 'o1', 'PUT', '/api/notes/note-0001', { iv: 'not base64!', ct: B64 }))[0], 400);
  assert.equal((await call(env, 'o1', 'PUT', '/api/notes/note-0001', { iv: B64, ct: B64, base_seq: -5 }))[0], 200, 'negative base treated as 0');
  assert.equal((await call(env, 'o1', 'GET', '/api/nope'))[0], 404);
});

test('account deletion hard-deletes vault and notes', async () => {
  const env = { DB: fakeD1() };
  await call(env, 'o1', 'PUT', '/api/vault', { key_blob: {}, expect_version: 0 });
  await call(env, 'o1', 'PUT', '/api/notes/note-0001', { iv: B64, ct: B64, base_seq: 0 });
  await call(env, 'o1', 'DELETE', '/api/account');
  assert.equal(env.DB.sql.prepare('SELECT count(*) c FROM notes').get().c, 0);
  assert.equal(env.DB.sql.prepare('SELECT count(*) c FROM users').get().c, 0);
});

test('owner fingerprint is a stable HMAC and never contains the user id', async () => {
  const a = await ownerOf('secret', 'user-1');
  assert.equal(a, await ownerOf('secret', 'user-1'));
  assert.notEqual(a, await ownerOf('secret', 'user-2'));
  assert.notEqual(a, await ownerOf('other', 'user-1'));
  assert.match(a, /^[0-9a-f]{64}$/);
});

const b64u = (buf) => Buffer.from(buf).toString('base64url');
async function makeAccess(overrides = {}, header = {}) {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1' };
  const env = { ACCESS_TEAM_DOMAIN: 'team.example.com', ACCESS_AUD: 'aud123' };
  const sign = async (payload, hdr = { alg: 'RS256', kid: 'k1', ...header }) => {
    const head = b64u(JSON.stringify(hdr)) + '.' + b64u(JSON.stringify(payload));
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(head));
    return head + '.' + b64u(sig);
  };
  const good = { sub: 'user-1', aud: ['aud123'], iss: 'https://team.example.com', exp: Math.floor(Date.now() / 1000) + 600, ...overrides };
  return { env, jwk, token: await sign(good), sign, good };
}
const withJwks = async (jwk, fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [jwk] }));
  try { return await fn(); } finally { globalThis.fetch = real; }
};
const reqWith = (token) => new Request('https://app.test/api/vault', { headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {} });

test('verifyAccess accepts a valid token and rejects bad ones', async () => {
  const { env, jwk, token, sign, good } = await makeAccess();
  await withJwks(jwk, async () => {
    assert.equal(await verifyAccess(reqWith(token), env), 'user-1');
    assert.equal(await verifyAccess(reqWith(null), env), null, 'missing header');
    assert.equal(await verifyAccess(reqWith(token.slice(0, -4) + 'AAAA'), env), null, 'bad signature');
    assert.equal(await verifyAccess(reqWith(await sign({ ...good, aud: ['other'] })), env), null, 'wrong audience');
    assert.equal(await verifyAccess(reqWith(await sign({ ...good, iss: 'https://evil.example' })), env), null, 'wrong issuer');
    assert.equal(await verifyAccess(reqWith(await sign({ ...good, exp: 1 })), env), null, 'expired');
    assert.equal(await verifyAccess(reqWith(await sign(good, { alg: 'none', kid: 'k1' })), env), null, 'alg must be RS256');
  });
});

test('worker rejects cross-origin writes and unauthenticated calls', async () => {
  const env = { OWNER_SECRET: 's', ACCESS_AUD: 'a', ACCESS_TEAM_DOMAIN: 't.example.com', DB: fakeD1() };
  const post = new Request('https://app.test/api/vault', { method: 'PUT', headers: { Origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' });
  assert.equal((await worker.fetch(post, env)).status, 403);
  assert.equal((await worker.fetch(new Request('https://app.test/api/vault'), env)).status, 401);
  assert.equal((await worker.fetch(new Request('https://app.test/api/vault'), { ...env, OWNER_SECRET: '' })).status, 500);
});

test('DEV_SUB only works on localhost', async () => {
  const env = { OWNER_SECRET: 's', DEV_SUB: 'dev', DB: fakeD1() };
  assert.equal((await worker.fetch(new Request('http://localhost:8787/api/vault'), env)).status, 200);
  assert.equal((await worker.fetch(new Request('https://app.example.com/api/vault'), env)).status, 401);
});
