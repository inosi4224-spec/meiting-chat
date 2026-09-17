const DEFAULT_UPSTREAM = 'https://aihubmix.com/v1/messages';
const DEFAULT_ALLOWED_ORIGINS = [
  'https://inosi4224-spec.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_REQUESTS_PER_WINDOW = 12;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_MAX_TOKENS = 8000;

// Lightweight per-isolate rate limiter. This is intentionally conservative.
// Cloudflare may run multiple isolates, so this is not a global quota system.
const rateBuckets = new Map();

function getAllowedOrigins(env) {
  const raw = String(env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','));
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function isAllowedOrigin(origin, env) {
  return Boolean(origin && getAllowedOrigins(env).includes(origin));
}

function corsHeaders(origin, env) {
  const allowed = isAllowedOrigin(origin, env);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : '',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, anthropic-version, anthropic-beta',
    'Access-Control-Expose-Headers': 'request-id, x-ratelimit-limit, x-ratelimit-remaining, retry-after',
    'Vary': 'Origin',
  };
}

function jsonResponse(payload, status, origin, env, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(origin, env),
    ...extraHeaders,
  };
  if (!headers['Access-Control-Allow-Origin']) delete headers['Access-Control-Allow-Origin'];
  return new Response(JSON.stringify(payload), { status, headers });
}

function apiError(message, type = 'api_error') {
  return { type: 'error', error: { type, message } };
}

function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown';
}

function checkRateLimit(request, env) {
  const now = Date.now();
  const limit = Number(env.MAX_REQUESTS_PER_WINDOW) || DEFAULT_MAX_REQUESTS_PER_WINDOW;
  const windowMs = Number(env.RATE_LIMIT_WINDOW_MS) || DEFAULT_RATE_LIMIT_WINDOW_MS;
  const ip = getClientIp(request);

  let bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.startedAt >= windowMs) {
    bucket = { startedAt: now, count: 0 };
    rateBuckets.set(ip, bucket);
  }

  bucket.count += 1;
  const retryAfter = Math.max(1, Math.ceil((bucket.startedAt + windowMs - now) / 1000));
  return {
    allowed: bucket.count <= limit,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfter,
  };
}

function sanitizeBody(body, env) {
  const copy = { ...body };
  const maxTokens = Number(env.PROXY_MAX_TOKENS) || DEFAULT_MAX_TOKENS;
  const requested = Number(copy.max_tokens);

  if (!Number.isFinite(requested) || requested <= 0 || requested > maxTokens) {
    copy.max_tokens = maxTokens;
  }

  return copy;
}

async function readJsonWithLimit(request) {
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    throw Object.assign(new Error('Request body is too large.'), { status: 413 });
  }

  const raw = await request.text();
  const byteLength = new TextEncoder().encode(raw).byteLength;
  if (byteLength > MAX_BODY_BYTES) {
    throw Object.assign(new Error('Request body is too large.'), { status: 413 });
  }

  try {
    return JSON.parse(raw || '{}');
  } catch {
    throw Object.assign(new Error('Invalid JSON body.'), { status: 400 });
  }
}

async function handle(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');

  if (request.method === 'OPTIONS') {
    if (!isAllowedOrigin(origin, env)) {
      return new Response(null, { status: 403 });
    }
    return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    return jsonResponse({ ok: true }, 200, origin, env);
  }

  if (request.method === 'GET' && url.pathname === '/') {
    return jsonResponse({
      ok: true,
      message: 'meiting-chat secure AI proxy is running. POST to /v1/messages.',
    }, 200, origin, env);
  }

  if (url.pathname !== '/v1/messages') {
    return jsonResponse(apiError('Not found.', 'not_found'), 404, origin, env);
  }

  if (request.method !== 'POST') {
    return jsonResponse(apiError('Method not allowed.', 'method_not_allowed'), 405, origin, env);
  }

  if (!isAllowedOrigin(origin, env)) {
    return jsonResponse(apiError('Origin not allowed.', 'forbidden'), 403, origin, env);
  }

  const apiKey = env.AIHUBMIX_API_KEY;
  if (!apiKey) {
    return jsonResponse(apiError('AIHUBMIX_API_KEY is not configured on the server.'), 500, origin, env);
  }

  const rate = checkRateLimit(request, env);
  const rateHeaders = {
    'X-RateLimit-Limit': String(rate.limit),
    'X-RateLimit-Remaining': String(rate.remaining),
  };

  if (!rate.allowed) {
    return jsonResponse(
      apiError(`Too many requests. Please retry in ${rate.retryAfter} seconds.`, 'rate_limit_error'),
      429,
      origin,
      env,
      { ...rateHeaders, 'Retry-After': String(rate.retryAfter) },
    );
  }

  let body;
  try {
    body = await readJsonWithLimit(request);
  } catch (error) {
    return jsonResponse(
      apiError(error.message),
      error.status || 400,
      origin,
      env,
      rateHeaders,
    );
  }

  if (!body.model || !Array.isArray(body.messages)) {
    return jsonResponse(
      apiError('Request must include model and messages.'),
      400,
      origin,
      env,
      rateHeaders,
    );
  }

  const upstreamUrl = env.AIHUBMIX_API_URL || DEFAULT_UPSTREAM;
  const headers = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': request.headers.get('anthropic-version') || '2023-06-01',
  };
  const beta = request.headers.get('anthropic-beta');
  if (beta) headers['anthropic-beta'] = beta;

  try {
    const upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(sanitizeBody(body, env)),
    });

    const responseHeaders = new Headers(corsHeaders(origin, env));
    const contentType = upstream.headers.get('content-type');
    if (contentType) responseHeaders.set('content-type', contentType);
    const cacheControl = upstream.headers.get('cache-control');
    if (cacheControl) responseHeaders.set('cache-control', cacheControl);
    const requestId = upstream.headers.get('request-id');
    if (requestId) responseHeaders.set('request-id', requestId);
    responseHeaders.set('X-RateLimit-Limit', String(rate.limit));
    responseHeaders.set('X-RateLimit-Remaining', String(rate.remaining));

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return jsonResponse(
      apiError('Failed to reach AIHubMix.', 'upstream_error'),
      502,
      origin,
      env,
      rateHeaders,
    );
  }
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch {
      return jsonResponse(apiError('Proxy server error.'), 500, request.headers.get('Origin'), env);
    }
  },
};
