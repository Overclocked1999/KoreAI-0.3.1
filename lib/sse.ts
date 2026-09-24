export type SSEResult = {
  /** Answer text pulled from this chunk. */
  tokens: string[];
  /** Incomplete trailing line to prepend to the next chunk. */
  rest: string;
  /** True once the [DONE] sentinel was seen. */
  done: boolean;
  /** Error message if the stream carried an error payload. */
  error?: string;
};

/**
 * Parse a buffer of OpenAI-style server-sent events.
 * Only `delta.content` is returned; reasoning tokens
 * (`reasoning_content` / `reasoning`) are intentionally ignored.
 */
export function parseSSE(buffer: string): SSEResult {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const tokens: string[] = [];
  let done = false;
  let error: string | undefined;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("data:")) continue;

    const data = line.slice(5).trim();
    if (!data) continue;
    if (data === "[DONE]") {
      done = true;
      continue;
    }

    try {
      const json = JSON.parse(data);
      if (json?.error) {
        error =
          typeof json.error === "string"
            ? json.error
            : json.error.message || JSON.stringify(json.error);
        continue;
      }
      const token = json?.choices?.[0]?.delta?.content;
      if (typeof token === "string" && token) tokens.push(token);
    } catch {
      // partial or non-JSON line; ignore
    }
  }

  return { tokens, rest, done, error };
}
