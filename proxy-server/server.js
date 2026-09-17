import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const AIHUBMIX_API_URL = process.env.AIHUBMIX_API_URL || 'https://aihubmix.com/v1/messages';
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES) || 5 * 1024 * 1024;
const MAX_REQUESTS_PER_WINDOW = Number(process.env.MAX_REQUESTS_PER_WINDOW) || 12;
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000;
const MAX_TOKENS = Number(process.env.PROXY_MAX_TOKENS) || 8000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://inosi4224-spec.github.io,http://localhost:8080,http://127.0.0.1:8080')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function loadDotEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv();

const app = express();

app.use(cors({
  origin(origin, callback) {
    // Non-browser health checks/curl have no Origin. The API itself still has rate limits;
    // browser callers are restricted to the configured frontend origins by CORS.
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'anthropic-version', 'anthropic-beta'],
  exposedHeaders: ['request-id'],
}));
app.use(express.json({ limit: MAX_BODY_BYTES }));

const rateBuckets = new Map();
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}
function checkRateLimit(req) {
  const now = Date.now();
  const ip = getClientIp(req);
  let bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.startedAt >= RATE_LIMIT_WINDOW_MS) {
    bucket = { startedAt: now, count: 0 };
    rateBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  const retryAfter = Math.max(1, Math.ceil((bucket.startedAt + RATE_LIMIT_WINDOW_MS - now) / 1000));
  return { allowed: bucket.count <= MAX_REQUESTS_PER_WINDOW, retryAfter, count: bucket.count };
}
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS * 2;
  for (const [ip, bucket] of rateBuckets) {
    if (bucket.startedAt < cutoff) rateBuckets.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

function apiError(message, type = 'api_error') {
  return { type: 'error', error: { type, message } };
}

function sanitizeBody(body) {
  const copy = { ...body };
  const requested = Number(copy.max_tokens);
  if (Number.isFinite(requested) && requested > MAX_TOKENS) copy.max_tokens = MAX_TOKENS;
  if (!Number.isFinite(requested) || requested <= 0) copy.max_tokens = MAX_TOKENS;
  return copy;
}

app.get('/', (_req, res) => {
  res.json({ ok: true, message: 'meiting-chat secure AI proxy is running. POST to /v1/messages.' });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/v1/messages', async (req, res) => {
  const apiKey = process.env.AIHUBMIX_API_KEY;
  if (!apiKey) {
    res.status(500).json(apiError('AIHUBMIX_API_KEY is not configured on the server.'));
    return;
  }

  const limit = checkRateLimit(req);
  res.setHeader('X-RateLimit-Limit', String(MAX_REQUESTS_PER_WINDOW));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, MAX_REQUESTS_PER_WINDOW - limit.count)));
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfter));
    res.status(429).json(apiError(`Too many requests. Please retry in ${limit.retryAfter} seconds.`, 'rate_limit_error'));
    return;
  }

  const body = req.body || {};
  if (!body.model || !Array.isArray(body.messages)) {
    res.status(400).json(apiError('Request must include model and messages.'));
    return;
  }

  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  const headers = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': req.get('anthropic-version') || '2023-06-01',
  };
  const beta = req.get('anthropic-beta');
  if (beta) headers['anthropic-beta'] = beta;

  try {
    const upstream = await fetch(AIHUBMIX_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(sanitizeBody(body)),
      signal: controller.signal,
    });

    res.status(upstream.status);
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('content-type', contentType);
    const cacheControl = upstream.headers.get('cache-control');
    if (cacheControl) res.setHeader('cache-control', cacheControl);
    const requestId = upstream.headers.get('request-id');
    if (requestId) res.setHeader('request-id', requestId);

    if (!upstream.body) {
      res.send(await upstream.text());
      return;
    }
    for await (const chunk of upstream.body) res.write(chunk);
    res.end();
  } catch (err) {
    if (controller.signal.aborted) return;
    if (!res.headersSent) res.status(502).json(apiError(`Failed to reach AIHubMix: ${err.message}`));
    else res.end();
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError) return res.status(400).json(apiError('Invalid JSON body.'));
  if (err && err.message === 'Origin not allowed') return res.status(403).json(apiError('Origin not allowed.'));
  if (err && err.type === 'entity.too.large') return res.status(413).json(apiError('Request body is too large.'));
  console.error('Proxy error:', err);
  return res.status(500).json(apiError('Proxy server error.'));
});

app.listen(PORT, HOST, () => {
  console.log(`meiting-chat secure proxy listening on http://${HOST}:${PORT}/v1/messages`);
  console.log(`AI upstream: ${AIHUBMIX_API_URL}`);
  console.log(`Allowed browser origins: ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`Rate limit: ${MAX_REQUESTS_PER_WINDOW} requests / ${RATE_LIMIT_WINDOW_MS}ms per IP`);
  console.log(process.env.AIHUBMIX_API_KEY ? 'AIHubMix key loaded on server.' : 'WARNING: AIHUBMIX_API_KEY is not configured.');
});
