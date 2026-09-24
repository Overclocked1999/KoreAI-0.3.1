// Usage:
//   npm run check-models                 -> asks NVIDIA for its model list and tests every chat model
//   npm run check-models -- a/b c/d      -> tests only the models you name
const chatUrl =
  process.env.QWEN_API_URL || "https://integrate.api.nvidia.com/v1/chat/completions";
const modelsUrl = chatUrl.replace(/\/chat\/completions\/?$/, "/models");
const key = process.env.QWEN_API_KEY;

if (!key) {
  console.error("QWEN_API_KEY is not set. Put it in .env.local first.");
  process.exit(1);
}

// Skip things that aren't chat models (embeddings, image/speech models, safety classifiers...).
const NOT_CHAT =
  /embed|rerank|guard|safety|reward|retriev|clip|parse|ocr|riva|parakeet|canary|whisper|tts|flux|stable-diffusion|sdxl|cosmos|nv-|bge|arctic|neva|vila|paligemma|fuyu|kosmos|deplot|synthetic|topic-control|content-safety|nemoretriever|molmim|esm|alphafold|diffdock|genmol|proteinmpnn|rfdiffusion|evo2|maxine|studiovoice|usdcode|usdsearch/i;

async function discover() {
  const res = await fetch(modelsUrl, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return (json.data || []).map((m) => m.id).filter((id) => id && !NOT_CHAT.test(id));
}

async function test(model) {
  try {
    const res = await fetch(chatUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Say OK." }],
        max_tokens: 16,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (res.ok) return { ok: true };
    const text = (await res.text()).replace(/\s+/g, " ");
    if (res.status === 429) return { ok: false, note: "rate limited (try again in a minute)" };
    const short = /end of life/i.test(text) ? "retired" : /not found/i.test(text) ? "not enabled for your account" : text.slice(0, 90);
    return { ok: false, note: `HTTP ${res.status}: ${short}` };
  } catch (err) {
    return { ok: false, note: err.name === "TimeoutError" ? "timed out" : err.message };
  }
}

let models = process.argv.slice(2);
if (!models.length) {
  try {
    models = await discover();
    console.log(`NVIDIA lists ${models.length} chat-style models. Testing each (this takes a minute or two)...\n`);
  } catch (err) {
    console.error(`Could not fetch the model list (${err.message}).`);
    console.error("Test specific models instead:  npm run check-models -- vendor/model-id");
    process.exit(1);
  }
}

const working = [];
let next = 0;
async function worker() {
  while (next < models.length) {
    const model = models[next++];
    const r = await test(model);
    if (r.ok) {
      working.push(model);
      console.log(`OK      ${model}`);
    } else if (process.argv.length > 2) {
      console.log(`FAILED  ${model}  (${r.note})`);
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));

if (working.length) {
  console.log(`\n${working.length} model(s) work with your key.`);
  console.log(`Add this line to .env.local (then restart npm run dev):\n`);
  console.log(`QWEN_MODEL=${working.slice(0, 6).join(",")}`);
} else {
  console.log("\nNo model worked. Your key may be limited, or NVIDIA may be rate limiting; wait a minute and retry.");
}
