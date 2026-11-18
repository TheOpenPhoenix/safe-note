const enc = new TextEncoder();
const MAX_BODY = 1_600_000;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const fail = (status, error) => json({ error }, status);

const b64uDecode = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');

let jwksCache = { at: 0, keys: null };
async function getJwks(env) {
  if (jwksCache.keys && Date.now() - jwksCache.at < 3600_000) return jwksCache.keys;
  const r = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error('jwks');
  jwksCache = { at: Date.now(), keys: (await r.json()).keys };
  return jwksCache.keys;
}

export async function verifyAccess(request, env, now = Date.now()) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64uDecode(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(b64uDecode(parts[1])));
    if (header.alg !== 'RS256') return null;
    const jwk = (await getJwks(env)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64uDecode(parts[2]), enc.encode(parts[0] + '.' + parts[1]));
    if (!ok) return null;
    const aud = [].concat(payload.aud || []);
    if (!aud.includes(env.ACCESS_AUD)) return null;
    if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
    if (!payload.exp || payload.exp * 1000 < now) return null;
    return payload.sub || null;
  } catch { return null; }
}

export async function ownerOf(secret, sub) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode('safenote:owner:' + sub)));
}

async function readJson(request) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw fail(415, 'JSON only');
  const text = await request.text();
  if (text.length > MAX_BODY) throw fail(413, 'Too large');
  try { return JSON.parse(text); } catch { throw fail(400, 'Bad JSON'); }
}
const isId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{8,32}$/.test(s);
const isB64 = (s) => typeof s === 'string' && s.length < 1_500_000 && /^[A-Za-z0-9+/]+=*$/.test(s);

const nonNegInt = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);

async function getVault(db, owner) {
  const row = await db.prepare('SELECT key_blob, key_version, seq FROM users WHERE owner=?').bind(owner).first();
  return json(row ? { exists: true, key_blob: JSON.parse(row.key_blob), key_version: row.key_version, seq: row.seq } : { exists: false });
}

async function putVault(db, owner, request) {
  const b = await readJson(request);
  if (typeof b.key_blob !== 'object' || b.key_blob === null || Array.isArray(b.key_blob)) return fail(400, 'key_blob required');
  if (!Number.isSafeInteger(b.expect_version) || b.expect_version < 0) return fail(400, 'expect_version required');
  const blob = JSON.stringify(b.key_blob);
  if (blob.length > 4096) return fail(413, 'key_blob too large');
  if (b.expect_version === 0) {
    const r = await db.prepare('INSERT OR IGNORE INTO users(owner,key_blob,key_version,seq) VALUES(?,?,1,0)').bind(owner, blob).run();
    return r.meta.changes ? json({ key_version: 1 }) : fail(409, 'Vault already exists');
  }
  const r = await db.prepare('UPDATE users SET key_blob=?, key_version=key_version+1 WHERE owner=? AND key_version=?').bind(blob, owner, b.expect_version).run();
  if (!r.meta.changes) return fail(409, 'Key changed on another device; reload');
  return json({ key_version: b.expect_version + 1 });
}

async function listNotes(db, owner, url) {
  const since = Math.max(0, parseInt(url.searchParams.get('since') || '0', 10) || 0);
  const [u, rows] = await db.batch([
    db.prepare('SELECT seq FROM users WHERE owner=?').bind(owner),
    db.prepare('SELECT id, seq, iv, ct FROM notes WHERE owner=? AND seq>? ORDER BY seq').bind(owner, since),
  ]);
  if (!u.results.length) return fail(404, 'No vault');
  return json({ seq: u.results[0].seq, notes: rows.results });
}

async function writeNote(db, owner, id, iv, ct, baseSeq) {
  const [, ins] = await db.batch([
    db.prepare('UPDATE users SET seq=seq+1 WHERE owner=?').bind(owner),
    db.prepare(`INSERT INTO notes(owner,id,seq,iv,ct) SELECT ?1,?2,seq,?3,?4 FROM users WHERE owner=?1
                ON CONFLICT(owner,id) DO UPDATE SET seq=excluded.seq, iv=excluded.iv, ct=excluded.ct WHERE notes.seq<=?5`).bind(owner, id, iv, ct, baseSeq),
  ]);
  if (!ins.meta.changes) return fail(409, 'Note changed elsewhere');
  const s = await db.prepare('SELECT seq FROM notes WHERE owner=? AND id=?').bind(owner, id).first();
  return json({ seq: s.seq });
}

export async function handle(request, env, owner) {
  const url = new URL(request.url);
  const { pathname } = url;
  const m = request.method;
  const db = env.DB;

  if (pathname === '/api/vault' && m === 'GET') return getVault(db, owner);
  if (pathname === '/api/vault' && m === 'PUT') return putVault(db, owner, request);
  if (pathname === '/api/notes' && m === 'GET') return listNotes(db, owner, url);

  const nm = pathname.match(/^\/api\/notes\/([^/]+)$/);
  if (nm && (m === 'PUT' || m === 'DELETE')) {
    const id = nm[1];
    if (!isId(id)) return fail(400, 'Bad id');
    if (m === 'DELETE') return writeNote(db, owner, id, null, null, nonNegInt(Number(url.searchParams.get('base_seq'))));
    const b = await readJson(request);
    if (!isB64(b.iv) || !isB64(b.ct)) return fail(400, 'iv and ct required');
    return writeNote(db, owner, id, b.iv, b.ct, nonNegInt(b.base_seq));
  }
  if (pathname === '/api/account' && m === 'DELETE') {
    await db.batch([db.prepare('DELETE FROM notes WHERE owner=?').bind(owner), db.prepare('DELETE FROM users WHERE owner=?').bind(owner)]);
    return json({ ok: true });
  }
  return fail(404, 'Not found');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!env.OWNER_SECRET || (!env.DEV_SUB && (!env.ACCESS_AUD || !env.ACCESS_TEAM_DOMAIN))) return fail(500, 'Server not configured');
    if (request.method !== 'GET') {
      const origin = request.headers.get('Origin');
      if (origin !== url.origin) return fail(403, 'Bad origin');
    }
    const local = ['localhost', '127.0.0.1'].includes(url.hostname) && env.DEV_SUB;
    const sub = local ? env.DEV_SUB : await verifyAccess(request, env);
    if (!sub) return fail(401, 'Not signed in');
    try { return await handle(request, env, await ownerOf(env.OWNER_SECRET, sub)); }
    catch (e) { return e instanceof Response ? e : fail(500, 'Server error'); }
  },
};
