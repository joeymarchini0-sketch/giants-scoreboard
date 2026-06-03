import React, { useState, useEffect, useCallback, useRef } from 'react'
import ReactDOM from 'react-dom/client'

// ── Team configs ──────────────────────────────────────────────────────────────
const TEAMS = {
  giants: {
    name:"SF Giants", fullName:"San Francisco Giants",
    league:"MLB", division:"NL West",
    primary:"#FD5A1E", secondary:"#27251F",
    mlbId:137, logo:"https://www.mlbstatic.com/team-logos/137.svg",
    inSeason:true, abbrevs:["SF"],
  },
  warriors: {
    name:"Warriors", fullName:"Golden State Warriors",
    league:"NBA", division:"Pacific Division",
    primary:"#1D428A", secondary:"#FFC72C",
    logo:"https://cdn.nba.com/logos/nba/1610612744/global/L/logo.svg",
    inSeason:false, abbrevs:["GSW","GS"], espnSport:"nba", espnId:"9",
    lastSeasonLabel:"2025-26 Final Standings",
    bayTeam:"Golden State Warriors",
    lastStandings:[
      {rank:1,name:"Los Angeles Lakers",  w:53,l:29},
      {rank:2,name:"Phoenix Suns",        w:45,l:37},
      {rank:3,name:"LA Clippers",         w:42,l:40},
      {rank:4,name:"Golden State Warriors",w:37,l:45},
      {rank:5,name:"Sacramento Kings",    w:22,l:60},
    ],
  },
  valkyries: {
    name:"Valkyries", fullName:"Golden State Valkyries",
    league:"WNBA", division:"Western Conference",
    primary:"#744399", secondary:"#FFC72C",
    logo:"https://a.espncdn.com/combiner/i?img=/i/teamlogos/wnba/500/gsv.png",
    inSeason:true, abbrevs:["GS","GSV"], espnSport:"wnba", espnId:"129689",
  },
  niners: {
    name:"49ers", fullName:"San Francisco 49ers",
    league:"NFL", division:"NFC West",
    primary:"#AA0000", secondary:"#B3995D",
    logo:"https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500/sf.png",
    inSeason:false, abbrevs:["SF","SFO"],
    lastSeasonLabel:"2025 Final Standings",
    bayTeam:"San Francisco 49ers",
    lastStandings:[
      {rank:1,name:"Seattle Seahawks",    w:14,l:3},
      {rank:2,name:"Los Angeles Rams",    w:12,l:5},
      {rank:3,name:"San Francisco 49ers", w:12,l:5},
      {rank:4,name:"Arizona Cardinals",   w:3, l:14},
    ],
  },
  sharks: {
    name:"Sharks", fullName:"San Jose Sharks",
    league:"NHL", division:"Pacific Division",
    primary:"#006D75", secondary:"#EA7200",
    logo:"https://a.espncdn.com/combiner/i?img=/i/teamlogos/nhl/500/sjs.png",
    inSeason:false, abbrevs:["SJS","SJ"],
    lastSeasonLabel:"2025-26 Final Standings",
    bayTeam:"San Jose Sharks",
    lastStandings:[
      {rank:1,name:"Vegas Golden Knights",w:39,l:26},
      {rank:2,name:"Edmonton Oilers",     w:41,l:30},
      {rank:3,name:"Anaheim Ducks",       w:43,l:33},
      {rank:4,name:"Los Angeles Kings",   w:35,l:27},
      {rank:5,name:"San Jose Sharks",     w:39,l:35},
      {rank:6,name:"Seattle Kraken",      w:34,l:37},
      {rank:7,name:"Calgary Flames",      w:34,l:39},
      {rank:8,name:"Vancouver Canucks",   w:25,l:49},
    ],
  },
};

const CAROUSEL_ORDER = ["giants","warriors","valkyries","niners","sharks"];
const SLIDE_DURATION = 12000;

