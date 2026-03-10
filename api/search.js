import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { query, candidates } = req.body;
  if (!query || !candidates) {
    return res.status(400).json({ error: "query and candidates required" });
  }

  try {
    // Build a compact summary of candidates for Claude
    const summary = candidates.map((c) => ({
      e: c.email,
      n: c.name,
      a: c.age,
      et: c.ethnicity,
      st: c.skinTone,
      sn: c.skinNeeds?.join(", ") || "",
      p: c.products || "",
      ps: c.personas || [],
    }));

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: `You are filtering casting call candidates for Jones Road Beauty based on a search query.

SEARCH QUERY: "${query}"

CANDIDATE DATA (JSON array — e=email, n=name, a=age, et=ethnicity, st=skinTone, sn=skinNeeds, p=products, ps=persona tags):
${JSON.stringify(summary)}

Return ONLY valid JSON:
{
  "matches": ["email1@...", "email2@...", ...],
  "reasoning": "Brief explanation of how you interpreted the query and filtered"
}

Match candidates whose data best fits the query. Interpret natural language intent:
- "moms" → look for skinNeeds/products suggesting busy lifestyle, or persona "busy-suburban-supermom"
- "women over 60" → age >= 60
- "dark skin tones" → skinTone containing "dark" or "deep"
- "JRB customers" → products mentioning Jones Road, Miracle Balm, WTF, etc.
- If the query mentions a persona name or archetype, match by persona tag
- Be inclusive — return all reasonable matches, not just exact matches`,
        },
      ],
    });

    const text = response.content[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res
        .status(500)
        .json({ error: "Failed to parse AI response", raw: text });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return res.status(200).json(parsed);
  } catch (err) {
    console.error("Search API error:", err);
    return res.status(500).json({ error: err.message });
  }
}
