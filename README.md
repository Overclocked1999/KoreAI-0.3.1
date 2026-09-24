# KoreAI v0.3.1

Real-time streaming AI chat workspace built with Next.js and the NVIDIA Inference API.

KoreAI routes prompts automatically across three tiers (Light / Medium / Heavy), streams responses via Server-Sent Events, and provides a clean chat interface with local history, memory, and projects.

---

## Features

- Streaming chat responses (SSE)
- Automatic model routing by prompt complexity (or manual Light / Medium / Heavy selection)
- Fast defaults for simple queries; deeper models for coding and reasoning tasks
- Local chat history, memory snippets, and project organisation (stored in the browser)
- Server-side API key handling (never exposed to the client)
- Ready for local development and Netlify deployment

---

## Requirements

- Node.js 18+
- An NVIDIA API key from [build.nvidia.com](https://build.nvidia.com)

---

## Quick start

```bash
# 1. Clone / download the repository
git clone <your-repo-url>
cd koreai          # or the folder name you chose

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env.local
# Edit .env.local and set your key:
#   QWEN_API_KEY=nvapi-...

# 4. Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `QWEN_API_KEY` | Yes | NVIDIA API key |
| `QWEN_API_URL` | No | Default: `https://integrate.api.nvidia.com/v1/chat/completions` |
| `QWEN_ENABLE_THINKING` | No | `true` enables reasoning mode on supported models (slower). Light tier always disables thinking. Default: `false` |
| `KORE_LIGHT_MODELS` | No | Comma-separated model IDs tried for Light tier |
| `KORE_MEDIUM_MODELS` | No | Comma-separated model IDs tried for Medium tier |
| `KORE_HEAVY_MODELS` | No | Comma-separated model IDs tried for Heavy tier |

Copy `.env.example` to `.env.local` and fill in the values.  
**Never commit `.env.local`.**

### Discovering models that work with your key

```bash
npm run check-models
```

This queries the NVIDIA model list and tests chat models. Use the output to populate the `KORE_*_MODELS` variables.

---

## Model routing

| Tier   | Intended use                          | Default first model              |
|--------|---------------------------------------|----------------------------------|
| Light  | Greetings, short questions, arithmetic| `poolside/laguna-xs-2.1`         |
| Medium | Coding, normal reasoning              | `nvidia/nemotron-3.5-lightning-30b-a3b` |
| Heavy  | Deep analysis, large tasks            | `nvidia/nemotron-3.5-lightning-30b-a3b` |

- **Auto** (default in the UI) classifies the prompt and picks a tier.
- Thinking / chain-of-thought is disabled on the Light tier for responsiveness.
- Failed or retired models are skipped automatically; a short-lived cache remembers the last working model per tier.

---

## Project structure

```
app/
  api/chat/route.js   # Validates input, calls the model router, streams SSE
  page.tsx            # Chat UI (client component)
  layout.tsx
  globals.css
lib/
  qwen.js             # Model tiers, discovery, fetch + timeout handling
  sse.ts              # Server-Sent Events parser
scripts/
  check-models.mjs    # Utility to test which models your key can use
.env.example          # Template for environment variables
```

---

## Deployment (Netlify)

1. Push the repository to GitHub.
2. Create a new Netlify site from the repository.
3. Add the same environment variables under **Site configuration → Environment variables**.
4. Deploy. The included `netlify.toml` and `@netlify/plugin-nextjs` handle the Next.js build.

**Note:** Large reasoning models can exceed free-tier function timeouts. Prefer Light / Medium tiers or a plan with longer function limits.

---

## Troubleshooting

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| `QWEN_API_KEY is not set` | Missing `.env.local` or server not restarted | Create the file, set the key, restart `npm run dev` |
| HTTP 401 / Invalid API key | Bad or expired key | Regenerate at build.nvidia.com |
| `ResourceExhausted: Worker local total request limit reached` | NVIDIA free-tier concurrent quota | Wait 30–90 s, close extra tabs, avoid rapid retries |
| Very slow replies on simple prompts | Reasoning model still emitting CoT | Force **Light** tier; ensure `QWEN_ENABLE_THINKING=false` |
| Empty or missing replies | Model not enabled for the key | Run `npm run check-models` and update the tier lists |

---

## Version history

- **0.3.1** – Improved model defaults, thinking control for all models, faster Light tier, cleaner documentation and comments.
- **0.1.0** – Initial release.

---

## License

See [LICENSE](LICENSE).
