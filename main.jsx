import React, { useState, useEffect, useCallback } from 'react'
import ReactDOM from 'react-dom/client'


const O = "#FD5A1E";
const B = "#27251F";
const SF_ID = 137;

const MLB = "/api/mlb";

const V = {
  xs:"0.65vw", sm:"0.75vw", md:"0.95vw", lg:"1.2vw",
  xl:"1.6vw", "2xl":"2.2vw", score:"7vw",
  p:"1.4vw", gap:"0.8vw",
  mono:"'Courier New', monospace",
  serif:"Georgia, 'Times New Roman', serif",
};

// In preview (Claude artifact), /api/mlb doesn't exist — detect and use seed data
function isDeployed() { return typeof window !== "undefined" && !window.location.hostname.includes("claude") && window.location.hostname !== "localhost"; }

async function mlb(path) {
  if (!isDeployed()) throw new Error("PREVIEW_MODE");
  const res = await fetch(`/api/mlb?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(`MLB API ${res.status}: ${path}`);
  return res.json();
}

async function fetchAll() {
  const today = new Date().toISOString().slice(0,10);

  // Standings
  const stData = await mlb("/standings?leagueId=104&standingsTypes=regularSeason");
  const nlWest = stData.records?.find(r => r.division?.id === 203);
  const standings = (nlWest?.teamRecords || []).map((t, i) => ({
    rank: i + 1,
    abbr: t.team.abbreviation,
    name: t.team.name,
    w: t.wins,
    l: t.losses,
  }));

  // Today's game — use gamePk from schedule, then fetch linescore + boxscore separately
  const schData = await mlb(`/schedule?sportId=1&teamId=${SF_ID}&date=${today}`);
  const todayGames = schData.dates?.[0]?.games || [];
  const todayGame  = todayGames[0] || null;

  // Next scheduled game (look ahead 14 days)
  const future = new Date(); future.setDate(future.getDate() + 14);
  const fStr = future.toISOString().slice(0,10);
  const nextData = await mlb(`/schedule?sportId=1&teamId=${SF_ID}&startDate=${today}&endDate=${fStr}`);
  let nextGame = null;
  outer: for (const d of (nextData.dates || [])) {
    for (const g of (d.games || [])) {
      if (g.status?.abstractGameState !== "Final") {
        const isHome = g.teams.home.team.id === SF_ID;
        const opp = isHome ? g.teams.away.team.name : g.teams.home.team.name;
        const loc = isHome ? "Oracle Park" : g.teams.home.team.name;
        const dt  = new Date(g.gameDate);
        nextGame = {
          opponent: opp,
          location: loc,
          date: dt.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",timeZone:"America/Los_Angeles"}),
          time: dt.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZoneName:"short",timeZone:"America/Los_Angeles"}),
        };
        break outer;
      }
    }
  }

  if (!todayGame) return { game: null, standings, nextGame };

  const status = todayGame.status?.abstractGameState;
  const pk = todayGame.gamePk;
  // MLB API uses different paths depending on endpoint/game state
  const homeTeam = todayGame.teams.home.team || todayGame.teams.home;
  const awayTeam = todayGame.teams.away.team || todayGame.teams.away;
  const homeAbbr = homeTeam.abbreviation || homeTeam.teamCode?.toUpperCase() || "SF";
  const awayAbbr = awayTeam.abbreviation || awayTeam.teamCode?.toUpperCase() || "AZ";
  const homeTeamName = homeTeam.name || homeTeam.teamName || "San Francisco Giants";
  const awayTeamName = awayTeam.name || awayTeam.teamName || "Arizona Diamondbacks";

  const baseGame = {
    hasGame: true,
    status: status === "Live" ? "inprogress" : status === "Final" ? "complete" : "scheduled",
    home: homeAbbr, away: awayAbbr,
    homeTeamName, awayTeamName,
    score: { [homeAbbr]: 0, [awayAbbr]: 0 },
  };

  if (status === "Live" || status === "Final") {
    const [ls, bs] = await Promise.all([
      mlb(`/game/${pk}/linescore`),
      mlb(`/game/${pk}/boxscore`),
    ]);

    // linescore uses "home"/"away" keys, not abbreviations — map correctly

    baseGame.score[homeAbbr] = ls.teams?.home?.runs ?? 0;
    baseGame.score[awayAbbr] = ls.teams?.away?.runs ?? 0;

    const scoring_by_period = {};
    (ls.innings || []).forEach(inn => {
      // inn.home may be missing if bottom half not yet played
      scoring_by_period[inn.num] = {
        [homeAbbr]: inn.home?.runs !== undefined ? inn.home.runs : "X",
        [awayAbbr]: inn.away?.runs !== undefined ? inn.away.runs : "·",
      };
    });

    const rhe = {
      [homeAbbr]: { runs: ls.teams?.home?.runs ?? 0, hits: ls.teams?.home?.hits ?? 0, errors: ls.teams?.home?.errors ?? 0 },
      [awayAbbr]: { runs: ls.teams?.away?.runs ?? 0, hits: ls.teams?.away?.hits ?? 0, errors: ls.teams?.away?.errors ?? 0 },
    };

    const batters  = { [homeAbbr]: [], [awayAbbr]: [] };
    const pitchers = { [homeAbbr]: [], [awayAbbr]: [] };

    for (const [side, abbr] of [["home", homeAbbr], ["away", awayAbbr]]) {
      const t = bs.teams?.[side];
      if (!t) continue;
      // Use battingOrder for lineup order, fall back to batters array
      const orderIds = t.battingOrder?.length ? t.battingOrder : (t.batters || []);
      orderIds.forEach(pid => {
        const p = t.players?.[`ID${pid}`];
        if (!p) return;
        const s = p.stats?.batting || {};
        if ((s.atBats ?? 0) === 0 && !t.battingOrder?.length) return;
        batters[abbr].push({ name:p.person.fullName, position:p.position?.abbreviation||"", ab:s.atBats??0, h:s.hits??0, hr:s.homeRuns??0, rbi:s.rbi??0, r:s.runs??0 });
      });
      (t.pitchers || []).forEach(pid => {
        const p = t.players?.[`ID${pid}`];
        if (!p) return;
        const s = p.stats?.pitching || {};
        if (!s.inningsPitched) return;
        pitchers[abbr].push({ name:p.person.fullName, ip:s.inningsPitched??"0.0", k:s.strikeOuts??0, bb:s.baseOnBalls??0, er:s.earnedRuns??0, status:t.activePitcher?.id===pid?"active":"done" });
      });
    }

    let atBat=null, count=null, onBase=null, inning=null, inningHalf=null, outs=null;
    if (status === "Live") {
      inning     = ls.currentInning;
      inningHalf = ls.isTopInning ? "top" : "bottom";
      outs       = ls.outs ?? 0;
      count      = { balls: ls.balls ?? 0, strikes: ls.strikes ?? 0 };
      onBase     = { first:!!ls.offense?.first, second:!!ls.offense?.second, third:!!ls.offense?.third };
      const bid  = ls.offense?.batter?.id;
      if (bid) {
        const side = ls.isTopInning ? "away" : "home";
        const bp   = bs.teams?.[side]?.players?.[`ID${bid}`];
        if (bp) {
          const s = bp.stats?.batting || {};
          atBat = { name:bp.person.fullName, position:bp.position?.abbreviation||"", ab:s.atBats??0, h:s.hits??0 };
        }
      }
    }
    return { game: { ...baseGame, scoring_by_period, rhe, batters, pitchers, atBat, count, onBase, inning, inningHalf, outs }, standings, nextGame };
  }

  return { game: baseGame, standings, nextGame };
}

// ── Diamond ───────────────────────────────────────────────────────────────────
function Diamond({ onBase }) {
  const s=56,cx=28,cy=28,r=15;
  const bases=[{id:"second",x:cx,y:cy-r,active:onBase?.second},{id:"third",x:cx-r,y:cy,active:onBase?.third},{id:"first",x:cx+r,y:cy,active:onBase?.first}];
  return (
    <svg width="4.5vw" height="4.5vw" viewBox={`0 0 ${s} ${s}`}>
      <polygon points={`${cx},${cy-r} ${cx+r},${cy} ${cx},${cy+r} ${cx-r},${cy}`} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5"/>
      {bases.map(b=><rect key={b.id} x={b.x-5} y={b.y-5} width={10} height={10} transform={`rotate(45,${b.x},${b.y})`} fill={b.active?O:"rgba(255,255,255,0.1)"} style={{filter:b.active?`drop-shadow(0 0 5px ${O})`:"none",transition:"fill 0.4s"}}/>)}
      <polygon points={`${cx},${cy+r+4} ${cx-4},${cy+r} ${cx-4},${cy+r-4} ${cx+4},${cy+r-4} ${cx+4},${cy+r}`} fill="rgba(255,255,255,0.12)"/>
    </svg>
  );
}

function DotGroup({ count, total, activeColor, label }) {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"0.4vw"}}>
      <div style={{fontSize:V.xs,letterSpacing:"0.16em",color:"rgba(255,255,255,0.3)",textTransform:"uppercase",fontFamily:V.mono}}>{label}</div>
      <div style={{display:"flex",gap:"0.4vw"}}>
        {Array.from({length:total}).map((_,i)=>(
          <div key={i} style={{width:"0.9vw",height:"0.9vw",borderRadius:"50%",background:i<count?activeColor:"rgba(255,255,255,0.1)",border:`1.5px solid ${i<count?activeColor:"rgba(255,255,255,0.2)"}`,boxShadow:i<count?`0 0 7px ${activeColor}88`:"none",transition:"all 0.25s"}}/>
        ))}
      </div>
    </div>
  );
}

function SituationPanel({ game }) {
  const { inning, inningHalf, outs, count, atBat, onBase } = game;
  const ordinal = !inning?"":inning===1?"1st":inning===2?"2nd":inning===3?"3rd":`${inning}th`;
  return (
    <div style={{width:"18vw",flexShrink:0,display:"flex",flexDirection:"column",alignItems:"center",gap:"0.7vw",padding:`0 ${V.p}`}}>
      <div style={{display:"flex",alignItems:"center",gap:"0.4vw"}}>
        <span style={{fontSize:V.md,color:"rgba(255,255,255,0.4)",fontFamily:V.mono}}>{inningHalf==="top"?"▲":"▼"}</span>
        <span style={{fontSize:V.md,fontWeight:700,color:"rgba(255,255,255,0.65)",fontFamily:V.mono,letterSpacing:"0.06em"}}>{ordinal} Inning</span>
      </div>
      {atBat&&(
        <div style={{width:"100%",boxSizing:"border-box",background:"rgba(253,90,30,0.08)",border:"1px solid rgba(253,90,30,0.25)",borderRadius:3,padding:`${V.gap} ${V.p}`,textAlign:"center"}}>
          <div style={{fontSize:V.xs,letterSpacing:"0.18em",color:"rgba(255,255,255,0.3)",textTransform:"uppercase",fontFamily:V.mono,marginBottom:"0.3vw"}}>At Bat</div>
          <div style={{fontSize:V.lg,fontWeight:800,color:"#fff",lineHeight:1.2}}>{atBat.name}</div>
          <div style={{display:"flex",justifyContent:"center",gap:"0.5vw",marginTop:"0.4vw"}}>
            <span style={{fontSize:V.xs,color:O,fontFamily:V.mono,background:"rgba(253,90,30,0.15)",padding:"2px 7px",borderRadius:2}}>{atBat.position}</span>
            <span style={{fontSize:V.xs,color:"rgba(255,255,255,0.35)",fontFamily:V.mono}}>{atBat.h}-for-{atBat.ab}</span>
          </div>
        </div>
      )}
      {count!=null&&(
        <div style={{width:"100%",boxSizing:"border-box",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:3,padding:`${V.gap} 0.6vw`,display:"flex",alignItems:"flex-start",justifyContent:"space-around"}}>
          <DotGroup count={count.balls}   total={4} activeColor="#4caf50" label="Balls"/>
          <div style={{width:1,background:"rgba(255,255,255,0.1)",alignSelf:"stretch"}}/>
          <DotGroup count={count.strikes} total={3} activeColor="#e05252" label="Strikes"/>
          <div style={{width:1,background:"rgba(255,255,255,0.1)",alignSelf:"stretch"}}/>
          <DotGroup count={outs}          total={3} activeColor="#e8b84b" label="Outs"/>
        </div>
      )}
      {onBase&&(
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"0.3vw"}}>
          <div style={{fontSize:V.xs,letterSpacing:"0.16em",color:"rgba(255,255,255,0.3)",textTransform:"uppercase",fontFamily:V.mono}}>Runners</div>
          <Diamond onBase={onBase}/>
        </div>
      )}
    </div>
  );
}

function Linescore({ scoring, rhe, homeAbbr, awayAbbr }) {
  const innings=Object.keys(scoring).map(Number).sort((a,b)=>a-b);
  const cell={textAlign:"center",padding:`0.5vw 0.6vw`,fontFamily:V.mono,fontSize:V.sm};
  return (
    <table style={{width:"100%",borderCollapse:"collapse"}}>
      <thead>
        <tr>
          <th style={{textAlign:"left",padding:`0.3vw 1vw 0.5vw 0.3vw`,color:"rgba(255,255,255,0.4)",fontWeight:400,fontSize:V.xs}}>TEAM</th>
          {innings.map(i=><th key={i} style={{...cell,color:"rgba(255,255,255,0.4)",fontWeight:400,fontSize:V.xs,width:"2.2vw"}}>{i}</th>)}
          <th style={{...cell,color:"rgba(255,255,255,0.4)",fontWeight:400,fontSize:V.xs,borderLeft:"1px solid rgba(255,255,255,0.1)"}}>R</th>
          <th style={{...cell,color:"rgba(255,255,255,0.4)",fontWeight:400,fontSize:V.xs}}>H</th>
          <th style={{...cell,color:"rgba(255,255,255,0.4)",fontWeight:400,fontSize:V.xs}}>E</th>
        </tr>
      </thead>
      <tbody>
        {[awayAbbr,homeAbbr].map((abbr,ti)=>(
          <tr key={abbr} style={{borderTop:"1px solid rgba(255,255,255,0.07)"}}>
            <td style={{padding:`0.5vw 1vw 0.5vw 0.3vw`,fontWeight:700,fontSize:V.md,color:ti===1?O:"rgba(255,255,255,0.55)"}}>{abbr}</td>
            {innings.map(i=>{const val=scoring[i]?.[abbr],isX=val==="X";return <td key={i} style={{...cell,color:isX?"rgba(255,255,255,0.2)":val>0?"#fff":"rgba(255,255,255,0.4)",fontWeight:val>0?700:400}}>{isX?"—":val??"·"}</td>;})}
            <td style={{...cell,fontWeight:800,fontSize:V.lg,color:"#fff",borderLeft:"1px solid rgba(255,255,255,0.1)"}}>{rhe?.[abbr]?.runs??""}</td>
            <td style={{...cell,color:"rgba(255,255,255,0.7)"}}>{rhe?.[abbr]?.hits??""}</td>
            <td style={{...cell,color:(rhe?.[abbr]?.errors??0)>0?"#e74c3c":"rgba(255,255,255,0.4)"}}>{rhe?.[abbr]?.errors??""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NextGameBanner({ nextGame }) {
  if (!nextGame) return null;
  return (
    <div style={{background:`linear-gradient(135deg,rgba(253,90,30,0.12),rgba(253,90,30,0.04))`,border:`1px solid rgba(253,90,30,0.3)`,borderRadius:4,padding:`2.2vw 2.8vw`,display:"flex",alignItems:"center",justifyContent:"space-between",gap:"2vw"}}>
      <div style={{flexShrink:0}}>
        <div style={{fontSize:V.xs,letterSpacing:"0.2em",color:"rgba(255,255,255,0.35)",textTransform:"uppercase",fontFamily:V.mono,marginBottom:"0.5vw"}}>Next Game</div>
        <div style={{fontSize:V.xs,color:"rgba(255,255,255,0.3)",fontFamily:V.mono}}>{nextGame.location}</div>
      </div>
      <div style={{flex:1,textAlign:"center"}}>
        <div style={{fontSize:V["2xl"],fontWeight:900,color:"#fff",lineHeight:1}}>
          <span style={{color:O}}>SF Giants</span>
          <span style={{color:"rgba(255,255,255,0.25)",margin:`0 1vw`,fontSize:V.xl}}>vs</span>
          <span>{nextGame.opponent}</span>
        </div>
      </div>
      <div style={{flexShrink:0,textAlign:"right"}}>
        <div style={{fontSize:V.xl,fontWeight:800,color:O,fontFamily:V.mono,marginBottom:"0.4vw"}}>{nextGame.time}</div>
        <div style={{fontSize:V.md,color:"rgba(255,255,255,0.5)",fontFamily:V.mono}}>{nextGame.date}</div>
      </div>
    </div>
  );
}

function NLWestStandings({ standings, nextGame }) {
  const leader=standings[0];
  const tc=a=>({LAD:"#005A9C",SD:"#2F241D",AZ:"#A71930",COL:"#33006F"}[a]||"rgba(255,255,255,0.3)");
  const rp=`1.4vw 0.8vw`;
  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",padding:`2vw ${V.p} ${V.p}`}}>
      <NextGameBanner nextGame={nextGame}/>
      <div style={{display:"flex",alignItems:"baseline",gap:"0.8vw",margin:`1.8vw 0 1vw`}}>
        <div style={{fontSize:V["2xl"],fontWeight:900,color:"#fff"}}>NL West</div>
        <div style={{fontSize:V.xs,letterSpacing:"0.2em",color:"rgba(255,255,255,0.35)",textTransform:"uppercase",fontFamily:V.mono}}>Standings</div>
      </div>
      <table style={{width:"100%",borderCollapse:"collapse",fontFamily:V.serif,flex:1}}>
        <thead>
          <tr style={{borderBottom:"1px solid rgba(255,255,255,0.1)"}}>
            {["#","Team","W","L","PCT","GB"].map((h,i)=>(
              <th key={h} style={{textAlign:i<2?"left":"center",padding:`0.4vw 0.8vw 0.8vw`,color:"rgba(255,255,255,0.3)",fontWeight:400,fontSize:V.xs,letterSpacing:"0.18em",fontFamily:V.mono,textTransform:"uppercase"}}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {standings.map((team,i)=>{
            const isG=team.abbr==="SF";
            const pct=(team.w/(team.w+team.l)).toFixed(3).replace(/^0/,"");
            const gb=i===0?"—":(((leader.w-team.w)+(team.l-leader.l))/2).toFixed(1);
            return (
              <tr key={team.abbr} style={{borderBottom:"1px solid rgba(255,255,255,0.06)",background:isG?"rgba(253,90,30,0.07)":"transparent"}}>
                <td style={{padding:rp,color:"rgba(255,255,255,0.25)",fontSize:V.sm,fontFamily:V.mono}}>{team.rank}</td>
                <td style={{padding:rp}}>
                  <div style={{display:"flex",alignItems:"center",gap:"0.8vw"}}>
                    <div style={{width:"0.25vw",height:"2.4vw",borderRadius:2,background:isG?O:tc(team.abbr),boxShadow:isG?`0 0 8px ${O}`:"none",flexShrink:0}}/>
                    <div>
                      <div style={{fontSize:V.lg,fontWeight:isG?800:600,color:isG?"#fff":"rgba(255,255,255,0.75)",display:"flex",alignItems:"center",gap:"0.6vw"}}>
                        {team.name}{isG&&<span style={{fontSize:V.xs,letterSpacing:"0.15em",color:O,fontFamily:V.mono}}>YOU ARE HERE</span>}
                      </div>
                      <div style={{fontSize:V.xs,color:"rgba(255,255,255,0.3)",fontFamily:V.mono,marginTop:"0.1vw"}}>{team.abbr}</div>
                    </div>
                  </div>
                </td>
                <td style={{textAlign:"center",padding:rp,fontSize:V.xl,fontWeight:700,color:isG?"#fff":"rgba(255,255,255,0.7)"}}>{team.w}</td>
                <td style={{textAlign:"center",padding:rp,fontSize:V.xl,color:"rgba(255,255,255,0.45)"}}>{team.l}</td>
                <td style={{textAlign:"center",padding:rp,fontFamily:V.mono,fontSize:V.md,color:isG?O:"rgba(255,255,255,0.55)",fontWeight:isG?700:400}}>{pct}</td>
                <td style={{textAlign:"center",padding:rp}}>
                  {gb==="—"?<span style={{color:"rgba(255,255,255,0.25)",fontFamily:V.mono,fontSize:V.md}}>—</span>
                    :<div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"0.5vw"}}>
                      <div style={{width:Math.min(parseFloat(gb)*5,60),height:"0.35vw",borderRadius:2,background:isG?O:"rgba(255,255,255,0.2)",minWidth:4}}/>
                      <span style={{fontFamily:V.mono,fontSize:V.sm,color:isG?O:"rgba(255,255,255,0.45)",minWidth:"1.8vw"}}>{gb}</span>
                    </div>
                  }
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function GiantsScoreboard() {
  const [data, setData]           = useState(null);
  const [error, setError]         = useState(null);
  const [refreshing, setRefreshing] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [pulse, setPulse]         = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true); setError(null);
    try {
      const result = await fetchAll();
      setData(result);
      setLastUpdate(new Date());
      setPulse(true); setTimeout(()=>setPulse(false),600);
    } catch(e) {
      if (e.message === "PREVIEW_MODE") {
        // Running in Claude artifact preview — show seed data
        setData({
          game: null,
          standings: [
            { rank:1, abbr:"LAD", name:"Los Angeles Dodgers",  w:33, l:20 },
            { rank:2, abbr:"SD",  name:"San Diego Padres",     w:31, l:21 },
            { rank:3, abbr:"AZ",  name:"Arizona Diamondbacks", w:28, l:24 },
            { rank:4, abbr:"SF",  name:"San Francisco Giants", w:22, l:31 },
            { rank:5, abbr:"COL", name:"Colorado Rockies",     w:20, l:34 },
          ],
          nextGame: { opponent:"Arizona Diamondbacks", date:"Mon May 25", time:"2:05 PM PDT", location:"Oracle Park" },
        });
        setError("Preview mode — deploy to Vercel for live data");
      } else {
        setError(e.message);
      }
    } finally { setRefreshing(false); }
  }, []);

  useEffect(()=>{ refresh(); const t=setInterval(refresh,30000); return ()=>clearInterval(t); },[refresh]);

  const game      = data?.game;
  const standings = data?.standings || [];
  const nextGame  = data?.nextGame  || null;
  const isLive    = game?.status === "inprogress";
  const showGame  = isLive;
  const homeAbbr  = game?.home || "SF";
  const awayAbbr  = game?.away || "AZ";
  const homeScore = game?.score?.[homeAbbr] ?? 0;
  const awayScore = game?.score?.[awayAbbr] ?? 0;
  const homeW     = homeScore > awayScore;

  return (
    <div style={{position:"fixed",inset:0,background:`radial-gradient(ellipse at 20% 0%,#3d1c09 0%,${B} 50%)`,fontFamily:V.serif,color:"#fff",display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{height:"0.4vw",background:`linear-gradient(90deg,${O},#c94510)`,flexShrink:0}}/>

      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:`0.8vw ${V.p}`,borderBottom:"1px solid rgba(255,255,255,0.07)",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:"0.6vw"}}>
          <div style={{width:"0.7vw",height:"0.7vw",borderRadius:"50%",background:isLive?"#2ecc71":O,boxShadow:isLive?"0 0 10px #2ecc71":`0 0 8px ${O}`,animation:isLive?"livePulse 1.8s ease-in-out infinite":"none"}}/>
          <span style={{fontSize:V.sm,letterSpacing:"0.2em",color:isLive?"#2ecc71":O,fontFamily:V.mono,textTransform:"uppercase"}}>
            {refreshing&&!data?"Loading…":isLive?"Live · SF Giants":game?.status==="complete"?`Final · ${awayAbbr} ${awayScore} – ${homeAbbr} ${homeScore}`:"No Game In Progress"}
          </span>
          {error&&<span style={{fontSize:V.xs,color:"#e74c3c",fontFamily:V.mono,marginLeft:"1vw"}}>⚠ {error}</span>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:"1.2vw"}}>
          <span style={{fontSize:V.sm,color:"rgba(255,255,255,0.25)",fontFamily:V.mono}}>{refreshing?"Refreshing…":lastUpdate?`Updated ${lastUpdate.toLocaleTimeString()}`:""}</span>
          <button onClick={refresh} disabled={refreshing} style={{background:"transparent",border:`1px solid rgba(253,90,30,${refreshing?0.15:0.35})`,color:refreshing?`rgba(253,90,30,0.4)`:O,padding:`0.3vw 1vw`,borderRadius:2,fontSize:V.xs,fontFamily:V.mono,letterSpacing:"0.1em",cursor:refreshing?"default":"pointer",textTransform:"uppercase"}}>
            {refreshing?"…":"Refresh"}
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{flex:1,minHeight:0,overflow:"hidden"}}>
        {!data&&refreshing?(
          <div style={{height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"1vw"}}>
            <div style={{fontSize:V.xl,color:O,fontFamily:V.mono,letterSpacing:"0.2em"}}>LOADING LIVE DATA…</div>
            <div style={{fontSize:V.sm,color:"rgba(255,255,255,0.3)",fontFamily:V.mono}}>Connecting to MLB Stats API</div>
          </div>
        ):!data&&error?(
          <div style={{height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"1.5vw"}}>
            <div style={{fontSize:V.xl,color:"#e74c3c",fontFamily:V.mono}}>⚠ Connection Error</div>
            <div style={{fontSize:V.md,color:"rgba(255,255,255,0.4)",fontFamily:V.mono,maxWidth:"40vw",textAlign:"center"}}>{error}</div>
            <button onClick={refresh} style={{background:O,border:"none",color:"#fff",padding:`0.6vw 2vw`,borderRadius:3,fontSize:V.md,fontFamily:V.mono,letterSpacing:"0.1em",cursor:"pointer",textTransform:"uppercase"}}>Retry</button>
          </div>
        ):showGame?(
          <div style={{height:"100%",display:"flex",flexDirection:"column",padding:V.p}}>
            <div style={{display:"flex",alignItems:"center",marginBottom:V.p,flexShrink:0}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:V.xs,letterSpacing:"0.15em",color:"rgba(255,255,255,0.4)",textTransform:"uppercase",fontFamily:V.mono,marginBottom:"0.3vw"}}>Away</div>
                <div style={{fontSize:V.lg,fontWeight:700,color:"rgba(255,255,255,0.55)",marginBottom:"0.5vw",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{game.awayTeamName}</div>
                <div style={{fontSize:V.score,fontWeight:900,lineHeight:1,color:"rgba(255,255,255,0.75)",letterSpacing:"-0.03em",fontVariantNumeric:"tabular-nums"}}>{awayScore}</div>
              </div>
              <SituationPanel game={game}/>
              <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",alignItems:"flex-end"}}>
                <div style={{fontSize:V.xs,letterSpacing:"0.15em",color:"rgba(255,255,255,0.4)",textTransform:"uppercase",fontFamily:V.mono,marginBottom:"0.3vw"}}>Home</div>
                <div style={{fontSize:V.lg,fontWeight:700,color:O,marginBottom:"0.5vw",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{game.homeTeamName}</div>
                <div style={{fontSize:V.score,fontWeight:900,lineHeight:1,letterSpacing:"-0.03em",fontVariantNumeric:"tabular-nums",color:O,textShadow:homeW?`0 0 4vw rgba(253,90,30,0.5)`:"none"}}>{homeScore}</div>
              </div>
            </div>
            <div style={{height:1,background:"rgba(255,255,255,0.07)",flexShrink:0,marginBottom:V.p}}/>
            <div style={{flexShrink:0,marginBottom:V.p}}>
              <div style={{fontSize:V.xs,letterSpacing:"0.2em",color:"rgba(255,255,255,0.3)",textTransform:"uppercase",fontFamily:V.mono,marginBottom:"0.5vw"}}>Linescore</div>
              <Linescore scoring={game.scoring_by_period||{}} rhe={game.rhe} homeAbbr={homeAbbr} awayAbbr={awayAbbr}/>
            </div>
            <div style={{height:1,background:"rgba(255,255,255,0.07)",flexShrink:0,marginBottom:V.p}}/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:`0 ${V.p}`,flex:1,minHeight:0,overflow:"hidden"}}>
              <div style={{overflow:"hidden"}}>
                <div style={{fontSize:V.xs,letterSpacing:"0.2em",color:O,opacity:0.7,textTransform:"uppercase",fontFamily:V.mono,marginBottom:"0.6vw"}}>Giants Batting</div>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:V.sm,fontFamily:V.mono}}>
                  <thead><tr>{["Player","AB","H","HR","RBI","R"].map(h=><th key={h} style={{textAlign:h==="Player"?"left":"center",padding:`0.2vw 0.3vw 0.5vw`,color:"rgba(255,255,255,0.3)",fontWeight:400,fontSize:V.xs}}>{h}</th>)}</tr></thead>
                  <tbody>
                    {(game.batters?.[homeAbbr]||[]).map((p,i)=>{
                      const isUp=game.atBat?.name===p.name;
                      return (
                        <tr key={i} style={{borderTop:"1px solid rgba(255,255,255,0.05)",background:isUp?"rgba(253,90,30,0.08)":"transparent"}}>
                          <td style={{padding:`0.4vw 0.4vw 0.4vw 0`,color:"#fff"}}>
                            {isUp&&<span style={{display:"inline-block",width:"0.5vw",height:"0.5vw",borderRadius:"50%",background:O,marginRight:"0.4vw",verticalAlign:"middle",boxShadow:`0 0 5px ${O}`}}/>}
                            <span style={{color:"rgba(255,255,255,0.4)",marginRight:"0.4vw",fontSize:V.xs}}>{p.position}</span>{p.name}
                          </td>
                          {[p.ab,p.h,p.hr,p.rbi,p.r].map((v,j)=>(
                            <td key={j} style={{textAlign:"center",padding:`0.4vw 0.3vw`,color:j===2||j===3?(v||0)>0?O:"rgba(255,255,255,0.2)":(v||0)>0?"#fff":"rgba(255,255,255,0.3)",fontWeight:(v||0)>0&&j>0?700:400}}>{j>0?(v||"—"):v}</td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{borderLeft:"1px solid rgba(255,255,255,0.07)",paddingLeft:V.p,overflow:"hidden"}}>
                <div style={{fontSize:V.xs,letterSpacing:"0.2em",color:O,opacity:0.7,textTransform:"uppercase",fontFamily:V.mono,marginBottom:"0.6vw"}}>Pitching</div>
                {[{label:game.homeTeamName,key:homeAbbr},{label:game.awayTeamName,key:awayAbbr}].map(({label,key})=>(
                  <div key={key} style={{marginBottom:key===homeAbbr?"1.2vw":0}}>
                    <div style={{fontSize:V.xs,color:"rgba(255,255,255,0.35)",textTransform:"uppercase",fontFamily:V.mono,marginBottom:"0.4vw",letterSpacing:"0.1em"}}>{label}</div>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:V.sm,fontFamily:V.mono}}>
                      <thead><tr>{["Pitcher","IP","K","BB","ER"].map(h=><th key={h} style={{textAlign:h==="Pitcher"?"left":"center",padding:`0.2vw 0.3vw 0.4vw`,color:"rgba(255,255,255,0.3)",fontWeight:400,fontSize:V.xs}}>{h}</th>)}</tr></thead>
                      <tbody>
                        {(game.pitchers?.[key]||[]).map((p,i)=>(
                          <tr key={i} style={{borderTop:"1px solid rgba(255,255,255,0.05)"}}>
                            <td style={{padding:`0.4vw 0.4vw 0.4vw 0`,color:key===homeAbbr?"#fff":"rgba(255,255,255,0.6)"}}>
                              {p.status==="active"&&<span style={{display:"inline-block",width:"0.5vw",height:"0.5vw",borderRadius:"50%",background:"#2ecc71",marginRight:"0.4vw",verticalAlign:"middle",boxShadow:"0 0 4px #2ecc71"}}/>}
                              {p.name}
                            </td>
                            {[p.ip,p.k,p.bb,p.er].map((v,j)=>(
                              <td key={j} style={{textAlign:"center",padding:`0.4vw 0.3vw`,color:j===3&&v>0?"#e74c3c":j===2&&v>3?"#e74c3c":"rgba(255,255,255,0.55)"}}>{v??0}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ):(
          <NLWestStandings standings={standings} nextGame={nextGame}/>
        )}
      </div>

      <div style={{padding:`0.6vw ${V.p}`,borderTop:"1px solid rgba(255,255,255,0.06)",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
        <span style={{fontSize:V.xs,color:"rgba(255,255,255,0.15)",fontFamily:V.mono,letterSpacing:"0.1em"}}>ORACLE PARK · SAN FRANCISCO · SF GIANTS</span>
        <span style={{fontSize:V.xs,color:"rgba(255,255,255,0.15)",fontFamily:V.mono}}>Live data via MLB Stats API · No API key required</span>
      </div>

      <style>{`*{box-sizing:border-box;margin:0;padding:0}@keyframes livePulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.8)}}`}</style>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GiantsScoreboard />
  </React.StrictMode>
)
