# Secure AIHubMix proxy

This proxy keeps the AIHubMix API key on the server instead of sending it to the browser.

Architecture:

`Meiting Chat (GitHub Pages / phone) -> this proxy -> AIHubMix -> Claude`

## Local use

1. Copy `.env.example` to `.env`.
2. Put the real AIHubMix key in `.env`.
3. Run `npm install` and `npm start`.
4. In Meiting Chat, set the Claude/Anthropic preset endpoint to:
   `http://127.0.0.1:3000/v1/messages`
5. Leave the API Key field EMPTY for this proxy preset.

## Public phone use

The browser cannot safely store the AIHubMix secret. To keep GitHub Pages working on your phone, deploy `proxy-server` as a public HTTPS web service (for example Render).

Render settings:

- Root Directory: `proxy-server`
- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Environment variable: `AIHUBMIX_API_KEY` = your real AIHubMix key
- Optional `ALLOWED_ORIGINS`: `https://inosi4224-spec.github.io`

After deployment, use the Render HTTPS URL plus `/v1/messages` as the Anthropic preset endpoint, and keep the frontend API Key field EMPTY.

The proxy also has basic per-IP rate limiting, request-size limiting, CORS origin filtering, and a maximum `max_tokens` cap. These controls reduce abuse but are not a replacement for authentication if you later make the app public to many users.
