/**
 * KoreAI model router for the NVIDIA Inference API.
 *
 * Responsibilities:
 *  - Maintain Light / Medium / Heavy model lists (overridable via env)
 *  - Classify prompts when tier = "auto"
 *  - Try configured models first (never block on /v1/models)
 *  - Fall back to account-enabled models only after configured candidates fail
 *  - Cache the last working model per tier for faster subsequent requests
 *  - Disable chain-of-thought on the Light tier for responsiveness
 *
 * Environment variables (see .env.example):
 *  QWEN_API_KEY, QWEN_API_URL, QWEN_ENABLE_THINKING
 *  KORE_LIGHT_MODELS, KORE_MEDIUM_MODELS, KORE_HEAVY_MODELS
 */

const DEFAULT_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

// Default model candidates per tier. Override with comma-separated lists in .env.local.
// The first model in each list is preferred; later entries are fallbacks.
// Light prefers fast, non-reasoning models. Thinking is forced off for Light.
const DEFAULT_TIERS = {
  light: [
    "poolside/laguna-xs-2.1",
    "nvidia/nemotron-3.5-lightning-30b-a3b",
    "openai/gpt-oss-20b",
  ],
  medium: [
    "nvidia/nemotron-3.5-lightning-30b-a3b",
    "poolside/laguna-xs-2.1",
    "openai/gpt-oss-20b",
  ],
  heavy: [
    "nvidia/nemotron-3.5-lightning-30b-a3b",
    "openai/gpt-oss-20b",
    "z-ai/glm-5.3",
  ],
};

const DISCOVERY_TTL = 5 * 60 * 1000; // Cache discovered model list for 5 minutes
let discoveredModels = { at: 0, models: [] };

// Last known working model per tier (in-memory, process lifetime)
let workingModels = new Map();

