// Vercel serverless function — proxies ESPN public API for WNBA, NBA, NFL, NHL scores
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  const sport = req.query.sport;
  const event = req.query.event; // when present -> return box score for one game
  const sportMap = {
    wnba: "basketball/wnba",
    nba:  "basketball/nba",
    nfl:  "football/nfl",
    nhl:  "hockey/nhl",
  };
  const espnSport = sportMap[sport];
  if (!espnSport) { res.status(400).json({ error: "Unknown sport" }); return; }

  // ── Box score (summary) branch ──────────────────────────────────────────────
  // GET /api/espn?sport=wnba&event=401812345
  // Returns ESPN's full summary object so the frontend can read boxscore.players.
  if (event) {
    try {
      const url = `https://site.web.api.espn.com/apis/site/v2/sports/${espnSport}/summary?event=${encodeURIComponent(event)}`;
      const upstream = await fetch(url, {
        headers: { "User-Agent": "BayAreaSports/1.0", "Cache-Control": "no-cache" },
      });
      const data = await upstream.json();
      res.status(200).json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  // ── Scoreboard branch (unchanged behavior, plus team ids + per-quarter linescores) ──
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${espnSport}/scoreboard`;
    const upstream = await fetch(url, {
      headers: { "User-Agent": "BayAreaSports/1.0", "Cache-Control": "no-cache" },
    });
    const data = await upstream.json();
    // Normalize to simple game objects
    const games = (data.events || []).map(e => {
      const comp = e.competitions?.[0] || {};
      const competitors = comp.competitors || [];
      const home = competitors.find(c => c.homeAway === "home");
      const away = competitors.find(c => c.homeAway === "away");
      const status = e.status?.type?.name || ""; // "STATUS_IN_PROGRESS", "STATUS_FINAL", "STATUS_SCHEDULED"
      const clock = e.status?.displayClock || "";
      const period = e.status?.period || 0;
      // Per-quarter / per-period scores (array of numbers), if ESPN provides them
      const periodsOf = c => (c?.linescores || []).map(ls => Number(ls?.value ?? ls?.displayValue ?? 0));
      return {
        id: e.id,
        status: status.includes("IN_PROGRESS") ? "inprogress" : status.includes("FINAL") ? "closed" : "scheduled",
        home: home?.team?.abbreviation || "",
        away: away?.team?.abbreviation || "",
        homeName: home?.team?.displayName || "",
        awayName: away?.team?.displayName || "",
        homeId: home?.team?.id || "",
        awayId: away?.team?.id || "",
        homeScore: parseInt(home?.score || 0),
        awayScore: parseInt(away?.score || 0),
        homePeriods: periodsOf(home),
        awayPeriods: periodsOf(away),
        clock,
        period,
        startTime: e.date,
      };
    });
    res.status(200).json(games);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
