export async function api(method, path, body) {
  const r = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(data.error || 'Request failed');
    e.status = r.status;
    throw e;
  }
  return data;
}

export const isConflict = (e) => e.status === 409;