// Detect a narrow portrait phone viewport so we can render a simplified layout
function useIsPhone() {
  const [isPhone, setIsPhone] = useState(
    typeof window !== "undefined" &&
    window.innerWidth <= 600 && window.innerHeight > window.innerWidth
  );
  useEffect(() => {
    const check = () => setIsPhone(window.innerWidth <= 600 && window.innerHeight > window.innerWidth);
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);
  return isPhone;
}

function isDeployed() {
  return typeof window !== "undefined" &&
    !window.location.hostname.includes("claude") &&
    window.location.hostname !== "localhost";
}

async function mlb(path) {
  if (!isDeployed()) throw new Error("PREVIEW_MODE");
  const res = await fetch(`/api/mlb?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(`MLB ${res.status}`);
  return res.json();
}

async function espn(sport) {
  const res = await fetch(`/api/espn?sport=${sport}`);
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  return res.json();
}

// Game-detail (box score) fetch. Expects the /api/espn proxy to forward an
// `event` param to ESPN's summary endpoint and return its JSON.
async function espnSummary(sport, eventId) {
  const res = await fetch(`/api/espn?sport=${sport}&event=${encodeURIComponent(eventId)}`);
  if (!res.ok) throw new Error(`ESPN summary ${res.status}`);
  return res.json();
}

// Pull a number out of ESPN's stat arrays by label (e.g. "PTS","REB","AST")
function statByLabel(labels, values, want) {
  const i = (labels||[]).findIndex(l => (l||"").toUpperCase() === want);
  return i>=0 ? values?.[i] : undefined;
}

// Build a normalized basketball game for the Valkyries/Warriors dashboard.
// Returns {game, standings:[]} where game is null when no game today.
async function fetchBasketballGame(teamKey) {
  const cfg = TEAMS[teamKey];
  const sport = cfg.espnSport;       // "wnba" | "nba"
  const myId = String(cfg.espnId||"");
  const abbrevs = cfg.abbrevs||[];

  // 1) Scoreboard -> find today's game involving this team + its event id.
  //    The /api/espn proxy may return either ESPN's raw events shape OR a
  //    pre-flattened shape (same one the home-screen live tile uses), so we
  //    handle both here.
  const board = await espn(sport);
  const events = Array.isArray(board) ? board : (board.events || board.games || []);
  const matchId = (id) => id && myId && String(id)===myId;
  const matchAbbr = (ab) => ab && abbrevs.includes(ab);

  // Detect which shape we're dealing with and find the team's game.
  let raw=null;          // raw ESPN event (has competitions/competitors)
  let flat=null;         // flattened game object
  for (const e of events) {
    if (e.competitions || e.competitors) {
      const c = e.competitions ? e.competitions[0] : e;
      const cs = c.competitors || [];
      const h = cs.find(x=>x.homeAway==="home") || cs[0] || {};
      const a = cs.find(x=>x.homeAway==="away") || cs[1] || {};
      if (matchId(h.team?.id)||matchId(a.team?.id)||matchAbbr(h.team?.abbreviation)||matchAbbr(a.team?.abbreviation)) {
        raw={ev:e,comp:c,home:h,away:a}; break;
      }
    } else {
      // flattened
      if (matchId(e.homeId)||matchId(e.awayId)||matchAbbr(e.home)||matchAbbr(e.away)) {
        flat=e; break;
      }
    }
  }
  if (!raw && !flat) return { game:null };

  let status, myIsHome, homeT, awayT, eventId, period, clock, statusDetail;

  if (raw) {
    const {ev,comp,home,away}=raw;
    const st = comp.status || ev.status || {};
    const state = st.type?.state;
    status = state==="in"?"inprogress":state==="post"?"complete":"scheduled";
    myIsHome = matchId(home.team?.id)||matchAbbr(home.team?.abbreviation);
    const tb=(c)=>({
      id:String(c?.team?.id??""), abbr:c?.team?.abbreviation||"",
      name:c?.team?.displayName||c?.team?.name||"", score:Number(c?.score??0),
      logo:c?.team?.logo,
      periods:(c?.linescores||[]).map(ls=>Number(ls?.value??ls?.displayValue??0)),
    });
    homeT=tb(home); awayT=tb(away);
    eventId = ev.id || comp.id;
    period = st.period; clock = st.displayClock;
    statusDetail = st.type?.shortDetail || st.type?.description;
  } else {
    // Flattened shape from the proxy
    let state = flat.state || (flat.status==="inprogress"?"in":(flat.status==="final"||flat.status==="post"||flat.status==="closed")?"post":flat.status);
    // Some proxies omit status entirely. If we have a period/clock or any score,
    // assume the game is live rather than incorrectly bouncing to standings.
    if (!state && (flat.period || flat.clock || (flat.homeScore!=null && flat.awayScore!=null))) state="in";
    status = state==="in"?"inprogress":state==="post"?"complete":"scheduled";
    myIsHome = matchId(flat.homeId)||matchAbbr(flat.home);
    homeT={id:String(flat.homeId??""),abbr:flat.home||"",name:flat.homeName||flat.home||"",score:Number(flat.homeScore??0),logo:flat.homeLogo,periods:flat.homePeriods||[]};
    awayT={id:String(flat.awayId??""),abbr:flat.away||"",name:flat.awayName||flat.away||"",score:Number(flat.awayScore??0),logo:flat.awayLogo,periods:flat.awayPeriods||[]};
    eventId = flat.id || flat.eventId || flat.gameId;
    period = flat.period; clock = flat.clock || flat.displayClock;
    statusDetail = flat.statusDetail || flat.detail;
  }

  const baseGame = {
    hasGame:true, status, sport, league:cfg.league,
    myIsHome,
    home:homeT.abbr, away:awayT.abbr,
    homeName:homeT.name, awayName:awayT.name,
    homeId:homeT.id, awayId:awayT.id,
    homeLogo:homeT.logo, awayLogo:awayT.logo,
    homeScore:homeT.score, awayScore:awayT.score,
    homePeriods:homeT.periods, awayPeriods:awayT.periods,
    period, clock, statusDetail,
    players:{home:[],away:[]},
  };

  // 2) Summary -> per-player box scores (only when live/complete and we have an id)
  if (status!=="scheduled" && eventId) {
    try {
      const sum = await espnSummary(sport, eventId);
      const playersRoot = sum?.boxscore?.players || [];
      // Each entry: {team:{id,abbreviation}, statistics:[{labels:[],athletes:[{athlete:{displayName},stats:[]}]}]}
      for (const pteam of playersRoot) {
        const tid=String(pteam?.team?.id), tab=pteam?.team?.abbreviation;
        const side = (tid===homeT.id||tab===homeT.abbr) ? "home" : (tid===awayT.id||tab===awayT.abbr) ? "away" : null;
        if (!side) continue;
        const block = (pteam.statistics||[])[0] || {};
        const labels = block.labels || block.names || [];
        for (const a of (block.athletes||[])) {
          if (a?.didNotPlay) continue;
          const vals = a.stats || [];
          if (!vals.length) continue;
          blockPush(baseGame.players[side], {
            name: a.athlete?.displayName || a.athlete?.shortName || "",
            starter: !!a.starter,
            min: statByLabel(labels,vals,"MIN") ?? "",
            pts: num(statByLabel(labels,vals,"PTS")),
            reb: num(statByLabel(labels,vals,"REB")),
            ast: num(statByLabel(labels,vals,"AST")),
            stl: num(statByLabel(labels,vals,"STL")),
            blk: num(statByLabel(labels,vals,"BLK")),
            fg:  statByLabel(labels,vals,"FG") ?? "",
            tp:  statByLabel(labels,vals,"3PT") ?? "",
          });
        }
      }
    } catch(e) { console.error("basketball summary failed", e); }
  }

  return { game: baseGame };
}
function blockPush(arr,o){ arr.push(o); }
function num(v){ const n=Number(v); return Number.isFinite(n)?n:0; }

// ── Check all bay area teams for live games ───────────────────────────────────
async function checkAllLiveGames() {
  const live = [];

  // MLB: Giants
  try {
    const ptDate = new Date().toLocaleDateString("en-CA",{timeZone:"America/Los_Angeles"});
    const tom = new Date(new Date().toLocaleString("en-US",{timeZone:"America/Los_Angeles"}));
    tom.setDate(tom.getDate()+1);
    const tomStr = tom.toLocaleDateString("en-CA",{timeZone:"America/Los_Angeles"});
    const data = await mlb(`/schedule?sportId=1&teamId=137&startDate=${ptDate}&endDate=${tomStr}`);
    for (const d of (data.dates||[])) {
      for (const g of (d.games||[])) {
        const gDate = new Date(g.gameDate).toLocaleDateString("en-CA",{timeZone:"America/Los_Angeles"});
        if (gDate===ptDate && g.status?.abstractGameState==="Live") {
          const ht=g.teams.home.team||g.teams.home, at=g.teams.away.team||g.teams.away;
          const isHome=ht.id===137;
          const opp=isHome?(at.name||at.teamName):(ht.name||ht.teamName);
          const bayScore=isHome?(g.teams.home.score??0):(g.teams.away.score??0);
          const oppScore=isHome?(g.teams.away.score??0):(g.teams.home.score??0);
          live.push({teamKey:"giants",opponent:`${isHome?"vs":"at"} ${opp}`,bayScore,oppScore,situation:"Live"});
        }
      }
    }
  } catch(e) { console.error("MLB check failed",e); }

  // Non-MLB: check WNBA (Valkyries), NBA (Warriors), NFL (49ers), NHL (Sharks)
  const sportChecks = [
    { sport:"wnba", teamKey:"valkyries", abbrevs:["GS","GSV"], espnId:"129689" },
    { sport:"nba",  teamKey:"warriors",  abbrevs:["GSW","GS"], espnId:"" },
    { sport:"nfl",  teamKey:"niners",    abbrevs:["SF","SFO"], espnId:"" },
    { sport:"nhl",  teamKey:"sharks",    abbrevs:["SJS","SJ"], espnId:"" },
  ];

  // Normalize either a pre-flattened game object OR ESPN's raw scoreboard event
  // into one consistent shape: {home,away,homeId,awayId,homeName,awayName,homeScore,awayScore,state,period,clock}
  function normalizeGames(raw) {
    if (!raw) return [];
    // Already an array of flat game objects?
    const arr = Array.isArray(raw) ? raw : (raw.events || raw.games || []);
    return arr.map(g => {
      // ESPN raw event shape
      if (g.competitions || g.competitors) {
        const comp = g.competitions ? g.competitions[0] : g;
        const cs = comp.competitors || [];
        const h = cs.find(c => c.homeAway === "home") || cs[0] || {};
        const a = cs.find(c => c.homeAway === "away") || cs[1] || {};
        const st = comp.status || g.status || {};
        return {
          home: h.team?.abbreviation, away: a.team?.abbreviation,
          homeId: String(h.team?.id ?? ""), awayId: String(a.team?.id ?? ""),
          homeName: h.team?.displayName || h.team?.name,
          awayName: a.team?.displayName || a.team?.name,
          homeScore: Number(h.score ?? 0), awayScore: Number(a.score ?? 0),
          state: st.type?.state, // "pre" | "in" | "post"
          period: st.period, clock: st.displayClock,
        };
      }
      // Already-flat shape (whatever /api/espn may produce)
      const state = g.state || (g.status === "inprogress" ? "in" : (g.status === "final" || g.status === "closed") ? "post" : g.status);
      return {
        home: g.home, away: g.away,
        homeId: String(g.homeId ?? ""), awayId: String(g.awayId ?? ""),
        homeName: g.homeName, awayName: g.awayName,
        homeScore: Number(g.homeScore ?? 0), awayScore: Number(g.awayScore ?? 0),
        state, period: g.period, clock: g.clock,
      };
    });
  }

  for (const {sport, teamKey, abbrevs, espnId} of sportChecks) {
    try {
      const games = normalizeGames(await espn(sport));
      for (const g of games) {
        const matches = id => id && espnId && id === espnId;
        const isBayHome = matches(g.homeId) || abbrevs.includes(g.home);
        const isBayAway = matches(g.awayId) || abbrevs.includes(g.away);
        const isLive = g.state === "in" || g.state === "inprogress";
        if ((isBayHome || isBayAway) && isLive) {
          const isHome = isBayHome;
          const opp = isHome ? g.awayName : g.homeName;
          const bayScore = isHome ? g.homeScore : g.awayScore;
          const oppScore = isHome ? g.awayScore : g.homeScore;
          // Period label per sport
          let situation = "Live";
          if (g.period && g.clock) {
            const pLabel = sport==="nhl"?`P${g.period}`:`Q${g.period}`;
            situation = `${pLabel} ${g.clock}`;
          } else if (g.period) {
            situation = sport==="nhl"?`Period ${g.period}`:`Q${g.period}`;
          }
          live.push({teamKey,opponent:`${isHome?"vs":"at"} ${opp||""}`.trim(),bayScore,oppScore,situation});
        }
      }
    } catch(e) { console.error(`${sport} check failed`,e); }
  }

  return live;
}

// ── MLB Giants full data ──────────────────────────────────────────────────────
async function fetchGiantsGame() {
  const ptDate = new Date().toLocaleDateString("en-CA",{timeZone:"America/Los_Angeles"});
  const tom = new Date(new Date().toLocaleString("en-US",{timeZone:"America/Los_Angeles"}));
  tom.setDate(tom.getDate()+1);
  const tStr = tom.toLocaleDateString("en-CA",{timeZone:"America/Los_Angeles"});

  const [schData, stData, pastData] = await Promise.all([
    mlb(`/schedule?sportId=1&teamId=137&startDate=${ptDate}&endDate=${tStr}`),
    mlb("/standings?leagueId=104&standingsTypes=regularSeason&hydrate=streak"),
    mlb(`/schedule?sportId=1&teamId=137&startDate=2026-03-01&endDate=${ptDate}&gameType=R`),
  ]);

  const nlWest = stData.records?.find(r=>r.division?.id===203);
  const standings = (nlWest?.teamRecords||[]).map((t,i)=>({
    rank:i+1,abbr:t.team.abbreviation,name:t.team.name,id:t.team.id,
    w:t.wins,l:t.losses,streak:t.streak?.streakCode||null,
  }));

  let todayGame=null;
  for (const d of (schData.dates||[])) {
    for (const g of (d.games||[])) {
      const gDate=new Date(g.gameDate).toLocaleDateString("en-CA",{timeZone:"America/Los_Angeles"});
      if (gDate===ptDate) { if(!todayGame||g.status?.abstractGameState==="Live") todayGame=g; }
    }
  }

  const allPast=[];
  for (const d of (pastData.dates||[])) for (const g of (d.games||[])) if(g.status?.abstractGameState==="Final") allPast.push(g);
  let lastGame=null;
  if (allPast.length) {
    const g=allPast[allPast.length-1];
    const ht=g.teams.home.team||g.teams.home, at=g.teams.away.team||g.teams.away;
    const isHome=ht.id===137;
    const sfScore=isHome?g.teams.home.score:g.teams.away.score;
    const oppScore=isHome?g.teams.away.score:g.teams.home.score;
    lastGame={won:sfScore>oppScore,sfScore,oppScore,oppName:isHome?(at.name||at.teamName):(ht.name||ht.teamName),oppId:isHome?at.id:ht.id};
  }

  const future=new Date(); future.setDate(future.getDate()+14);
  const fStr=future.toISOString().slice(0,10);
  const nextData=await mlb(`/schedule?sportId=1&teamId=137&startDate=${ptDate}&endDate=${fStr}`);
  let nextGame=null;
  outer: for (const d of (nextData.dates||[])) {
    for (const g of (d.games||[])) {
      if(g.status?.abstractGameState!=="Final"){
        const ht=g.teams.home.team||g.teams.home, at=g.teams.away.team||g.teams.away;
        const isHome=ht.id===137;
        nextGame={
          opponent:isHome?(at.name||at.teamName):(ht.name||ht.teamName),
          opponentId:isHome?at.id:ht.id,
          location:isHome?"Oracle Park":(ht.name||ht.teamName),
          date:new Date(g.gameDate).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",timeZone:"America/Los_Angeles"}),
          time:new Date(g.gameDate).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZoneName:"short",timeZone:"America/Los_Angeles"}),
        };
        break outer;
      }
    }
  }

  if (!todayGame) return {game:null,standings,lastGame,nextGame};

  const ht=todayGame.teams.home.team||todayGame.teams.home, at=todayGame.teams.away.team||todayGame.teams.away;
  // Derive abbreviations from the team id when possible so a missing/stale
  // abbreviation field can't silently fall back to the wrong hardcoded value.
  const abbrFor=(t,fallback)=>t.abbreviation||(t.id===137?"SF":fallback);
  const homeAbbr=abbrFor(ht,"HOME"), awayAbbr=abbrFor(at,"AWAY");
  const giantsIsHome=ht.id===137;
  const status=todayGame.status?.abstractGameState;
  const baseGame={
    hasGame:true,
    status:status==="Live"?"inprogress":status==="Final"?"complete":"scheduled",
    home:homeAbbr,away:awayAbbr,
    giantsIsHome,
    homeTeamName:ht.name||ht.teamName,awayTeamName:at.name||at.teamName,
    homeTeamId:ht.id,awayTeamId:at.id,
    // Scores keyed by physical side, never by abbreviation
    homeScore:0,awayScore:0,
    score:{[homeAbbr]:0,[awayAbbr]:0},
  };

  if (status==="Live"||status==="Final") {
    const pk=todayGame.gamePk;
    const [ls,bs]=await Promise.all([mlb(`/game/${pk}/linescore`),mlb(`/game/${pk}/boxscore`)]);
    baseGame.homeScore=ls.teams?.home?.runs??0;
    baseGame.awayScore=ls.teams?.away?.runs??0;
    baseGame.score[homeAbbr]=baseGame.homeScore;
    baseGame.score[awayAbbr]=baseGame.awayScore;
    const scoring_by_period={};
    (ls.innings||[]).forEach(inn=>{
      scoring_by_period[inn.num]={
        [homeAbbr]:inn.home?.runs!==undefined?inn.home.runs:"X",
        [awayAbbr]:inn.away?.runs!==undefined?inn.away.runs:"·",
      };
    });
    const rhe={
      [homeAbbr]:{runs:ls.teams?.home?.runs??0,hits:ls.teams?.home?.hits??0,errors:ls.teams?.home?.errors??0},
      [awayAbbr]:{runs:ls.teams?.away?.runs??0,hits:ls.teams?.away?.hits??0,errors:ls.teams?.away?.errors??0},
    };
    const batters={[homeAbbr]:[],[awayAbbr]:[]};
    const pitchers={[homeAbbr]:[],[awayAbbr]:[]};
    for (const [side,abbr] of [["home",homeAbbr],["away",awayAbbr]]) {
      const t=bs.teams?.[side]; if(!t) continue;
      const ids=t.battingOrder?.length?t.battingOrder:(t.batters||[]);
      ids.forEach(pid=>{
        const p=t.players?.[`ID${pid}`]; if(!p) return;
        const s=p.stats?.batting||{};
        batters[abbr].push({name:p.person.fullName,position:p.position?.abbreviation||"",ab:s.atBats??0,h:s.hits??0,hr:s.homeRuns??0,rbi:s.rbi??0,r:s.runs??0});
      });
      (t.pitchers||[]).forEach(pid=>{
        const p=t.players?.[`ID${pid}`]; if(!p) return;
        const s=p.stats?.pitching||{}; if(!s.inningsPitched) return;
        pitchers[abbr].push({name:p.person.fullName,ip:s.inningsPitched??"0.0",k:s.strikeOuts??0,bb:s.baseOnBalls??0,er:s.earnedRuns??0,status:t.activePitcher?.id===pid?"active":"done"});
      });
    }
    let atBat=null,count=null,onBase=null,inning=null,inningHalf=null,outs=null;
    if (status==="Live") {
      inning=ls.currentInning; inningHalf=ls.isTopInning?"top":"bottom";
      outs=ls.outs??0; count={balls:ls.balls??0,strikes:ls.strikes??0};
      onBase={first:!!ls.offense?.first,second:!!ls.offense?.second,third:!!ls.offense?.third};
      const bid=ls.offense?.batter?.id;
      if(bid){
        const side=ls.isTopInning?"away":"home";
        const bp=bs.teams?.[side]?.players?.[`ID${bid}`];
        if(bp){const s=bp.stats?.batting||{};atBat={name:bp.person.fullName,position:bp.position?.abbreviation||"",ab:s.atBats??0,h:s.hits??0};}
      }
    }
    return {game:{...baseGame,scoring_by_period,rhe,batters,pitchers,atBat,count,onBase,inning,inningHalf,outs},standings,lastGame,nextGame};
  }
  return {game:baseGame,standings,lastGame,nextGame};
}

// ── Shared components ─────────────────────────────────────────────────────────
function TeamLogo({src,size="2.8vw",fallbackText=""}) {
  const [err,setErr]=useState(false);
  if(err) return <div style={{width:size,height:size,borderRadius:"50%",background:"rgba(255,255,255,0.1)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{fontSize:`calc(${size}*0.35)`,fontWeight:900,color:"#fff"}}>{fallbackText}</span></div>;
  return <img src={src} alt="" onError={()=>setErr(true)} style={{width:size,height:size,objectFit:"contain",flexShrink:0}}/>;
}

function StreakBadge({streak}) {
  if(!streak) return null;
  const isW=streak.startsWith("W");
  return <div style={{display:"inline-flex",alignItems:"center",background:isW?"rgba(46,204,113,0.15)":"rgba(231,76,60,0.15)",border:`1px solid ${isW?"rgba(46,204,113,0.4)":"rgba(231,76,60,0.4)"}`,borderRadius:"0.3vw",padding:"0.15vw 0.5vw",fontFamily:"'Courier New',monospace",fontSize:"0.8vw",fontWeight:700,color:isW?"#2ecc71":"#e74c3c"}}>{streak}</div>;
}

function HomeBtn({onClick,label="← Home"}) {
  return <button onClick={onClick} style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.15)",color:"rgba(255,255,255,0.7)",padding:"0.5vw 1.2vw",borderRadius:3,fontSize:"0.75vw",fontFamily:"'Courier New',monospace",letterSpacing:"0.12em",cursor:"pointer",textTransform:"uppercase"}}>{label}</button>;
}

// ── Home screen ───────────────────────────────────────────────────────────────
function HomeScreen({liveGames,checking,onSelectGame,onStandings}) {
  const hasLive=liveGames.length>0;
  const isPhone=useIsPhone();
  // Size tokens swap based on viewport
  const s = isPhone ? {
    pad:"6vw 5vw", gap:"7vw", title:"7vw", subtitle:"3vw", liveLabel:"3vw",
    cardWrap:"100%", cardPad:"4vw 5vw", cardGap:"3.5vw", logo:"11vw",
    teamName:"5vw", opp:"3.2vw", score:"11vw", dash:"6vw", sit:"3vw",
    emptyPad:"6vw 8vw", emptyText:"3.6vw", btnPad:"4vw 10vw", btnText:"3.6vw",
  } : {
    pad:"4vw", gap:"2.5vw", title:"2.2vw", subtitle:"0.85vw", liveLabel:"0.75vw",
    cardWrap:"65vw", cardPad:"1.4vw 2.5vw", cardGap:"1.5vw", logo:"4vw",
    teamName:"1.8vw", opp:"0.9vw", score:"4vw", dash:"2.2vw", sit:"0.8vw",
    emptyPad:"2vw 4vw", emptyText:"1.1vw", btnPad:"1.2vw 5vw", btnText:"1.1vw",
  };
  return (
    <div style={{minHeight:"100vh",background:"#111",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:s.gap,padding:s.pad,fontFamily:"Georgia,serif"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:s.title,fontWeight:900,color:"#fff",letterSpacing:"0.05em"}}>BAY AREA SPORTS</div>
        <div style={{fontSize:s.subtitle,color:"rgba(255,255,255,0.58)",fontFamily:"'Courier New',monospace",letterSpacing:"0.2em",textTransform:"uppercase",marginTop:"0.5em"}}>Live Scores & Standings</div>
      </div>

      {hasLive ? (
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:isPhone?"3vw":"1vw",width:"100%",maxWidth:s.cardWrap}}>
          <div style={{fontSize:s.liveLabel,letterSpacing:"0.2em",color:"rgba(255,255,255,0.58)",fontFamily:"'Courier New',monospace",textTransform:"uppercase",marginBottom:"0.5em"}}>Live Now</div>
          {liveGames.map((g,i)=>{
            const team=TEAMS[g.teamKey];
            return (
              <button key={i} onClick={()=>onSelectGame(g.teamKey)} style={{
                width:"100%",background:`linear-gradient(135deg,${team.primary}22,${team.primary}44)`,
                border:`2px solid ${team.primary}`,borderRadius:6,
                padding:s.cardPad,cursor:"pointer",
                display:"flex",alignItems:"center",justifyContent:"space-between",gap:"3vw",
                transition:"all 0.2s",
              }}
                onMouseOver={e=>e.currentTarget.style.background=`linear-gradient(135deg,${team.primary}44,${team.primary}66)`}
                onMouseOut={e=>e.currentTarget.style.background=`linear-gradient(135deg,${team.primary}22,${team.primary}44)`}
              >
                <div style={{display:"flex",alignItems:"center",gap:s.cardGap,minWidth:0}}>
                  <TeamLogo src={team.logo} size={s.logo} fallbackText={team.name.slice(0,2)}/>
                  <div style={{textAlign:"left",minWidth:0}}>
                    <div style={{fontSize:s.teamName,fontWeight:900,color:"#fff"}}>{team.name}</div>
                    <div style={{fontSize:s.opp,color:"rgba(255,255,255,0.62)",fontFamily:"'Courier New',monospace",marginTop:"0.2em",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.opponent}</div>
                  </div>
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontSize:s.score,fontWeight:900,lineHeight:1,fontVariantNumeric:"tabular-nums",display:"flex",alignItems:"center",gap:"0.2em"}}>
                    <span style={{color:team.primary}}>{g.bayScore}</span>
                    <span style={{color:"rgba(255,255,255,0.5)",fontSize:s.dash}}>–</span>
                    <span style={{color:"rgba(255,255,255,0.8)"}}>{g.oppScore}</span>
                  </div>
                  <div style={{fontSize:s.sit,color:team.primary,fontFamily:"'Courier New',monospace",marginTop:"0.3em",whiteSpace:"nowrap"}}>{g.situation}</div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div style={{textAlign:"center",padding:s.emptyPad,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6}}>
          <div style={{fontSize:s.emptyText,color:"rgba(255,255,255,0.62)",fontFamily:"'Courier New',monospace",letterSpacing:"0.1em"}}>
            {checking?"CHECKING FOR LIVE GAMES…":"NO GAMES LIVE RIGHT NOW"}
          </div>
        </div>
      )}

      <button onClick={onStandings} style={{
        background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.2)",
        color:"#fff",padding:s.btnPad,borderRadius:4,
        fontSize:s.btnText,fontFamily:"'Courier New',monospace",letterSpacing:"0.2em",
        cursor:"pointer",textTransform:"uppercase",transition:"all 0.2s",
      }}
        onMouseOver={e=>{e.currentTarget.style.background="rgba(255,255,255,0.12)";e.currentTarget.style.borderColor="rgba(255,255,255,0.62)";}}
        onMouseOut={e=>{e.currentTarget.style.background="rgba(255,255,255,0.06)";e.currentTarget.style.borderColor="rgba(255,255,255,0.2)";}}
      >
        📊 Standings
      </button>
    </div>
  );
}

// ── Giants standings slide ────────────────────────────────────────────────────
const MLB_COLORS = {
  LAD:{color:"#005A9C",bg:"rgba(0,90,156,0.1)"},
  SD:{color:"#2F241D",bg:"rgba(100,70,50,0.15)"},
  AZ:{color:"#A71930",bg:"rgba(167,25,48,0.1)"},
  SF:{color:"#FD5A1E",bg:"rgba(253,90,30,0.12)"},
  COL:{color:"#7B4FBE",bg:"rgba(123,79,190,0.1)"},
};

function GiantsStandingsSlide({onHome}) {
  const [data,setData]=useState(null);
  const team=TEAMS.giants;
  const O=team.primary;

  useEffect(()=>{
    fetchGiantsGame().then(setData).catch(()=>setData({
      standings:[
        {rank:1,abbr:"LAD",name:"Los Angeles Dodgers",id:119,w:36,l:20,streak:"W1"},
        {rank:2,abbr:"AZ", name:"Arizona Diamondbacks",id:109,w:31,l:24,streak:"W3"},
        {rank:3,abbr:"SD", name:"San Diego Padres",    id:135,w:31,l:24,streak:"L1"},
        {rank:4,abbr:"SF", name:"San Francisco Giants",id:137,w:22,l:34,streak:"L1"},
        {rank:5,abbr:"COL",name:"Colorado Rockies",    id:115,w:20,l:37,streak:"L2"},
      ],
      lastGame:{won:false,sfScore:1,oppScore:3,oppName:"Milwaukee Brewers",oppId:158},
      nextGame:{opponent:"Milwaukee Brewers",opponentId:158,date:"Wed, Jun 3",time:"4:40 PM PDT",location:"American Family Field"},
    }));
  },[]);

  if (!data) return <div style={{height:"100%",background:"#27251F",display:"flex",alignItems:"center",justifyContent:"center",color:O,fontSize:"1.2vw",fontFamily:"'Courier New',monospace",letterSpacing:"0.2em"}}>LOADING…</div>;

  const {standings=[],lastGame,nextGame}=data;
  const leader=standings[0];

  return (
    <div style={{height:"100%",display:"flex",flexDirection:"column",background:`radial-gradient(ellipse at 20% 0%,#3d1c09 0%,#1a1210 50%)`,color:"#fff",fontFamily:"Georgia,serif",overflow:"hidden"}}>
      <div style={{height:"0.4vw",background:`linear-gradient(90deg,${O},#c94510)`,flexShrink:0}}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0.8vw 1.8vw",borderBottom:"1px solid rgba(255,255,255,0.07)",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:"0.8vw"}}>
          <TeamLogo src={team.logo} size="2.5vw" fallbackText="SF"/>
          <div style={{fontSize:"1.1vw",fontWeight:900,color:O}}>{team.fullName}</div>
        </div>
        <HomeBtn onClick={onHome}/>
      </div>
      <div style={{flex:1,padding:"1.2vw 1.8vw",display:"flex",flexDirection:"column",gap:"1vw",minHeight:0,overflowY:"auto"}}>
        {/* Next + Last game */}
        <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:"1vw",flexShrink:0}}>
          <div style={{background:"rgba(253,90,30,0.08)",border:"1px solid rgba(253,90,30,0.25)",borderRadius:4,padding:"1vw 1.5vw",display:"flex",alignItems:"center",gap:"1.2vw"}}>
            <div style={{flexShrink:0}}>
              <div style={{fontSize:"0.65vw",letterSpacing:"0.2em",color:"rgba(255,255,255,0.62)",textTransform:"uppercase",fontFamily:"'Courier New',monospace",marginBottom:"0.2vw"}}>Next Game</div>
              <div style={{fontSize:"0.65vw",color:"rgba(255,255,255,0.55)",fontFamily:"'Courier New',monospace"}}>{nextGame?.location}</div>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:"1.6vw",fontWeight:900,color:"#fff",lineHeight:1.1}}>
                <span style={{color:O}}>SF Giants</span>
                <span style={{color:"rgba(255,255,255,0.55)",margin:"0 0.6vw",fontWeight:400,fontSize:"1.1vw"}}>vs</span>
                <span>{nextGame?.opponent}</span>
              </div>
            </div>
            <div style={{flexShrink:0,textAlign:"right"}}>
              <div style={{fontSize:"1.6vw",fontWeight:900,color:O,fontFamily:"'Courier New',monospace",lineHeight:1}}>{nextGame?.time}</div>
              <div style={{fontSize:"0.8vw",color:"rgba(255,255,255,0.5)",fontFamily:"'Courier New',monospace",marginTop:"0.2vw"}}>{nextGame?.date}</div>
            </div>
          </div>
          {lastGame&&(
            <div style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:4,padding:"1vw 1.4vw",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"0.3vw",minWidth:"10vw"}}>
              <div style={{fontSize:"0.65vw",letterSpacing:"0.2em",color:"rgba(255,255,255,0.58)",textTransform:"uppercase",fontFamily:"'Courier New',monospace"}}>Last Game</div>
              <div style={{display:"flex",alignItems:"center",gap:"0.6vw"}}>
                <TeamLogo src={`https://www.mlbstatic.com/team-logos/${lastGame.oppId}.svg`} size="1.8vw" fallbackText="OPP"/>
                <div style={{fontSize:"1.8vw",fontWeight:900,fontFamily:"'Courier New',monospace",color:lastGame.won?"#2ecc71":"#e74c3c"}}>{lastGame.won?"W":"L"}</div>
                <div style={{fontSize:"1.3vw",fontWeight:700,color:"#fff",fontFamily:"'Courier New',monospace"}}>{lastGame.sfScore}–{lastGame.oppScore}</div>
              </div>
              <div style={{fontSize:"0.65vw",color:"rgba(255,255,255,0.55)",fontFamily:"'Courier New',monospace"}}>vs {lastGame.oppName}</div>
            </div>
          )}
        </div>
        {/* Standings */}
        <div style={{display:"flex",alignItems:"baseline",gap:"0.6vw",flexShrink:0}}>
          <div style={{fontSize:"1.8vw",fontWeight:900,color:"#fff"}}>NL West</div>
          <div style={{fontSize:"0.65vw",letterSpacing:"0.2em",color:"rgba(255,255,255,0.58)",textTransform:"uppercase",fontFamily:"'Courier New',monospace"}}>Standings</div>
        </div>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr style={{borderBottom:"1px solid rgba(255,255,255,0.1)"}}>
              {["#","","Team","W","L","PCT","GB","STREAK"].map((h,i)=>(
                <th key={i} style={{textAlign:i<3?"left":"center",padding:"0.3vw 0.6vw 0.6vw",color:"rgba(255,255,255,0.55)",fontWeight:400,fontSize:"0.65vw",letterSpacing:"0.15em",fontFamily:"'Courier New',monospace",textTransform:"uppercase"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {standings.map((t,i)=>{
              const isG=t.abbr==="SF";
              const meta=MLB_COLORS[t.abbr]||{color:"rgba(255,255,255,0.62)",bg:"transparent"};
              const pct=(t.w/(t.w+t.l)).toFixed(3).replace(/^0/,"");
              const gb=i===0?"—":(((leader.w-t.w)+(t.l-leader.l))/2).toFixed(1);
              return (
                <tr key={t.abbr} style={{borderBottom:"1px solid rgba(255,255,255,0.06)",background:isG?"rgba(253,90,30,0.1)":meta.bg,outline:isG?"1px solid rgba(253,90,30,0.3)":"none",outlineOffset:"-1px"}}>
                  <td style={{padding:"0.9vw 0.6vw",color:isG?O:"rgba(255,255,255,0.55)",fontSize:"0.9vw",fontFamily:"'Courier New',monospace",fontWeight:isG?700:400}}>{t.rank}</td>
                  <td style={{padding:"0.9vw 0.3vw",width:"3vw"}}><TeamLogo src={`https://www.mlbstatic.com/team-logos/${t.id}.svg`} size="2.5vw" fallbackText={t.abbr}/></td>
                  <td style={{padding:"0.9vw 0.6vw"}}>
                    <div style={{fontSize:"1.1vw",fontWeight:isG?900:500,color:isG?"#fff":"rgba(255,255,255,0.8)"}}>
                      {t.name.split(" ").pop()}
                      {isG&&<span style={{marginLeft:"0.5vw",fontSize:"0.6vw",color:O,fontFamily:"'Courier New',monospace"}}>YOUR TEAM</span>}
                    </div>
                  </td>
                  <td style={{textAlign:"center",padding:"0.9vw 0.6vw",fontSize:"1.3vw",fontWeight:800,color:isG?"#fff":"rgba(255,255,255,0.75)"}}>{t.w}</td>
                  <td style={{textAlign:"center",padding:"0.9vw 0.6vw",fontSize:"1.3vw",color:"rgba(255,255,255,0.65)"}}>{t.l}</td>
                  <td style={{textAlign:"center",padding:"0.9vw 0.6vw",fontFamily:"'Courier New',monospace",fontSize:"0.85vw",color:isG?O:"rgba(255,255,255,0.55)",fontWeight:isG?700:400}}>{pct}</td>
                  <td style={{textAlign:"center",padding:"0.9vw 0.6vw",fontFamily:"'Courier New',monospace",fontSize:"0.85vw",color:"rgba(255,255,255,0.62)"}}>{gb}</td>
                  <td style={{textAlign:"center",padding:"0.9vw 0.6vw"}}><StreakBadge streak={t.streak}/></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Generic off-season standings slide ───────────────────────────────────────
function OffSeasonSlide({teamKey,onHome}) {
  const team=TEAMS[teamKey];
  const bayTeam=team.bayTeam||team.fullName;
  const standings=team.lastStandings||[];
  const leader=standings[0];
  return (
    <div style={{height:"100%",display:"flex",flexDirection:"column",background:`linear-gradient(135deg,${team.primary}15 0%,#111 55%)`,color:"#fff",fontFamily:"Georgia,serif",overflow:"hidden"}}>
      <div style={{height:"0.4vw",background:`linear-gradient(90deg,${team.primary},${team.secondary})`,flexShrink:0}}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0.8vw 1.8vw",borderBottom:"1px solid rgba(255,255,255,0.07)",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:"0.8vw"}}>
          <TeamLogo src={team.logo} size="2.5vw" fallbackText={team.name.slice(0,2)}/>
          <div>
            <div style={{fontSize:"1.1vw",fontWeight:900,color:team.primary}}>{team.fullName}</div>
            <div style={{fontSize:"0.65vw",color:"rgba(255,255,255,0.62)",fontFamily:"'Courier New',monospace",letterSpacing:"0.15em",textTransform:"uppercase"}}>OFF SEASON</div>
          </div>
        </div>
        <HomeBtn onClick={onHome}/>
      </div>
      <div style={{flex:1,padding:"2vw 2.5vw",display:"flex",flexDirection:"column",gap:"1.5vw",overflowY:"auto"}}>
        <div style={{display:"flex",alignItems:"baseline",gap:"0.8vw"}}>
          <div style={{fontSize:"2vw",fontWeight:900,color:"#fff"}}>{team.division}</div>
          <div style={{fontSize:"0.7vw",letterSpacing:"0.18em",color:team.primary,fontFamily:"'Courier New',monospace",textTransform:"uppercase"}}>{team.lastSeasonLabel}</div>
        </div>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr style={{borderBottom:"1px solid rgba(255,255,255,0.1)"}}>
              {["#","Team","W","L","PCT","GB"].map((h,i)=>(
                <th key={h} style={{textAlign:i<2?"left":"center",padding:"0.4vw 0.8vw 0.7vw",color:"rgba(255,255,255,0.55)",fontWeight:400,fontSize:"0.7vw",letterSpacing:"0.15em",fontFamily:"'Courier New',monospace",textTransform:"uppercase"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {standings.map((t,i)=>{
              const isBay=t.name===bayTeam;
              const pct=((t.w/(t.w+t.l))||0).toFixed(3).replace(/^0/,"");
              const gb=i===0?"—":(((leader.w-t.w)+(t.l-leader.l))/2).toFixed(1);
              return (
                <tr key={i} style={{borderBottom:"1px solid rgba(255,255,255,0.06)",background:isBay?`${team.primary}18`:"transparent",outline:isBay?`1px solid ${team.primary}44`:"none",outlineOffset:"-1px"}}>
                  <td style={{padding:"1.2vw 0.8vw",color:isBay?team.primary:"rgba(255,255,255,0.55)",fontSize:"1vw",fontFamily:"'Courier New',monospace",fontWeight:isBay?700:400}}>{t.rank}</td>
                  <td style={{padding:"1.2vw 0.8vw",fontSize:"1.3vw",fontWeight:isBay?900:500,color:isBay?"#fff":"rgba(255,255,255,0.75)"}}>
                    {t.name}
                    {isBay&&<span style={{marginLeft:"0.6vw",fontSize:"0.65vw",color:team.primary,fontFamily:"'Courier New',monospace"}}>YOUR TEAM</span>}
                  </td>
                  <td style={{textAlign:"center",padding:"1.2vw 0.8vw",fontSize:"1.5vw",fontWeight:700,color:isBay?"#fff":"rgba(255,255,255,0.7)"}}>{t.w}</td>
                  <td style={{textAlign:"center",padding:"1.2vw 0.8vw",fontSize:"1.5vw",color:"rgba(255,255,255,0.65)"}}>{t.l}</td>
                  <td style={{textAlign:"center",padding:"1.2vw 0.8vw",fontFamily:"'Courier New',monospace",fontSize:"0.95vw",color:isBay?team.primary:"rgba(255,255,255,0.55)"}}>{pct}</td>
                  <td style={{textAlign:"center",padding:"1.2vw 0.8vw",fontFamily:"'Courier New',monospace",fontSize:"0.95vw",color:"rgba(255,255,255,0.62)"}}>{gb}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Valkyries live standings slide ────────────────────────────────────────────
function ValkyriasStandingsSlide({onHome}) {
  const team=TEAMS.valkyries;
  // Current WNBA Western Conference standings (live seed)
  const standings=[
    {rank:1,name:"Minnesota Lynx",        w:5,l:2},
    {rank:2,name:"Golden State Valkyries", w:5,l:2},
    {rank:3,name:"Dallas Wings",           w:5,l:3},
    {rank:4,name:"Portland Fire",          w:5,l:3},
    {rank:5,name:"Las Vegas Aces",         w:4,l:3},
    {rank:6,name:"Los Angeles Sparks",     w:3,l:3},
    {rank:7,name:"Seattle Storm",          w:3,l:5},
    {rank:8,name:"Phoenix Mercury",        w:2,l:6},
  ];
  const leader=standings[0];
  const bayTeam="Golden State Valkyries";
  return (
    <div style={{height:"100%",display:"flex",flexDirection:"column",background:`linear-gradient(135deg,${team.primary}18 0%,#111 55%)`,color:"#fff",fontFamily:"Georgia,serif",overflow:"hidden"}}>
      <div style={{height:"0.4vw",background:`linear-gradient(90deg,${team.primary},${team.secondary})`,flexShrink:0}}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0.8vw 1.8vw",borderBottom:"1px solid rgba(255,255,255,0.07)",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:"0.8vw"}}>
          <TeamLogo src={team.logo} size="2.5vw" fallbackText="GSV"/>
          <div>
            <div style={{fontSize:"1.1vw",fontWeight:900,color:team.primary}}>{team.fullName}</div>
            <div style={{fontSize:"0.65vw",color:"rgba(255,255,255,0.62)",fontFamily:"'Courier New',monospace",letterSpacing:"0.15em",textTransform:"uppercase"}}>IN SEASON · 2025-26</div>
          </div>
        </div>
        <HomeBtn onClick={onHome}/>
      </div>
      <div style={{flex:1,padding:"2vw 2.5vw",display:"flex",flexDirection:"column",gap:"1.5vw",overflowY:"auto"}}>
        {/* Next game */}
        <div style={{background:`${team.primary}15`,border:`1px solid ${team.primary}44`,borderRadius:4,padding:"1vw 1.5vw",display:"flex",alignItems:"center",justifyContent:"space-between",gap:"1vw"}}>
          <div>
            <div style={{fontSize:"0.65vw",letterSpacing:"0.2em",color:"rgba(255,255,255,0.62)",textTransform:"uppercase",fontFamily:"'Courier New',monospace",marginBottom:"0.3vw"}}>Next Game · Chase Center</div>
            <div style={{fontSize:"1.6vw",fontWeight:900,color:"#fff"}}><span style={{color:team.primary}}>Valkyries</span> vs Portland Fire</div>
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            <div style={{fontSize:"1.6vw",fontWeight:900,color:team.primary,fontFamily:"'Courier New',monospace"}}>7:00 PM PDT</div>
            <div style={{fontSize:"0.8vw",color:"rgba(255,255,255,0.5)",fontFamily:"'Courier New',monospace"}}>Tue, Jun 2</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"baseline",gap:"0.8vw"}}>
          <div style={{fontSize:"2vw",fontWeight:900,color:"#fff"}}>Western Conference</div>
          <div style={{fontSize:"0.7vw",letterSpacing:"0.18em",color:team.primary,fontFamily:"'Courier New',monospace",textTransform:"uppercase"}}>WNBA 2025-26</div>
        </div>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr style={{borderBottom:"1px solid rgba(255,255,255,0.1)"}}>
              {["#","Team","W","L","PCT","GB"].map((h,i)=>(
                <th key={h} style={{textAlign:i<2?"left":"center",padding:"0.4vw 0.8vw 0.7vw",color:"rgba(255,255,255,0.55)",fontWeight:400,fontSize:"0.7vw",letterSpacing:"0.15em",fontFamily:"'Courier New',monospace",textTransform:"uppercase"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {standings.map((t,i)=>{
              const isBay=t.name===bayTeam;
              const pct=(t.w/(t.w+t.l)).toFixed(3).replace(/^0/,"");
              const gb=i===0?"—":(((leader.w-t.w)+(t.l-leader.l))/2).toFixed(1);
              return (
                <tr key={i} style={{borderBottom:"1px solid rgba(255,255,255,0.06)",background:isBay?`${team.primary}18`:"transparent",outline:isBay?`1px solid ${team.primary}44`:"none",outlineOffset:"-1px"}}>
                  <td style={{padding:"1vw 0.8vw",color:isBay?team.primary:"rgba(255,255,255,0.55)",fontSize:"1vw",fontFamily:"'Courier New',monospace",fontWeight:isBay?700:400}}>{t.rank}</td>
                  <td style={{padding:"1vw 0.8vw",fontSize:"1.3vw",fontWeight:isBay?900:500,color:isBay?"#fff":"rgba(255,255,255,0.75)"}}>
                    {t.name}
                    {isBay&&<span style={{marginLeft:"0.6vw",fontSize:"0.65vw",color:team.primary,fontFamily:"'Courier New',monospace"}}>YOUR TEAM</span>}
                  </td>
                  <td style={{textAlign:"center",padding:"1vw 0.8vw",fontSize:"1.4vw",fontWeight:700,color:isBay?"#fff":"rgba(255,255,255,0.7)"}}>{t.w}</td>
                  <td style={{textAlign:"center",padding:"1vw 0.8vw",fontSize:"1.4vw",color:"rgba(255,255,255,0.65)"}}>{t.l}</td>
                  <td style={{textAlign:"center",padding:"1vw 0.8vw",fontFamily:"'Courier New',monospace",fontSize:"0.95vw",color:isBay?team.primary:"rgba(255,255,255,0.55)"}}>{pct}</td>
                  <td style={{textAlign:"center",padding:"1vw 0.8vw",fontFamily:"'Courier New',monospace",fontSize:"0.95vw",color:"rgba(255,255,255,0.62)"}}>{gb}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Carousel ──────────────────────────────────────────────────────────────────
function StandingsCarousel({onHome}) {
  const [idx,setIdx]=useState(0);
  const [paused,setPaused]=useState(false);
  const [progress,setProgress]=useState(0);
  const timerRef=useRef(null);
  const progRef=useRef(null);
  const startRef=useRef(Date.now());
  const elapsed=useRef(0);

  const go=useCallback((newIdx)=>{
    setIdx((newIdx+CAROUSEL_ORDER.length)%CAROUSEL_ORDER.length);
    elapsed.current=0; setProgress(0); startRef.current=Date.now();
  },[]);

  useEffect(()=>{
    if(paused){clearTimeout(timerRef.current);clearInterval(progRef.current);return;}
    startRef.current=Date.now()-elapsed.current;
    timerRef.current=setTimeout(()=>go(idx+1),SLIDE_DURATION-elapsed.current);
    progRef.current=setInterval(()=>{
      const e=Date.now()-startRef.current; elapsed.current=e;
      setProgress(Math.min(e/SLIDE_DURATION,1));
    },50);
    return()=>{clearTimeout(timerRef.current);clearInterval(progRef.current);};
  },[idx,paused,go]);

  const teamKey=CAROUSEL_ORDER[idx];
  const team=TEAMS[teamKey];

  function renderSlide() {
    if (teamKey==="giants") return <GiantsStandingsSlide onHome={onHome}/>;
    if (teamKey==="valkyries") return <ValkyriasStandingsSlide onHome={onHome}/>;
    return <OffSeasonSlide teamKey={teamKey} onHome={onHome}/>;
  }

  return (
    <div style={{position:"fixed",inset:0,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{flex:1,minHeight:0}}>{renderSlide()}</div>
      {/* Bottom nav */}
      <div style={{background:"rgba(0,0,0,0.9)",borderTop:"1px solid rgba(255,255,255,0.08)",padding:"0.6vw 1.5vw",display:"flex",alignItems:"center",gap:"1vw",flexShrink:0}}>
        <button onClick={()=>go(idx-1)} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.15)",color:"#fff",padding:"0.4vw 1vw",borderRadius:3,fontSize:"0.75vw",fontFamily:"'Courier New',monospace",cursor:"pointer"}}>◀</button>
        <div style={{display:"flex",gap:"0.6vw",alignItems:"center",flex:1,justifyContent:"center"}}>
          {CAROUSEL_ORDER.map((key,i)=>{
            const t=TEAMS[key];
            const isActive=i===idx;
            return (
              <button key={key} onClick={()=>go(i)} style={{display:"flex",alignItems:"center",gap:"0.4vw",background:isActive?`${t.primary}33`:"rgba(255,255,255,0.04)",border:`1px solid ${isActive?t.primary:"rgba(255,255,255,0.1)"}`,borderRadius:3,padding:"0.3vw 0.8vw",cursor:"pointer",transition:"all 0.2s"}}>
                <TeamLogo src={t.logo} size="1.4vw" fallbackText={t.name.slice(0,2)}/>
                <span style={{fontSize:"0.7vw",fontFamily:"'Courier New',monospace",color:isActive?t.primary:"rgba(255,255,255,0.62)",fontWeight:isActive?700:400}}>{t.name}</span>
              </button>
            );
          })}
        </div>
        <div style={{width:"8vw",height:"3px",background:"rgba(255,255,255,0.1)",borderRadius:2,overflow:"hidden"}}>
          <div style={{width:`${progress*100}%`,height:"100%",background:team.primary,transition:"width 0.05s linear"}}/>
        </div>
        <button onClick={()=>setPaused(p=>!p)} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.15)",color:"#fff",padding:"0.4vw 1vw",borderRadius:3,fontSize:"0.75vw",fontFamily:"'Courier New',monospace",cursor:"pointer",minWidth:"3.5vw"}}>{paused?"▶":"⏸"}</button>
        <button onClick={()=>go(idx+1)} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.15)",color:"#fff",padding:"0.4vw 1vw",borderRadius:3,fontSize:"0.75vw",fontFamily:"'Courier New',monospace",cursor:"pointer"}}>▶</button>
      </div>
    </div>
  );
}

// ── Giants live scoreboard ────────────────────────────────────────────────────
function Diamond({onBase}) {
  const s=56,cx=28,cy=28,r=15;
  const bases=[{id:"second",x:cx,y:cy-r,active:onBase?.second},{id:"third",x:cx-r,y:cy,active:onBase?.third},{id:"first",x:cx+r,y:cy,active:onBase?.first}];
  const O="#FD5A1E";
  return (
    <svg width="4.5vw" height="4.5vw" viewBox={`0 0 ${s} ${s}`}>
      <polygon points={`${cx},${cy-r} ${cx+r},${cy} ${cx},${cy+r} ${cx-r},${cy}`} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5"/>
      {bases.map(b=><rect key={b.id} x={b.x-5} y={b.y-5} width={10} height={10} transform={`rotate(45,${b.x},${b.y})`} fill={b.active?O:"rgba(255,255,255,0.1)"} style={{filter:b.active?`drop-shadow(0 0 5px ${O})`:"none",transition:"fill 0.4s"}}/>)}
      <polygon points={`${cx},${cy+r+4} ${cx-4},${cy+r} ${cx-4},${cy+r-4} ${cx+4},${cy+r-4} ${cx+4},${cy+r}`} fill="rgba(255,255,255,0.12)"/>
    </svg>
  );
}

function DotGroup({count,total,activeColor,label}) {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"0.4vw"}}>
      <div style={{fontSize:"0.65vw",letterSpacing:"0.16em",color:"rgba(255,255,255,0.55)",textTransform:"uppercase",fontFamily:"'Courier New',monospace"}}>{label}</div>
      <div style={{display:"flex",gap:"0.4vw"}}>
        {Array.from({length:total}).map((_,i)=>(
          <div key={i} style={{width:"0.9vw",height:"0.9vw",borderRadius:"50%",background:i<count?activeColor:"rgba(255,255,255,0.1)",border:`1.5px solid ${i<count?activeColor:"rgba(255,255,255,0.2)"}`,boxShadow:i<count?`0 0 7px ${activeColor}88`:"none",transition:"all 0.25s"}}/>
        ))}
      </div>
    </div>
  );
}

function GiantsScoreboardMobile({onHome,game,sfAbbr,oppAbbr,giantsIsHome,giantsIsAway,giantsWinning,homeAbbr,awayAbbr,homeScore,awayScore}) {
  const O="#FD5A1E";
  const inningLabel = game.inning===1?"1st":game.inning===2?"2nd":game.inning===3?"3rd":`${game.inning}th`;
  const Side = ({name,id,abbr,score,isG,winning}) => (
    <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",alignItems:"center",gap:"1.5vw"}}>
      <TeamLogo src={`https://www.mlbstatic.com/team-logos/${id}.svg`} size="11vw" fallbackText={abbr}/>
      <div style={{fontSize:"3.6vw",fontWeight:800,color:isG?O:"rgba(255,255,255,0.85)",textAlign:"center",lineHeight:1.1}}>{name}</div>
      <div style={{fontSize:"17vw",fontWeight:900,lineHeight:1,fontVariantNumeric:"tabular-nums",color:isG?O:"rgba(255,255,255,0.92)",textShadow:(isG&&winning)?`0 0 8vw rgba(253,90,30,0.5)`:"none"}}>{score}</div>
    </div>
  );
  return (
    <div style={{position:"fixed",inset:0,background:`radial-gradient(ellipse at 50% 0%,#3d1c09 0%,#27251F 55%)`,fontFamily:"Georgia,serif",color:"#fff",display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{height:"1vw",background:`linear-gradient(90deg,${O},#c94510)`,flexShrink:0}}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"3vw 4vw",borderBottom:"1px solid rgba(255,255,255,0.1)",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:"2vw"}}>
          <div style={{width:"2.4vw",height:"2.4vw",borderRadius:"50%",background:"#2ecc71",boxShadow:"0 0 10px #2ecc71",animation:"livePulse 1.8s ease-in-out infinite"}}/>
          <span style={{fontSize:"3vw",letterSpacing:"0.15em",color:"#2ecc71",fontFamily:"'Courier New',monospace",textTransform:"uppercase"}}>Live · Giants</span>
        </div>
        <button onClick={onHome} style={{background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",color:"rgba(255,255,255,0.8)",padding:"1.6vw 3.5vw",borderRadius:4,fontSize:"3vw",fontFamily:"'Courier New',monospace",letterSpacing:"0.08em",cursor:"pointer",textTransform:"uppercase"}}>Home</button>
      </div>
      <div style={{flex:1,minHeight:0,overflowY:"auto",padding:"5vw 4vw",WebkitOverflowScrolling:"touch"}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:"5vw"}}>
          <Side name={game.awayTeamName} id={game.awayTeamId} abbr={awayAbbr} score={awayScore} isG={giantsIsAway} winning={giantsWinning}/>
          <div style={{flexShrink:0,padding:"3vw 1vw 0",display:"flex",flexDirection:"column",alignItems:"center",gap:"1vw"}}>
            <span style={{fontSize:"4vw",color:"rgba(255,255,255,0.35)",fontWeight:900}}>–</span>
            <span style={{fontSize:"3vw",color:"rgba(255,255,255,0.6)",fontFamily:"'Courier New',monospace",whiteSpace:"nowrap"}}>{game.inningHalf==="top"?"\u25B2":"\u25BC"} {inningLabel}</span>
          </div>
          <Side name={game.homeTeamName} id={game.homeTeamId} abbr={homeAbbr} score={homeScore} isG={giantsIsHome} winning={giantsWinning}/>
        </div>
        {game.atBat&&(
          <div style={{background:"rgba(253,90,30,0.1)",border:"1px solid rgba(253,90,30,0.3)",borderRadius:6,padding:"3.5vw 4vw",textAlign:"center",marginBottom:"4vw"}}>
            <div style={{fontSize:"2.8vw",letterSpacing:"0.16em",color:"rgba(255,255,255,0.55)",textTransform:"uppercase",fontFamily:"'Courier New',monospace",marginBottom:"1.5vw"}}>At Bat</div>
            <div style={{fontSize:"5vw",fontWeight:800,color:"#fff"}}>{game.atBat.name}</div>
            <div style={{display:"flex",justifyContent:"center",gap:"2vw",marginTop:"1.5vw"}}>
              <span style={{fontSize:"3vw",color:O,fontFamily:"'Courier New',monospace",background:"rgba(253,90,30,0.18)",padding:"0.6vw 2vw",borderRadius:3}}>{game.atBat.position}</span>
              <span style={{fontSize:"3vw",color:"rgba(255,255,255,0.5)",fontFamily:"'Courier New',monospace"}}>{game.atBat.h}-for-{game.atBat.ab}</span>
            </div>
          </div>
        )}
        {game.count!=null&&(
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-around",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6,padding:"3.5vw 2vw",marginBottom:"4vw"}}>
            <MobileDots count={game.count.balls} total={4} color="#4caf50" label="Balls"/>
            <MobileDots count={game.count.strikes} total={3} color="#e05252" label="Strikes"/>
            <MobileDots count={game.outs} total={3} color="#e8b84b" label="Outs"/>
            {game.onBase&&<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"1.2vw"}}><div style={{fontSize:"2.6vw",letterSpacing:"0.12em",color:"rgba(255,255,255,0.5)",textTransform:"uppercase",fontFamily:"'Courier New',monospace"}}>Bases</div><Diamond onBase={game.onBase}/></div>}
          </div>
        )}
        <div style={{marginBottom:"4vw"}}>
          <div style={{fontSize:"2.8vw",letterSpacing:"0.18em",color:"rgba(255,255,255,0.5)",textTransform:"uppercase",fontFamily:"'Courier New',monospace",marginBottom:"1.5vw"}}>Linescore</div>
          <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
            <table style={{borderCollapse:"collapse",fontFamily:"'Courier New',monospace",minWidth:"100%"}}>
              <thead><tr>
                <th style={{textAlign:"left",padding:"1vw 2vw 1.5vw 0",color:"rgba(255,255,255,0.55)",fontWeight:400,fontSize:"2.8vw"}}>TEAM</th>
                {Object.keys(game.scoring_by_period||{}).map(i=><th key={i} style={{textAlign:"center",padding:"1vw 1.5vw",color:"rgba(255,255,255,0.55)",fontWeight:400,fontSize:"2.8vw"}}>{i}</th>)}
                {["R","H","E"].map((h,hi)=><th key={h} style={{textAlign:"center",padding:"1vw 1.5vw",color:"rgba(255,255,255,0.55)",fontWeight:400,fontSize:"2.8vw",borderLeft:hi===0?"1px solid rgba(255,255,255,0.12)":"none"}}>{h}</th>)}
              </tr></thead>
              <tbody>
                {[awayAbbr,homeAbbr].map((abbr)=>(
                  <tr key={abbr} style={{borderTop:"1px solid rgba(255,255,255,0.08)"}}>
                    <td style={{padding:"1.5vw 2vw 1.5vw 0",fontWeight:700,fontSize:"3.4vw",color:abbr===sfAbbr?O:"rgba(255,255,255,0.7)"}}>{abbr}</td>
                    {Object.entries(game.scoring_by_period||{}).map(([inn,vals])=>{const val=vals[abbr],isX=val==="X";return <td key={inn} style={{textAlign:"center",padding:"1.5vw 1.5vw",fontSize:"3vw",color:isX?"rgba(255,255,255,0.25)":val>0?"#fff":"rgba(255,255,255,0.5)",fontWeight:val>0?700:400}}>{isX?"\u2014":val??"\u00B7"}</td>;})}
                    <td style={{textAlign:"center",padding:"1.5vw 1.5vw",fontWeight:800,fontSize:"3.6vw",color:"#fff",borderLeft:"1px solid rgba(255,255,255,0.12)"}}>{game.rhe?.[abbr]?.runs??""}</td>
                    <td style={{textAlign:"center",padding:"1.5vw 1.5vw",color:"rgba(255,255,255,0.75)",fontSize:"3vw"}}>{game.rhe?.[abbr]?.hits??""}</td>
                    <td style={{textAlign:"center",padding:"1.5vw 1.5vw",color:(game.rhe?.[abbr]?.errors??0)>0?"#e74c3c":"rgba(255,255,255,0.5)",fontSize:"3vw"}}>{game.rhe?.[abbr]?.errors??""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div style={{marginBottom:"4vw"}}>
          <div style={{fontSize:"2.8vw",letterSpacing:"0.18em",color:O,opacity:0.85,textTransform:"uppercase",fontFamily:"'Courier New',monospace",marginBottom:"1.5vw"}}>Giants Batting</div>
          <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'Courier New',monospace"}}>
            <thead><tr>{["Player","AB","H","HR","RBI","R"].map(h=><th key={h} style={{textAlign:h==="Player"?"left":"center",padding:"0.8vw 1vw 1.5vw",color:"rgba(255,255,255,0.5)",fontWeight:400,fontSize:"2.6vw"}}>{h}</th>)}</tr></thead>
            <tbody>
              {(game.batters?.[sfAbbr]||[]).map((p,i)=>{const isUp=game.atBat?.name===p.name;return(
                <tr key={i} style={{borderTop:"1px solid rgba(255,255,255,0.06)",background:isUp?"rgba(253,90,30,0.1)":"transparent"}}>
                  <td style={{padding:"1.5vw 1vw 1.5vw 0",color:"#fff",fontSize:"3vw"}}>
                    {isUp&&<span style={{display:"inline-block",width:"1.6vw",height:"1.6vw",borderRadius:"50%",background:O,marginRight:"1.2vw",verticalAlign:"middle"}}/>}
                    <span style={{color:"rgba(255,255,255,0.5)",marginRight:"1.2vw",fontSize:"2.6vw"}}>{p.position}</span>{p.name}
                  </td>
                  {[p.ab,p.h,p.hr,p.rbi,p.r].map((v,j)=><td key={j} style={{textAlign:"center",padding:"1.5vw 1vw",fontSize:"3vw",color:j===2||j===3?(v||0)>0?O:"rgba(255,255,255,0.3)":(v||0)>0?"#fff":"rgba(255,255,255,0.4)",fontWeight:(v||0)>0&&j>0?700:400}}>{j>0?(v||"\u2014"):v}</td>)}
                </tr>
              );})}
            </tbody>
          </table>
        </div>
        <div>
          <div style={{fontSize:"2.8vw",letterSpacing:"0.18em",color:O,opacity:0.85,textTransform:"uppercase",fontFamily:"'Courier New',monospace",marginBottom:"1.5vw"}}>Pitching</div>
          {[{label:sfAbbr===homeAbbr?game.homeTeamName:game.awayTeamName,key:sfAbbr},{label:oppAbbr===homeAbbr?game.homeTeamName:game.awayTeamName,key:oppAbbr}].map(({label,key})=>(
            <div key={key} style={{marginBottom:key===sfAbbr?"3vw":0}}>
              <div style={{fontSize:"2.6vw",color:"rgba(255,255,255,0.5)",textTransform:"uppercase",fontFamily:"'Courier New',monospace",marginBottom:"1vw",letterSpacing:"0.08em"}}>{label}</div>
              <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'Courier New',monospace"}}>
                <thead><tr>{["Pitcher","IP","K","BB","ER"].map(h=><th key={h} style={{textAlign:h==="Pitcher"?"left":"center",padding:"0.8vw 1vw 1vw",color:"rgba(255,255,255,0.5)",fontWeight:400,fontSize:"2.6vw"}}>{h}</th>)}</tr></thead>
                <tbody>
                  {(game.pitchers?.[key]||[]).map((p,i)=>(
                    <tr key={i} style={{borderTop:"1px solid rgba(255,255,255,0.06)"}}>
                      <td style={{padding:"1.3vw 1vw 1.3vw 0",color:"#fff",fontSize:"3vw"}}>
                        {p.status==="active"&&<span style={{display:"inline-block",width:"1.6vw",height:"1.6vw",borderRadius:"50%",background:"#2ecc71",marginRight:"1.2vw",verticalAlign:"middle"}}/>}
                        {p.name}
                      </td>
                      {[p.ip,p.k,p.bb,p.er].map((v,j)=><td key={j} style={{textAlign:"center",padding:"1.3vw 1vw",fontSize:"3vw",color:j===3&&v>0?"#e74c3c":"rgba(255,255,255,0.7)"}}>{v??0}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
      <style>{`@keyframes livePulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.8)}}`}</style>
    </div>
  );
}

function MobileDots({count,total,color,label}) {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"1.2vw"}}>
      <div style={{fontSize:"2.6vw",letterSpacing:"0.1em",color:"rgba(255,255,255,0.5)",textTransform:"uppercase",fontFamily:"'Courier New',monospace"}}>{label}</div>
      <div style={{display:"flex",gap:"1.2vw"}}>
        {Array.from({length:total}).map((_,i)=>(
          <div key={i} style={{width:"2.6vw",height:"2.6vw",borderRadius:"50%",background:i<count?color:"rgba(255,255,255,0.1)",border:`1.5px solid ${i<count?color:"rgba(255,255,255,0.25)"}`,boxShadow:i<count?`0 0 6px ${color}88`:"none"}}/>
        ))}
      </div>
    </div>
  );
}

function GiantsScoreboard({onHome}) {
  const [gdata,setGdata]=useState(null);
  const [refreshing,setRefreshing]=useState(true);
  const [lastUpdate,setLastUpdate]=useState(null);
  const isPhone=useIsPhone();
  const team=TEAMS.giants;
  const O=team.primary;

  const refresh=useCallback(async()=>{
    setRefreshing(true);
    try { const r=await fetchGiantsGame(); setGdata(r); setLastUpdate(new Date()); }
    catch(e){ console.error(e); }
    finally { setRefreshing(false); }
  },[]);

  useEffect(()=>{ refresh(); const t=setInterval(refresh,30000); return()=>clearInterval(t); },[refresh]);

  const game=gdata?.game;
  const isLive=game?.status==="inprogress";
  const homeAbbr=game?.home||"HOME", awayAbbr=game?.away||"AWAY";
  // Use side-based scores from the data layer (keyed by home/away, not abbreviation)
  const homeScore=game?.homeScore??game?.score?.[homeAbbr]??0;
  const awayScore=game?.awayScore??game?.score?.[awayAbbr]??0;
  // The data layer already identified the Giants by team id 137.
  const giantsIsHome = !!game?.giantsIsHome;
  const giantsIsAway = !giantsIsHome;
  const sfAbbr   = giantsIsHome ? homeAbbr : awayAbbr;
  const oppAbbr  = giantsIsHome ? awayAbbr : homeAbbr;
  const sfTeamName  = giantsIsHome ? game?.homeTeamName : game?.awayTeamName;
  const oppTeamName = giantsIsHome ? game?.awayTeamName : game?.homeTeamName;
  const giantsWinning = giantsIsHome ? homeScore>awayScore : awayScore>homeScore;

  if(!gdata) return <div style={{height:"100vh",background:"#27251F",display:"flex",alignItems:"center",justifyContent:"center",color:O,fontSize:"1.2vw",fontFamily:"'Courier New',monospace",letterSpacing:"0.2em"}}>LOADING…</div>;

  // If no live game, show standings
  if(!isLive) return <GiantsStandingsSlide onHome={onHome}/>;

  // Phone (portrait) gets a dedicated stacked layout
  if(isPhone) return <GiantsScoreboardMobile onHome={onHome} game={game} sfAbbr={sfAbbr} oppAbbr={oppAbbr} giantsIsHome={giantsIsHome} giantsIsAway={giantsIsAway} giantsWinning={giantsWinning} homeAbbr={homeAbbr} awayAbbr={awayAbbr} homeScore={homeScore} awayScore={awayScore}/>;

  return (
    <div style={{position:"fixed",inset:0,background:`radial-gradient(ellipse at 20% 0%,#3d1c09 0%,#27251F 50%)`,fontFamily:"Georgia,serif",color:"#fff",display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{height:"0.4vw",background:`linear-gradient(90deg,${O},#c94510)`,flexShrink:0}}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0.7vw 1.4vw",borderBottom:"1px solid rgba(255,255,255,0.07)",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:"0.7vw"}}>
          <div style={{width:"0.7vw",height:"0.7vw",borderRadius:"50%",background:"#2ecc71",boxShadow:"0 0 10px #2ecc71",animation:"livePulse 1.8s ease-in-out infinite"}}/>
          <span style={{fontSize:"0.8vw",letterSpacing:"0.2em",color:"#2ecc71",fontFamily:"'Courier New',monospace",textTransform:"uppercase"}}>Live · SF Giants</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:"1vw"}}>
          <span style={{fontSize:"0.8vw",color:"rgba(255,255,255,0.5)",fontFamily:"'Courier New',monospace"}}>{refreshing?"Refreshing…":lastUpdate?`Updated ${lastUpdate.toLocaleTimeString()}`:""}</span>
          <button onClick={refresh} disabled={refreshing} style={{background:"transparent",border:`1px solid rgba(253,90,30,0.35)`,color:O,padding:"0.3vw 1vw",borderRadius:2,fontSize:"0.65vw",fontFamily:"'Courier New',monospace",cursor:"pointer",textTransform:"uppercase"}}>{refreshing?"…":"Refresh"}</button>
          <HomeBtn onClick={onHome}/>
        </div>
      </div>
      {/* Scrollable content */}
      <div style={{flex:1,minHeight:0,overflowY:"auto",padding:"1.4vw"}}>
        {/* Score */}
        <div style={{display:"flex",alignItems:"center",marginBottom:"1.4vw"}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:"0.65vw",letterSpacing:"0.15em",color:"rgba(255,255,255,0.62)",textTransform:"uppercase",fontFamily:"'Courier New',monospace",marginBottom:"0.3vw"}}>Away</div>
            <div style={{display:"flex",alignItems:"center",gap:"0.8vw",marginBottom:"0.5vw"}}>
              <TeamLogo src={`https://www.mlbstatic.com/team-logos/${game.awayTeamId}.svg`} size="2.5vw" fallbackText={awayAbbr}/>
              <div style={{fontSize:"1.35vw",fontWeight:800,color:giantsIsAway?O:"rgba(255,255,255,0.85)"}}>{game.awayTeamName}</div>
            </div>
            <div style={{fontSize:"7vw",fontWeight:900,lineHeight:1,color:giantsIsAway?O:"rgba(255,255,255,0.9)",letterSpacing:"-0.03em",fontVariantNumeric:"tabular-nums",textShadow:(giantsIsAway&&giantsWinning)?`0 0 4vw rgba(253,90,30,0.5)`:"none"}}>{awayScore}</div>
          </div>
          {/* Situation panel */}
          <div style={{width:"18vw",flexShrink:0,display:"flex",flexDirection:"column",alignItems:"center",gap:"0.7vw",padding:"0 1.4vw"}}>
            <div style={{display:"flex",alignItems:"center",gap:"0.4vw"}}>
              <span style={{fontSize:"1.05vw",color:"rgba(255,255,255,0.62)",fontFamily:"'Courier New',monospace"}}>{game.inningHalf==="top"?"▲":"▼"}</span>
              <span style={{fontSize:"1.05vw",fontWeight:700,color:"rgba(255,255,255,0.65)",fontFamily:"'Courier New',monospace"}}>{game.inning===1?"1st":game.inning===2?"2nd":game.inning===3?"3rd":`${game.inning}th`} Inning</span>
            </div>
            {game.atBat&&(
              <div style={{width:"100%",boxSizing:"border-box",background:"rgba(253,90,30,0.08)",border:"1px solid rgba(253,90,30,0.25)",borderRadius:3,padding:"0.8vw 1.2vw",textAlign:"center"}}>
                <div style={{fontSize:"0.65vw",letterSpacing:"0.18em",color:"rgba(255,255,255,0.55)",textTransform:"uppercase",fontFamily:"'Courier New',monospace",marginBottom:"0.3vw"}}>At Bat</div>
                <div style={{fontSize:"1.2vw",fontWeight:800,color:"#fff"}}>{game.atBat.name}</div>
                <div style={{display:"flex",justifyContent:"center",gap:"0.5vw",marginTop:"0.4vw"}}>
                  <span style={{fontSize:"0.65vw",color:O,fontFamily:"'Courier New',monospace",background:"rgba(253,90,30,0.15)",padding:"2px 7px",borderRadius:2}}>{game.atBat.position}</span>
                  <span style={{fontSize:"0.65vw",color:"rgba(255,255,255,0.58)",fontFamily:"'Courier New',monospace"}}>{game.atBat.h}-for-{game.atBat.ab}</span>
                </div>
              </div>
            )}
            {game.count!=null&&(
              <div style={{width:"100%",boxSizing:"border-box",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:3,padding:"0.8vw 0.6vw",display:"flex",alignItems:"flex-start",justifyContent:"space-around"}}>
                <DotGroup count={game.count.balls} total={4} activeColor="#4caf50" label="Balls"/>
                <div style={{width:1,background:"rgba(255,255,255,0.1)",alignSelf:"stretch"}}/>
                <DotGroup count={game.count.strikes} total={3} activeColor="#e05252" label="Strikes"/>
                <div style={{width:1,background:"rgba(255,255,255,0.1)",alignSelf:"stretch"}}/>
                <DotGroup count={game.outs} total={3} activeColor="#e8b84b" label="Outs"/>
              </div>
            )}
            {game.onBase&&<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"0.3vw"}}><div style={{fontSize:"0.65vw",letterSpacing:"0.16em",color:"rgba(255,255,255,0.55)",textTransform:"uppercase",fontFamily:"'Courier New',monospace"}}>Runners</div><Diamond onBase={game.onBase}/></div>}
          </div>
          <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",alignItems:"flex-end"}}>
            <div style={{fontSize:"0.65vw",letterSpacing:"0.15em",color:"rgba(255,255,255,0.62)",textTransform:"uppercase",fontFamily:"'Courier New',monospace",marginBottom:"0.3vw"}}>Home</div>
            <div style={{display:"flex",alignItems:"center",gap:"0.8vw",marginBottom:"0.5vw"}}>
              <div style={{fontSize:"1.35vw",fontWeight:800,color:giantsIsHome?O:"rgba(255,255,255,0.85)"}}>{game.homeTeamName}</div>
              <TeamLogo src={`https://www.mlbstatic.com/team-logos/${game.homeTeamId}.svg`} size="2.5vw" fallbackText={homeAbbr}/>
            </div>
            <div style={{fontSize:"7vw",fontWeight:900,lineHeight:1,letterSpacing:"-0.03em",fontVariantNumeric:"tabular-nums",color:giantsIsHome?O:"rgba(255,255,255,0.9)",textShadow:(giantsIsHome&&giantsWinning)?`0 0 4vw rgba(253,90,30,0.5)`:"none"}}>{homeScore}</div>
          </div>
        </div>
        <div style={{height:1,background:"rgba(255,255,255,0.07)",marginBottom:"1.4vw"}}/>
        {/* Linescore */}
        <div style={{marginBottom:"1.4vw"}}>
          <div style={{fontSize:"0.65vw",letterSpacing:"0.2em",color:"rgba(255,255,255,0.55)",textTransform:"uppercase",fontFamily:"'Courier New',monospace",marginBottom:"0.5vw"}}>Linescore</div>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>
              <th style={{textAlign:"left",padding:"0.3vw 1vw 0.5vw 0.3vw",color:"rgba(255,255,255,0.62)",fontWeight:400,fontSize:"0.65vw",fontFamily:"'Courier New',monospace"}}>TEAM</th>
              {Object.keys(game.scoring_by_period||{}).map(i=><th key={i} style={{textAlign:"center",padding:"0.3vw 0.5vw",color:"rgba(255,255,255,0.62)",fontWeight:400,fontSize:"0.65vw",fontFamily:"'Courier New',monospace",width:"2vw"}}>{i}</th>)}
              <th style={{textAlign:"center",padding:"0.3vw 0.8vw",color:"rgba(255,255,255,0.62)",fontWeight:400,fontSize:"0.65vw",fontFamily:"'Courier New',monospace",borderLeft:"1px solid rgba(255,255,255,0.1)"}}>R</th>
              <th style={{textAlign:"center",padding:"0.3vw 0.8vw",color:"rgba(255,255,255,0.62)",fontWeight:400,fontSize:"0.65vw",fontFamily:"'Courier New',monospace"}}>H</th>
              <th style={{textAlign:"center",padding:"0.3vw 0.8vw",color:"rgba(255,255,255,0.62)",fontWeight:400,fontSize:"0.65vw",fontFamily:"'Courier New',monospace"}}>E</th>
            </tr></thead>
            <tbody>
              {[awayAbbr,homeAbbr].map((abbr,ti)=>(
                <tr key={abbr} style={{borderTop:"1px solid rgba(255,255,255,0.07)"}}>
                  <td style={{padding:"0.5vw 1vw 0.5vw 0.3vw",fontWeight:700,fontSize:"0.95vw",fontFamily:"'Courier New',monospace",color:abbr===sfAbbr?O:"rgba(255,255,255,0.55)"}}>{abbr}</td>
                  {Object.entries(game.scoring_by_period||{}).map(([inn,vals])=>{const val=vals[abbr],isX=val==="X";return <td key={inn} style={{textAlign:"center",padding:"0.5vw 0.5vw",fontFamily:"'Courier New',monospace",fontSize:"0.8vw",color:isX?"rgba(255,255,255,0.2)":val>0?"#fff":"rgba(255,255,255,0.62)",fontWeight:val>0?700:400}}>{isX?"—":val??"·"}</td>;})}
                  <td style={{textAlign:"center",padding:"0.5vw 0.8vw",fontWeight:800,fontSize:"1.1vw",color:"#fff",fontFamily:"'Courier New',monospace",borderLeft:"1px solid rgba(255,255,255,0.1)"}}>{game.rhe?.[abbr]?.runs??""}</td>
                  <td style={{textAlign:"center",padding:"0.5vw 0.8vw",color:"rgba(255,255,255,0.7)",fontFamily:"'Courier New',monospace",fontSize:"0.8vw"}}>{game.rhe?.[abbr]?.hits??""}</td>
                  <td style={{textAlign:"center",padding:"0.5vw 0.8vw",color:(game.rhe?.[abbr]?.errors??0)>0?"#e74c3c":"rgba(255,255,255,0.62)",fontFamily:"'Courier New',monospace",fontSize:"0.8vw"}}>{game.rhe?.[abbr]?.errors??""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{height:1,background:"rgba(255,255,255,0.07)",marginBottom:"1.4vw"}}/>
        {/* Batting + Pitching */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 1.4vw"}}>
          <div>
            <div style={{fontSize:"0.65vw",letterSpacing:"0.2em",color:O,opacity:0.7,textTransform:"uppercase",fontFamily:"'Courier New',monospace",marginBottom:"0.5vw"}}>Giants Batting</div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:"0.8vw",fontFamily:"'Courier New',monospace"}}>
              <thead><tr>{["Player","AB","H","HR","RBI","R"].map(h=><th key={h} style={{textAlign:h==="Player"?"left":"center",padding:"0.2vw 0.3vw 0.4vw",color:"rgba(255,255,255,0.55)",fontWeight:400,fontSize:"0.65vw"}}>{h}</th>)}</tr></thead>
              <tbody>
                {(game.batters?.[sfAbbr]||[]).map((p,i)=>{const isUp=game.atBat?.name===p.name;return(
                  <tr key={i} style={{borderTop:"1px solid rgba(255,255,255,0.05)",background:isUp?"rgba(253,90,30,0.08)":"transparent"}}>
                    <td style={{padding:"0.4vw 0.4vw 0.4vw 0",color:"#fff"}}>
                      {isUp&&<span style={{display:"inline-block",width:"0.5vw",height:"0.5vw",borderRadius:"50%",background:O,marginRight:"0.4vw",verticalAlign:"middle",boxShadow:`0 0 5px ${O}`}}/>}
                      <span style={{color:"rgba(255,255,255,0.62)",marginRight:"0.4vw",fontSize:"0.65vw"}}>{p.position}</span>{p.name}
                    </td>
                    {[p.ab,p.h,p.hr,p.rbi,p.r].map((v,j)=><td key={j} style={{textAlign:"center",padding:"0.4vw 0.3vw",color:j===2||j===3?(v||0)>0?O:"rgba(255,255,255,0.2)":(v||0)>0?"#fff":"rgba(255,255,255,0.55)",fontWeight:(v||0)>0&&j>0?700:400}}>{j>0?(v||"—"):v}</td>)}
                  </tr>
                );})}
              </tbody>
            </table>
          </div>
          <div style={{borderLeft:"1px solid rgba(255,255,255,0.07)",paddingLeft:"1.4vw"}}>
            <div style={{fontSize:"0.65vw",letterSpacing:"0.2em",color:O,opacity:0.7,textTransform:"uppercase",fontFamily:"'Courier New',monospace",marginBottom:"0.5vw"}}>Pitching</div>
            {[{label:sfTeamName,key:sfAbbr},{label:oppTeamName,key:oppAbbr}].map(({label,key})=>(
              <div key={key} style={{marginBottom:key===sfAbbr?"1vw":0}}>
                <div style={{fontSize:"0.65vw",color:"rgba(255,255,255,0.58)",textTransform:"uppercase",fontFamily:"'Courier New',monospace",marginBottom:"0.3vw",letterSpacing:"0.1em"}}>{label}</div>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:"0.8vw",fontFamily:"'Courier New',monospace"}}>
                  <thead><tr>{["Pitcher","IP","K","BB","ER"].map(h=><th key={h} style={{textAlign:h==="Pitcher"?"left":"center",padding:"0.2vw 0.3vw 0.3vw",color:"rgba(255,255,255,0.55)",fontWeight:400,fontSize:"0.65vw"}}>{h}</th>)}</tr></thead>
                  <tbody>
                    {(game.pitchers?.[key]||[]).map((p,i)=>(
                      <tr key={i} style={{borderTop:"1px solid rgba(255,255,255,0.05)"}}>
                        <td style={{padding:"0.35vw 0.4vw 0.35vw 0",color:"#fff"}}>
                          {p.status==="active"&&<span style={{display:"inline-block",width:"0.5vw",height:"0.5vw",borderRadius:"50%",background:"#2ecc71",marginRight:"0.4vw",verticalAlign:"middle",boxShadow:"0 0 4px #2ecc71"}}/>}
                          {p.name}
                        </td>
                        {[p.ip,p.k,p.bb,p.er].map((v,j)=><td key={j} style={{textAlign:"center",padding:"0.35vw 0.3vw",color:j===3&&v>0?"#e74c3c":"rgba(255,255,255,0.7)"}}>{v??0}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      </div>
      <style>{`@keyframes livePulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.8)}}`}</style>
    </div>
  );
}

// ── Basketball live dashboard (Valkyries / Warriors) ──────────────────────────
function BasketballScoreboard({teamKey,onHome}) {
  const [gdata,setGdata]=useState(null);
  const [loaded,setLoaded]=useState(false);
  const [refreshing,setRefreshing]=useState(true);
  const [lastUpdate,setLastUpdate]=useState(null);
  const isPhone=useIsPhone();
  const team=TEAMS[teamKey];
  const O=team.primary;

  const refresh=useCallback(async()=>{
    setRefreshing(true);
    try { const r=await fetchBasketballGame(teamKey); setGdata(r); setLastUpdate(new Date()); }
    catch(e){ console.error(e); }
    finally { setRefreshing(false); setLoaded(true); }
  },[teamKey]);

  useEffect(()=>{ refresh(); const t=setInterval(refresh,30000); return()=>clearInterval(t); },[refresh]);

  const game=gdata?.game;
  const isLive=game?.status==="inprogress";

  if(!loaded) return <div style={{height:"100vh",background:"#16121c",display:"flex",alignItems:"center",justifyContent:"center",color:O,fontSize:isPhone?"4vw":"1.2vw",fontFamily:"'Courier New',monospace",letterSpacing:"0.2em"}}>LOADING…</div>;

  // No live/recent game -> fall back to standings (in-season Valks) or off-season slide
  if(!game||game.status==="scheduled"){
    if(teamKey==="valkyries") return <ValkyriasStandingsSlide onHome={onHome}/>;
    return <OffSeasonSlide teamKey={teamKey} onHome={onHome}/>;
  }

  const myIsHome=game.myIsHome;
  const myScore=myIsHome?game.homeScore:game.awayScore;
  const oppScore=myIsHome?game.awayScore:game.homeScore;
  const myWinning=myScore>oppScore;
  const mySide=myIsHome?"home":"away";
  const oppSide=myIsHome?"away":"home";
  const periodLabel=game.statusDetail || (game.period?`Q${game.period} ${game.clock||""}`.trim():"Live");
  const nPeriods=Math.max(game.homePeriods?.length||0, game.awayPeriods?.length||0, 4);

  // Shared sub-renderers ------------------------------------------------------
  const ScoreSide=({side,label,big,mono})=>{
    const isMine=(side==="home")===myIsHome;
    const name=side==="home"?game.homeName:game.awayName;
    const logo=side==="home"?game.homeLogo:game.awayLogo;
    const id=side==="home"?game.homeId:game.awayId;
    const score=side==="home"?game.homeScore:game.awayScore;
    const won=score>(side==="home"?game.awayScore:game.homeScore);
    return (
      <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",alignItems:big?"center":(side==="away"?"flex-start":"flex-end")}}>
        <div style={{fontSize:mono.label,letterSpacing:"0.15em",color:"rgba(255,255,255,0.62)",textTransform:"uppercase",fontFamily:"'Courier New',monospace",marginBottom:"0.4em"}}>{label}</div>
        <div style={{display:"flex",alignItems:"center",gap:mono.gap,marginBottom:"0.4em",flexDirection:big?"column":(side==="away"?"row":"row-reverse")}}>
          <TeamLogo src={logo||(id?`https://a.espncdn.com/i/teamlogos/${game.sport}/500/${(side==="home"?game.home:game.away).toLowerCase()}.png`:"")} size={mono.logo} fallbackText={(side==="home"?game.home:game.away)}/>
          <div style={{fontSize:mono.name,fontWeight:800,color:isMine?O:"rgba(255,255,255,0.88)",textAlign:big?"center":"inherit"}}>{name}</div>
        </div>
        <div style={{fontSize:mono.score,fontWeight:900,lineHeight:1,letterSpacing:"-0.03em",fontVariantNumeric:"tabular-nums",color:isMine?O:"rgba(255,255,255,0.92)",textShadow:(isMine&&won)?`0 0 ${big?"8vw":"4vw"} ${O}88`:"none"}}>{score}</div>
      </div>
    );
  };

  const Linescore=({mono})=>(
    <div>
      <div style={{fontSize:mono.kicker,letterSpacing:"0.2em",color:"rgba(255,255,255,0.55)",textTransform:"uppercase",fontFamily:"'Courier New',monospace",marginBottom:"0.6em"}}>By Quarter</div>
      <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
        <table style={{borderCollapse:"collapse",fontFamily:"'Courier New',monospace",minWidth:"100%"}}>
          <thead><tr>
            <th style={{textAlign:"left",padding:`0 ${mono.cellX} ${mono.cellY} 0`,color:"rgba(255,255,255,0.55)",fontWeight:400,fontSize:mono.kicker}}>TEAM</th>
            {Array.from({length:nPeriods}).map((_,i)=><th key={i} style={{textAlign:"center",padding:`0 ${mono.cellX} ${mono.cellY}`,color:"rgba(255,255,255,0.55)",fontWeight:400,fontSize:mono.kicker}}>{i<4?i+1:`OT${i-3}`}</th>)}
            <th style={{textAlign:"center",padding:`0 ${mono.cellX} ${mono.cellY}`,color:"rgba(255,255,255,0.55)",fontWeight:400,fontSize:mono.kicker,borderLeft:"1px solid rgba(255,255,255,0.12)"}}>T</th>
          </tr></thead>
          <tbody>
            {[{abbr:game.away,per:game.awayPeriods,tot:game.awayScore,mine:!myIsHome},{abbr:game.home,per:game.homePeriods,tot:game.homeScore,mine:myIsHome}].map((row)=>(
              <tr key={row.abbr} style={{borderTop:"1px solid rgba(255,255,255,0.08)"}}>
                <td style={{padding:`${mono.cellY} ${mono.cellX} ${mono.cellY} 0`,fontWeight:700,fontSize:mono.rowAbbr,color:row.mine?O:"rgba(255,255,255,0.7)"}}>{row.abbr}</td>
                {Array.from({length:nPeriods}).map((_,i)=><td key={i} style={{textAlign:"center",padding:`${mono.cellY} ${mono.cellX}`,fontSize:mono.cell,color:(row.per?.[i]??null)!==null?"#fff":"rgba(255,255,255,0.35)"}}>{row.per?.[i]??"·"}</td>)}
                <td style={{textAlign:"center",padding:`${mono.cellY} ${mono.cellX}`,fontWeight:800,fontSize:mono.rowTot,color:"#fff",borderLeft:"1px solid rgba(255,255,255,0.12)"}}>{row.tot}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const BoxScore=({side,label,accent,mono})=>{
    const players=game.players?.[side]||[];
    if(!players.length) return null;
    return (
      <div>
        <div style={{fontSize:mono.kicker,letterSpacing:"0.18em",color:accent?O:"rgba(255,255,255,0.55)",opacity:accent?0.9:1,textTransform:"uppercase",fontFamily:"'Courier New',monospace",marginBottom:"0.6em"}}>{label}</div>
        <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'Courier New',monospace"}}>
          <thead><tr>{["Player","MIN","PTS","REB","AST","FG","3PT"].map(h=><th key={h} style={{textAlign:h==="Player"?"left":"center",padding:`0 ${mono.statX} ${mono.cellY}`,color:"rgba(255,255,255,0.5)",fontWeight:400,fontSize:mono.kicker}}>{h}</th>)}</tr></thead>
          <tbody>
            {players.map((p,i)=>(
              <tr key={i} style={{borderTop:"1px solid rgba(255,255,255,0.06)"}}>
                <td style={{padding:`${mono.cellY} ${mono.statX} ${mono.cellY} 0`,color:"#fff",fontSize:mono.cell,whiteSpace:"nowrap"}}>
                  {p.starter&&<span style={{display:"inline-block",width:mono.dot,height:mono.dot,borderRadius:"50%",background:accent?O:"rgba(255,255,255,0.4)",marginRight:"0.5em",verticalAlign:"middle"}}/>}
                  {p.name}
                </td>
                <td style={{textAlign:"center",padding:`${mono.cellY} ${mono.statX}`,fontSize:mono.cell,color:"rgba(255,255,255,0.55)"}}>{p.min||"—"}</td>
                <td style={{textAlign:"center",padding:`${mono.cellY} ${mono.statX}`,fontSize:mono.cell,fontWeight:p.pts>0?700:400,color:p.pts>0?"#fff":"rgba(255,255,255,0.4)"}}>{p.pts}</td>
                <td style={{textAlign:"center",padding:`${mono.cellY} ${mono.statX}`,fontSize:mono.cell,color:p.reb>0?"#fff":"rgba(255,255,255,0.4)"}}>{p.reb}</td>
                <td style={{textAlign:"center",padding:`${mono.cellY} ${mono.statX}`,fontSize:mono.cell,color:p.ast>0?"#fff":"rgba(255,255,255,0.4)"}}>{p.ast}</td>
                <td style={{textAlign:"center",padding:`${mono.cellY} ${mono.statX}`,fontSize:mono.cell,color:"rgba(255,255,255,0.6)"}}>{p.fg||"—"}</td>
                <td style={{textAlign:"center",padding:`${mono.cellY} ${mono.statX}`,fontSize:mono.cell,color:"rgba(255,255,255,0.6)"}}>{p.tp||"—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const bg=`radial-gradient(ellipse at 20% 0%, ${O}33 0%, #16121c 55%)`;
  const liveDot=<div style={{width:isPhone?"2.4vw":"0.7vw",height:isPhone?"2.4vw":"0.7vw",borderRadius:"50%",background:isLive?"#2ecc71":"rgba(255,255,255,0.4)",boxShadow:isLive?"0 0 10px #2ecc71":"none",animation:isLive?"livePulse 1.8s ease-in-out infinite":"none"}}/>;

  // ── PHONE ──────────────────────────────────────────────────────────────────
  if(isPhone){
    const m={label:"3vw",gap:"1.5vw",logo:"11vw",name:"3.6vw",score:"16vw",kicker:"2.8vw",cellX:"1.5vw",cellY:"1.5vw",rowAbbr:"3.4vw",cell:"3vw",rowTot:"3.6vw",statX:"1vw",dot:"1.6vw"};
    return (
      <div style={{position:"fixed",inset:0,background:bg,fontFamily:"Georgia,serif",color:"#fff",display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{height:"1vw",background:`linear-gradient(90deg,${O},${team.secondary})`,flexShrink:0}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"3vw 4vw",borderBottom:"1px solid rgba(255,255,255,0.1)",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:"2vw"}}>{liveDot}<span style={{fontSize:"3vw",letterSpacing:"0.15em",color:isLive?"#2ecc71":"rgba(255,255,255,0.6)",fontFamily:"'Courier New',monospace",textTransform:"uppercase"}}>{isLive?"Live":"Final"} · {team.name}</span></div>
          <button onClick={onHome} style={{background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",color:"rgba(255,255,255,0.8)",padding:"1.6vw 3.5vw",borderRadius:4,fontSize:"3vw",fontFamily:"'Courier New',monospace",letterSpacing:"0.08em",cursor:"pointer",textTransform:"uppercase"}}>Home</button>
        </div>
        <div style={{flex:1,minHeight:0,overflowY:"auto",padding:"5vw 4vw",WebkitOverflowScrolling:"touch"}}>
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:"3vw"}}>
            <ScoreSide side="away" label="Away" big mono={m}/>
            <div style={{flexShrink:0,padding:"6vw 1vw 0",display:"flex",flexDirection:"column",alignItems:"center",gap:"1vw"}}>
              <span style={{fontSize:"4vw",color:"rgba(255,255,255,0.35)",fontWeight:900}}>–</span>
            </div>
            <ScoreSide side="home" label="Home" big mono={m}/>
          </div>
          <div style={{textAlign:"center",fontSize:"3vw",color:isLive?"#2ecc71":"rgba(255,255,255,0.6)",fontFamily:"'Courier New',monospace",marginBottom:"5vw"}}>{periodLabel}</div>
          <div style={{marginBottom:"5vw"}}><Linescore mono={m}/></div>
          <div style={{marginBottom:"5vw"}}><BoxScore side={mySide} label={`${team.name} Box Score`} accent mono={m}/></div>
          <div><BoxScore side={oppSide} label={`${myIsHome?game.awayName:game.homeName} Box Score`} mono={m}/></div>
        </div>
        <style>{`@keyframes livePulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.8)}}`}</style>
      </div>
    );
  }

  // ── DESKTOP ────────────────────────────────────────────────────────────────
  const m={label:"0.65vw",gap:"0.8vw",logo:"2.5vw",name:"1.35vw",score:"7vw",kicker:"0.65vw",cellX:"0.8vw",cellY:"0.5vw",rowAbbr:"0.95vw",cell:"0.85vw",rowTot:"1.1vw",statX:"0.5vw",dot:"0.5vw"};
  return (
    <div style={{position:"fixed",inset:0,background:bg,fontFamily:"Georgia,serif",color:"#fff",display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{height:"0.4vw",background:`linear-gradient(90deg,${O},${team.secondary})`,flexShrink:0}}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0.7vw 1.4vw",borderBottom:"1px solid rgba(255,255,255,0.07)",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:"0.7vw"}}>{liveDot}<span style={{fontSize:"0.8vw",letterSpacing:"0.2em",color:isLive?"#2ecc71":"rgba(255,255,255,0.6)",fontFamily:"'Courier New',monospace",textTransform:"uppercase"}}>{isLive?"Live":"Final"} · {team.fullName}</span></div>
        <div style={{display:"flex",alignItems:"center",gap:"1vw"}}>
          <span style={{fontSize:"0.8vw",color:"rgba(255,255,255,0.5)",fontFamily:"'Courier New',monospace"}}>{refreshing?"Refreshing…":lastUpdate?`Updated ${lastUpdate.toLocaleTimeString()}`:""}</span>
          <button onClick={refresh} disabled={refreshing} style={{background:"transparent",border:`1px solid ${O}59`,color:O,padding:"0.3vw 1vw",borderRadius:2,fontSize:"0.65vw",fontFamily:"'Courier New',monospace",cursor:"pointer",textTransform:"uppercase"}}>{refreshing?"…":"Refresh"}</button>
          <HomeBtn onClick={onHome}/>
        </div>
      </div>
      <div style={{flex:1,minHeight:0,overflowY:"auto",padding:"1.4vw"}}>
        <div style={{display:"flex",alignItems:"center",marginBottom:"1.4vw"}}>
          <ScoreSide side="away" label="Away" mono={m}/>
          <div style={{width:"16vw",flexShrink:0,display:"flex",flexDirection:"column",alignItems:"center",gap:"0.6vw",padding:"0 1.4vw"}}>
            <div style={{fontSize:"1.05vw",fontWeight:700,color:isLive?"#2ecc71":"rgba(255,255,255,0.65)",fontFamily:"'Courier New',monospace",textAlign:"center"}}>{periodLabel}</div>
            <div style={{fontSize:"0.65vw",letterSpacing:"0.15em",color:"rgba(255,255,255,0.45)",fontFamily:"'Courier New',monospace",textTransform:"uppercase"}}>{team.league}</div>
          </div>
          <ScoreSide side="home" label="Home" mono={m}/>
        </div>
        <div style={{height:1,background:"rgba(255,255,255,0.07)",marginBottom:"1.4vw"}}/>
        <div style={{marginBottom:"1.4vw"}}><Linescore mono={m}/></div>
        <div style={{height:1,background:"rgba(255,255,255,0.07)",marginBottom:"1.4vw"}}/>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 1.4vw"}}>
          <BoxScore side={mySide} label={`${team.name} Box Score`} accent mono={m}/>
          <div style={{borderLeft:"1px solid rgba(255,255,255,0.07)",paddingLeft:"1.4vw"}}>
            <BoxScore side={oppSide} label={`${myIsHome?game.awayName:game.homeName} Box Score`} mono={m}/>
          </div>
        </div>
      </div>
      <style>{`@keyframes livePulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.8)}}`}</style>
    </div>
  );
}

// ── App root ──────────────────────────────────────────────────────────────────
function App() {
  const [screen,setScreen]=useState("home");
  const [liveGames,setLiveGames]=useState([]);
  const [checking,setChecking]=useState(true);

  const checkLiveGames=useCallback(async()=>{
    if(!isDeployed()){
      setLiveGames([
        {teamKey:"giants",   opponent:"at Milwaukee Brewers",bayScore:1,oppScore:3,situation:"▼ 5th · Live"},
        {teamKey:"valkyries",opponent:"vs Portland Fire",    bayScore:0,oppScore:0,situation:"7:00 PM · Starting Soon"},
      ]);
      setChecking(false); return;
    }
    try {
      const live = await checkAllLiveGames();
      setLiveGames(live);
    } catch(e){ setLiveGames([]); }
    finally { setChecking(false); }
  },[]);

  useEffect(()=>{
    checkLiveGames();
    const t=setInterval(checkLiveGames,60000);
    return()=>clearInterval(t);
  },[checkLiveGames]);

  return (
    <div style={{width:"100vw",height:"100vh",overflow:"hidden"}}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0}body{background:#111}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:rgba(255,255,255,0.05)}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.2);border-radius:2px}`}</style>
      {screen==="home"     &&<HomeScreen liveGames={liveGames} checking={checking} onSelectGame={k=>setScreen(k)} onStandings={()=>setScreen("standings")}/>}
      {screen==="standings"&&<StandingsCarousel onHome={()=>setScreen("home")}/>}
      {screen==="giants"   &&<GiantsScoreboard onHome={()=>setScreen("home")}/>}
      {screen==="valkyries"&&<BasketballScoreboard teamKey="valkyries" onHome={()=>setScreen("home")}/>}
      {screen==="warriors" &&<BasketballScoreboard teamKey="warriors"  onHome={()=>setScreen("home")}/>}
      {screen==="niners"   &&<OffSeasonSlide teamKey="niners"    onHome={()=>setScreen("home")}/>}
      {screen==="sharks"   &&<OffSeasonSlide teamKey="sharks"    onHome={()=>setScreen("home")}/>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App/></React.StrictMode>
)
