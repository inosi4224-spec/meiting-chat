# Meiting Chat secure AIHubMix proxy

This is the server-side proxy for the Meiting Chat frontend. The AIHubMix API key is kept in the server environment and is never sent to the browser.

## Local

```bash
cd proxy-server
cp .env.example .env
# edit .env and set AIHUBMIX_API_KEY
npm install
npm start
```

Then use `http://127.0.0.1:3000/v1/messages` as the Anthropic preset endpoint and leave the frontend API Key field empty.

## Public phone access

Deploy this folder as a public HTTPS Node web service. The included `render.yaml` is ready for Render. Set `AIHUBMIX_API_KEY` as a Render environment variable; do not commit it.

The current proxy includes CORS origin filtering, per-IP rate limiting, request-size limiting, and a maximum `max_tokens` cap. These are abuse-reduction measures; if the app is ever opened to other people, add real user authentication before treating it as a multi-user service.
