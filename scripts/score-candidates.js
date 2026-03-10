import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync } from "fs";
import dotenv from "dotenv";
dotenv.config({ override: true });

const client = new Anthropic();
const candidates = JSON.parse(
  readFileSync(new URL("../candidates.json", import.meta.url), "utf8")
);

// ── Resume support ──
const PROGRESS_FILE = new URL("./scores-progress.json", import.meta.url);
let progress = {};
if (existsSync(PROGRESS_FILE)) {
  progress = JSON.parse(readFileSync(PROGRESS_FILE, "utf8"));
  console.log(`Resuming — ${Object.keys(progress).length} already scored`);
}

// ── Config ──
const BATCH_SIZE = 10;
const DELAY_MS = 1200;
const MAX_RETRIES = 3;
const MODEL = "claude-haiku-4-5-20251001";

// ── Persona definitions (simplified for prompt) ──
const PERSONAS = [
  {
    id: "ageless-matriarch",
    name: "The Ageless Matriarch",
    pct: 27.7,
    age: "60+",
    signals:
      "Mature skin, fine lines, wrinkles, age spots, elegant, timeless, grandmother, retired, community, classic beauty, bobbi brown fan",
  },
  {
    id: "high-powered-executive",
    name: "The High-Powered Executive",
    pct: 20.3,
    age: "40-60",
    signals:
      "Career-driven, corporate, professional, travel, efficiency, polished, zoom/video calls, desk to dinner, ambitious, fitness, power",
  },
  {
    id: "wellness-practitioner",
    name: "The Wellness & Healthcare Practitioner",
    pct: 11.8,
    age: "35-55",
    signals:
      "Clean beauty, ingredients, non-toxic, sensitive skin, healthcare worker, nurse, yoga, meditation, evidence-based, self-care, organic",
  },
  {
    id: "busy-suburban-supermom",
    name: "The Busy Suburban Supermom",
    pct: 9.0,
    age: "35-50",
    signals:
      "Mom, kids, school drop-off, carpool, quick routine, practical, looking put together, family, multitasker, 90-second makeup",
  },
  {
    id: "creative-entrepreneur",
    name: "The Creative Entrepreneur",
    pct: 9.0,
    age: "30-55",
    signals:
      "Personal brand, aesthetic, design, curated, instagram, photoshoot, studio, freelance, small business, intentional, effortless",
  },
  {
    id: "dedicated-educator",
    name: "The Dedicated Educator",
    pct: 8.7,
    age: "35-65",
    signals:
      "Teacher, school, classroom, budget beauty, fluorescent lighting, long-wearing, practical, beginner-friendly, professional development",
  },
];

const PERSONA_BLOCK = PERSONAS.map(
  (p) => `- ${p.id} (${p.name}, ${p.pct}% of customers, age ${p.age}): ${p.signals}`
).join("\n");

function buildPrompt(candidate) {
  return `You are evaluating casting submissions for Jones Road Beauty, a clean beauty brand founded by Bobbi Brown. The brand values natural/minimal makeup looks, approachability, authenticity, real skin, and diversity of age and ethnicity.

CANDIDATE DATA:
- Age: ${candidate.age}
- Ethnicity: ${candidate.ethnicity}
- Skin tone: ${candidate.skinTone}
- Skin needs: ${candidate.skinNeeds.join(", ") || "not specified"}
- Products they use: ${candidate.products || "not specified"}

JRB CUSTOMER PERSONAS:
${PERSONA_BLOCK}

Analyze their submission photo and data. Return ONLY valid JSON:
{
  "photoQuality": <1-50 score for photo lighting, clarity, resolution, framing>,
  "brandFit": <1-50 score for natural/minimal makeup, approachable vibe, authentic feel, skin-forward look, already uses JRB products is a bonus>,
  "composite": <sum of photoQuality + brandFit>,
  "reasoning": "<1 concise sentence explaining the score>",
  "personas": [
    {"id": "<persona-id>", "confidence": <0.0-1.0>}
  ]
}

For personas: pick the 1-2 best-matching personas based on the candidate's age, lifestyle signals from their products/skin needs, and overall vibe from the photo. Only include personas with confidence >= 0.3.`;
}

async function scoreCandidate(candidate) {
  if (!candidate.photoUrl) {
    return {
      photoQuality: null,
      brandFit: null,
      composite: null,
      reasoning: "No photo URL provided",
      personas: [],
    };
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 250,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "url", url: candidate.photoUrl },
              },
              { type: "text", text: buildPrompt(candidate) },
            ],
          },
        ],
      });

      const text = response.content[0]?.text || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in response");

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate
      if (
        typeof parsed.photoQuality !== "number" ||
        typeof parsed.brandFit !== "number"
      ) {
        throw new Error("Invalid score format");
      }

      parsed.composite = parsed.photoQuality + parsed.brandFit;
      if (!Array.isArray(parsed.personas)) parsed.personas = [];

      return parsed;
    } catch (err) {
      if (err?.status === 429 || err?.error?.type === "rate_limit_error") {
        const wait = DELAY_MS * Math.pow(2, attempt);
        console.log(`  Rate limited, waiting ${wait}ms...`);
        await sleep(wait);
        continue;
      }
      if (attempt === MAX_RETRIES - 1) {
        return {
          photoQuality: null,
          brandFit: null,
          composite: null,
          reasoning: `Error: ${err.message}`,
          personas: [],
        };
      }
      await sleep(DELAY_MS);
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main ──
async function main() {
  const toScore = candidates.filter((c) => !progress[c.email]);
  console.log(
    `Scoring ${toScore.length} candidates (${Object.keys(progress).length} already done)`
  );

  let scored = Object.keys(progress).length;
  const total = candidates.length;

  for (let i = 0; i < toScore.length; i += BATCH_SIZE) {
    const batch = toScore.slice(i, i + BATCH_SIZE);
    const startTime = Date.now();

    const results = await Promise.allSettled(
      batch.map((c) => scoreCandidate(c))
    );

    for (let j = 0; j < batch.length; j++) {
      const candidate = batch[j];
      const result = results[j];
      if (result.status === "fulfilled") {
        progress[candidate.email] = result.value;
      } else {
        progress[candidate.email] = {
          photoQuality: null,
          brandFit: null,
          composite: null,
          reasoning: `Failed: ${result.reason}`,
          personas: [],
        };
      }
      scored++;
    }

    // Save progress after each batch
    writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const pct = ((scored / total) * 100).toFixed(1);
    console.log(
      `  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${scored}/${total} (${pct}%) — ${elapsed}s`
    );

    // Delay between batches
    if (i + BATCH_SIZE < toScore.length) {
      await sleep(DELAY_MS);
    }
  }

  // Write final output
  const output = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    totalScored: Object.values(progress).filter((s) => s.composite !== null)
      .length,
    totalFailed: Object.values(progress).filter((s) => s.composite === null)
      .length,
    scores: progress,
  };

  const outPath = new URL("../scores.json", import.meta.url);
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(
    `\nDone! Wrote scores.json — ${output.totalScored} scored, ${output.totalFailed} failed`
  );

  // Stats
  const composites = Object.values(progress)
    .map((s) => s.composite)
    .filter((c) => c !== null)
    .sort((a, b) => b - a);
  if (composites.length) {
    console.log(`  Top score: ${composites[0]}`);
    console.log(`  Median: ${composites[Math.floor(composites.length / 2)]}`);
    console.log(`  Bottom score: ${composites[composites.length - 1]}`);
    console.log(`  Top 100 cutoff: ${composites[Math.min(99, composites.length - 1)]}`);
  }
}

main().catch(console.error);