export class ApiError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function envList(name, fallback) {
  const list = (process.env[name] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : fallback;
}

export function getModelTiers() {
  return {
    light: envList("KORE_LIGHT_MODELS", DEFAULT_TIERS.light),
    medium: envList("KORE_MEDIUM_MODELS", DEFAULT_TIERS.medium),
    heavy: envList("KORE_HEAVY_MODELS", DEFAULT_TIERS.heavy),
  };
}

async function discoverModels(url, key, signal) {
  const now = Date.now();
  if (discoveredModels.at && now - discoveredModels.at < DISCOVERY_TTL) {
    return discoveredModels.models;
  }

  const modelsUrl = url.replace(/\/chat\/completions\/?$/, "/models");
  try {
    const res = await fetch(modelsUrl, {
      headers: { Authorization: `Bearer ${key}` },
      signal: signal || AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const models = Array.isArray(json?.data)
      ? json.data.map((m) => m?.id).filter(Boolean)
      : [];
    discoveredModels = { at: now, models };
    return models;
  } catch {
    return [];
  }
}

function tierScore(model, tier) {
  const id = model.toLowerCase();
  const heavy = /glm-5\.3(?!-flash)|kimi-k3|deepseek-v4(?!-flash)|ultra|340b|253b|120b/i;
  const medium = /glm-5\.3-flash|deepseek-v4-flash|kimi-k2|llama-3\.3-70b|lightning|nemotron-3\.5/i;
  const light = /flash|nano|mini|small|8b|12b|14b|32b|laguna|gpt-oss|xs/i;

  if (tier === "heavy") return heavy.test(id) ? 100 : medium.test(id) ? 55 : light.test(id) ? 15 : 35;
  if (tier === "medium") return medium.test(id) ? 100 : heavy.test(id) ? 75 : light.test(id) ? 35 : 55;
  return light.test(id) ? 100 : medium.test(id) ? 70 : heavy.test(id) ? 45 : 60;
}

async function candidateModels(options, url, key) {
  if (options.model) return [options.model];

  const tiers = getModelTiers();
  const tier = options.tier || "medium";
  const configured = tiers[tier] || tiers.medium;
  const working = workingModels.get(tier);

  // IMPORTANT: never block the first request on /v1/models. Model discovery
  // can be slow or unavailable for some NVIDIA accounts. Try known models
  // immediately; discovery is only a fallback after those fail.
  const fastList = working
    ? [working, ...configured.filter((m) => m !== working)]
    : [...configured];

  return fastList;
}

export function classifyPrompt(messages = []) {
  const userText = messages
    .filter((m) => m?.role === "user")
    .map((m) => m.content || "")
    .join("\n")
    .trim();

  const chars = userText.length;
  const words = userText.split(/\s+/).filter(Boolean).length;
  const codeSignals = /(```|function\s|class\s|import\s|export\s|stack trace|typescript|javascript|python|rust|java|c#|sql|react|next\.js|api|repository|codebase|bug|debug|refactor|review|security|architecture|tests?)/i;
  const heavySignals = /(entire project|whole project|large codebase|multiple files|architecture|architect|production|migration|complex|deep|thorough|analyze|audit|security audit|refactor.*system|build.*app|full[- ]stack|implement.*feature|fix.*everything|compare.*trade|reason|step[- ]by[- ]step)/i;
  const simpleSignals = /^(hi|hello|hey|thanks|thank you|what is|who is|when is|where is|define|translate|summarize|rewrite|make this shorter|\d+[\s\S]*[+\-*\/]\s*\d+)[.!?\s]*$/i;

  if (heavySignals.test(userText) || chars > 7000 || words > 1200) return "heavy";
  if (codeSignals.test(userText) || chars > 1400 || words > 250) return "medium";
  if (simpleSignals.test(userText) || chars < 500) return "light";
  return "medium";
}

export function resolveTier(requested, messages) {
  const value = String(requested || "auto").toLowerCase();
  if (["light", "medium", "heavy"].includes(value)) return value;
  return classifyPrompt(messages);
}

function extractMessage(body, status) {
  try {
    const json = JSON.parse(body);
    const msg = json?.error?.message ||
      (typeof json?.error === "string" ? json.error : null) ||
      json?.detail || json?.message;
    if (msg) return typeof msg === "string" ? msg : JSON.stringify(msg);
  } catch {}
  return body?.trim() || `Upstream API returned HTTP ${status}`;
}

function isModelGone(status, message) {
  if (status === 404 || status === 410) return true;
  return /end of life|no longer available|not found|does not exist|unknown model|model.*unavailable/i.test(message);
}

export async function callQwen(messages, options = {}) {
  const url = process.env.QWEN_API_URL || DEFAULT_URL;
  const key = process.env.QWEN_API_KEY;
  if (!key) {
    throw new ApiError("QWEN_API_KEY is not set. Add it to .env.local and restart the dev server.", 500);
  }

  const envThinking = (process.env.QWEN_ENABLE_THINKING || "false").toLowerCase() === "true";
  const tier = options.tier || resolveTier("auto", messages);
  const failures = [];

  // Tiny prompts should stay tiny. In particular, don't allocate a huge
  // generation budget for things like arithmetic, greetings, or definitions.
  const maxTokens = options.max_tokens ?? (
    tier === "heavy" ? 16384 :
    tier === "medium" ? 4096 :
    512
  );

  async function tryModels(models) {
    for (const model of models) {
      const body = {
        model,
        messages,
        temperature: options.temperature ?? (tier === "heavy" ? 0.55 : tier === "medium" ? 0.65 : 0.2),
        top_p: options.top_p ?? 0.8,
        max_tokens: maxTokens,
        stream: options.stream ?? true,
      };

      // Thinking is useful for larger tasks but unnecessary for the Light tier.
      // Keeping it off here makes short requests substantially more responsive.
      // Many NVIDIA reasoning models (Nemotron, Qwen, etc.) respect this flag;
      // models that ignore it are unaffected.
      const enableThinking = tier !== "light" && envThinking;
      body.chat_template_kwargs = { enable_thinking: enableThinking };

      let res;
      const timeoutMs = options.timeoutMs ?? (
        tier === "heavy" ? 30000 :
        tier === "medium" ? 18000 :
        8000
      );
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
      const signal = options.signal
        ? AbortSignal.any([options.signal, timeoutController.signal])
        : timeoutController.signal;

      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify(body),
          signal,
        });
      } catch (err) {
        if (options.signal?.aborted) throw err;
        if (timeoutController.signal.aborted) {
          failures.push(`${model}: timed out after ${timeoutMs}ms`);
          if (workingModels.get(tier) === model) workingModels.delete(tier);
          continue;
        }
        if (err?.name === "AbortError") throw err;
        failures.push(`${model}: ${err.message}`);
        continue;
      } finally {
        clearTimeout(timeoutId);
      }

      if (res.ok) {
        workingModels.set(tier, model);
        return { response: res, model, tier };
      }

      const message = extractMessage(await res.text(), res.status);
      if (isModelGone(res.status, message)) {
        failures.push(`${model}: ${message}`);
        if (workingModels.get(tier) === model) workingModels.delete(tier);
        continue;
      }

      // A rate limit can be retried with the next configured model. This is
      // especially useful when Auto has several providers/models available.
      if (res.status === 429) {
        failures.push(`${model}: ${message}`);
        continue;
      }

      throw new ApiError(message, res.status === 401 ? 401 : 502);
    }
    return null;
  }

  // FAST PATH: configured models are attempted immediately. We intentionally
  // do NOT call /v1/models first; that endpoint can add 5-10 seconds or more.
  let result = await tryModels(await candidateModels({ ...options, tier }, url, key));
  if (result) return result;

  // SLOW FALLBACK: only discover account-enabled models after the configured
  // candidates have failed. Discovery is cached, so this is not paid often.
  const discovered = await discoverModels(url, key, options.signal);
  const usable = discovered
    .filter((m) => !/embed|rerank|guard|safety|reward|retriev|parse|ocr|tts|whisper|flux|stable-diffusion/i.test(m))
    .filter((m) => !getModelTiers()[tier]?.includes(m))
    .sort((a, b) => tierScore(b, tier) - tierScore(a, tier));

  result = await tryModels(usable);
  if (result) return result;

  throw new ApiError(
    `No available ${tier} models.\n${failures.join("\n")}\nNo configured model worked, and NVIDIA did not expose a usable fallback.`,
    502
  );
}
