// Exception to DB-only policy — LLM call is the live piece; context is sourced from Gold (see GOLD_DB_MIGRATION_HANDOFF §7 D1).
import { json } from "@/lib/server/http";
import Anthropic from "@anthropic-ai/sdk";
import { buildCopilotContext } from "@/lib/server/copilotContext";


/**
 * POST /api/copilot  { question: string }
 *
 * Natural-language answer over the securities-finance desk data. When
 * ANTHROPIC_API_KEY is set, Claude answers from a factual desk-data snapshot
 * (it is instructed to use only the supplied figures). Without a key — or on any
 * error — returns source "LOCAL" so the client falls back to its deterministic
 * keyword engine. Mirrors the terminal's provenance-honest fallback pattern:
 * always 200, always a `source` badge.
 */

const SYSTEM = `You are the AI Copilot for a Bloomberg-style securities-finance terminal, covering Securities Lending, Prime Finance, Collateral Management, and Cash/Treasury.

You will be given a JSON snapshot of the current desk data. Answer the user's question USING ONLY the figures in that snapshot — never invent numbers, tickers, clients, or rates. If the snapshot doesn't contain what's needed, say so plainly.

Style: terminal-desk register — direct, quantitative, no preamble or pleasantries. Lead with the answer. Cite the specific figures from the data. Keep the main text to 2-4 sentences; put supporting specifics in bullets.

Respond with ONLY a single JSON object and nothing else (no markdown, no code fences), of the form:
{"text": "<the narrative answer, 2-4 sentences>", "bullets": ["<short supporting point>", ...]}
The bullets array may be empty.`;

/** Extract the first balanced JSON object from a model response, tolerating fences/prose. */
function extractJson(raw: string): { text?: string; bullets?: string[] } | null {
  const fenced = raw.replace(/```(?:json)?/gi, "").trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let question = "";
  try {
    const body = await req.json();
    question = typeof body?.question === "string" ? body.question.trim() : "";
  } catch {
    return json({ error: "invalid body" }, { status: 400 });
  }
  if (!question) return json({ error: "question required" }, { status: 400 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ source: "LOCAL" });
  }

  try {
    const client = new Anthropic();
    const context = buildCopilotContext();
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1500,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Desk data snapshot (JSON):\n${JSON.stringify(context)}\n\nQuestion: ${question}`,
        },
      ],
    });

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    if (!textBlock) return json({ source: "LOCAL" });

    const parsed = extractJson(textBlock.text);
    if (!parsed?.text) return json({ source: "LOCAL" });

    return json({
      source: "AI",
      text: parsed.text,
      bullets: Array.isArray(parsed.bullets) ? parsed.bullets.slice(0, 8) : [],
    });
  } catch {
    // Any failure (auth, rate limit, parse) → deterministic fallback.
    return json({ source: "LOCAL" });
  }
}
