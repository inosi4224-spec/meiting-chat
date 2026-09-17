# Meiting Chat Cloudflare Worker proxy

Secure server-side proxy for the Meiting Chat frontend.

- Browser never receives `AIHUBMIX_API_KEY`.
- Frontend sends Anthropic-compatible POST requests to `/v1/messages`.
- The Worker forwards requests to AIHubMix with the key stored as a Cloudflare Secret.
- CORS allows the GitHub Pages frontend and local localhost development by default.
- A lightweight per-isolate rate limit and `max_tokens` cap are applied.

Cloudflare secret to add in Worker settings:

`AIHUBMIX_API_KEY`

Optional variables:

`AIHUBMIX_API_URL`
`ALLOWED_ORIGINS`
`MAX_REQUESTS_PER_WINDOW`
`RATE_LIMIT_WINDOW_MS`
`PROXY_MAX_TOKENS`
