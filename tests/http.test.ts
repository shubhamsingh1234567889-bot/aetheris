import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchJson } from '../server/lib/http.js';
import { UpstreamError } from '../server/lib/errors.js';

function serve(handler: http.RequestListener): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const s = http.createServer(handler).listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => s.close(() => r())) });
    });
  });
}

test('fetchJson retries 5xx then succeeds', async () => {
  let hits = 0;
  const srv = await serve((_req, res) => {
    hits++;
    if (hits < 3) { res.statusCode = 503; return void res.end('busy'); }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
  });
  try {
    const out = await fetchJson<{ ok: boolean }>(srv.url, { service: 't-retry', retries: 2 });
    assert.deepEqual(out, { ok: true });
    assert.equal(hits, 3);
  } finally { await srv.close(); }
});

test('fetchJson does not retry 4xx and wraps it as UpstreamError', async () => {
  let hits = 0;
  const srv = await serve((_req, res) => { hits++; res.statusCode = 400; res.end('bad'); });
  try {
    await assert.rejects(fetchJson(srv.url, { service: 't-4xx', retries: 3 }), (e) => e instanceof UpstreamError);
    assert.equal(hits, 1);
  } finally { await srv.close(); }
});

test('fetchJson times out, and the breaker opens after repeated failures', async () => {
  let hits = 0;
  const srv = await serve(() => { hits++; /* never respond */ });
  try {
    for (let i = 0; i < 5; i++) {
      await assert.rejects(fetchJson(srv.url, { service: 't-breaker', retries: 0, timeoutMs: 50 }));
    }
    const before = hits;
    await assert.rejects(
      fetchJson(srv.url, { service: 't-breaker', retries: 0, timeoutMs: 50 }),
      /circuit open/,
    );
    assert.equal(hits, before, 'open circuit must not hit the upstream');
  } finally { await srv.close(); }
});

test('fetchJson sends JSON body and headers on POST', async () => {
  let seen = '';
  let auth = '';
  const srv = await serve((req, res) => {
    auth = String(req.headers['x-api-key']);
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { seen = b; res.end('{"done":1}'); });
  });
  try {
    await fetchJson(srv.url, { service: 't-post', method: 'POST', body: { a: 1 }, headers: { 'X-API-Key': 'k' } });
    assert.equal(seen, '{"a":1}');
    assert.equal(auth, 'k');
  } finally { await srv.close(); }
});
