import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const KEY = "casting:ratings";

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method === "GET") {
      const data = (await redis.get(KEY)) || {};
      return res.status(200).json(data);
    }

    if (req.method === "POST") {
      const { email, reviewer, rating, notes } = req.body;
      if (!email || !reviewer) {
        return res.status(400).json({ error: "email and reviewer required" });
      }

      // Get current data
      const data = (await redis.get(KEY)) || {};

      // Upsert this reviewer's rating for this candidate
      if (!data[email]) data[email] = {};
      data[email][reviewer] = {
        rating: rating || null,
        notes: notes || "",
        reviewedAt: new Date().toISOString(),
      };

      await redis.set(KEY, data);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Ratings API error:", err);
    return res.status(500).json({ error: err.message });
  }
}
