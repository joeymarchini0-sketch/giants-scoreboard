export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  // Tell Vercel and browsers never to cache — always fetch fresh data
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const path = req.query.path;
  if (!path) { res.status(400).json({ error: "Missing path" }); return; }

  try {
    const url = `https://statsapi.mlb.com/api/v1${path}`;
    const upstream = await fetch(url, {
      headers: {
        "User-Agent": "Giants-Scoreboard/1.0",
        "Cache-Control": "no-cache",
      },
    });
    const data = await upstream.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
