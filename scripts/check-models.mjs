// Usage: npm run check-models            (tests the built-in candidates)
//        npm run check-models -- vendor/model-id another/model-id
const url =
  process.env.QWEN_API_URL || "https://integrate.api.nvidia.com/v1/chat/completions";
const key = process.env.QWEN_API_KEY;

if (!key) {
  console.error("QWEN_API_KEY is not set. Put it in .env.local first.");
  process.exit(1);
}

const defaults = [
  "qwen/qwen3.6-35b-a3b",
  "moonshotai/kimi-k2.6",
  "z-ai/glm-5.1",
  "meta/llama-3.3-70b-instruct",
  "meta/llama-3.1-70b-instruct",
  "deepseek-ai/deepseek-v4-flash",
];
const models = process.argv.slice(2).length ? process.argv.slice(2) : defaults;

const working = [];
for (const model of models) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Say OK." }],
        max_tokens: 16,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) {
      console.log(`OK        ${model}`);
      working.push(model);
    } else {
      const text = (await res.text()).replace(/\s+/g, " ").slice(0, 140);
      console.log(`FAILED    ${model}  [HTTP ${res.status}] ${text}`);
    }
  } catch (err) {
    console.log(`ERROR     ${model}  ${err.message}`);
  }
}

console.log(
  working.length
    ? `\nAdd this to .env.local:\nQWEN_MODEL=${working.join(",")}`
    : "\nNo model worked. Check your API key and network."
);
