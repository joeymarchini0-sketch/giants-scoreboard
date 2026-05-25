export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=30");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const path = req.query.path;
  if (!path) { res.status(400).json({ error: "Missing path" }); return; }

  try {
    const upstream = await fetch(`https://statsapi.mlb.com/api/v1${path}`, {
      headers: { "User-Agent": "Giants-Scoreboard/1.0" },
    });
    const data = await upstream.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
