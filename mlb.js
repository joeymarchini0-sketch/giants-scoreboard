// Vercel serverless function — proxies MLB Stats API to avoid CORS
// Deployed at /api/mlb?path=/schedule?sportId=1&teamId=137&date=2026-05-25

export default async function handler(req, res) {
  // Allow requests from any origin (our own frontend)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=30");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const path = req.query.path;
  if (!path) {
    res.status(400).json({ error: "Missing path parameter" });
    return;
  }

  try {
    const url = `https://statsapi.mlb.com/api/v1${path}`;
    const upstream = await fetch(url, {
      headers: { "User-Agent": "Giants-Scoreboard/1.0" },
    });

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `MLB API returned ${upstream.status}` });
      return;
    }

    const data = await upstream.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
