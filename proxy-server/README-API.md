# Meiting Chat — Anthropic API proxy

This version keeps the existing Meiting Chat frontend and replaces the old
Claude Code subscription proxy with a local proxy that forwards requests to
the official Anthropic Messages API.

## Setup

1. Copy `.env.example` to `.env`.
2. Open `.env` and put your Anthropic API key after `ANTHROPIC_API_KEY=`.
3. In this `proxy-server` folder, run `npm install` if needed.
4. Run `npm start`.
5. Keep the Meiting Chat preset endpoint as:
   `http://127.0.0.1:3000/v1/messages`

The API key stays in the local `.env` file and is not put into the frontend.

Do not publish `.env` or send it to anyone.
