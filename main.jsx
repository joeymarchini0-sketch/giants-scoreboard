import React, { useState, useEffect, useCallback } from 'react'
import ReactDOM from 'react-dom/client'

const O = "#FD5A1E";
const B = "#27251F";
const SF_ID = 137;

const V = {
  xs:"0.7vw", sm:"0.85vw", md:"1.05vw", lg:"1.35vw",
  xl:"1.8vw", "2xl":"2.4vw", "3xl":"3.2vw", score:"7vw",
  p:"1.4vw", gap:"0.8vw",
  mono:"'Courier New', monospace",
  serif:"Georgia, 'Times New Roman', serif",
};

// Team colors and MLB logo IDs
const TEAM_META = {
  LAD: { color:"#005A9C", bg:"rgba(0,90,156,0.12)", id:119, name:"Dodgers" },
  SD:  { color:"#2F241D", bg:"rgba(47,36,29,0.2)",  id:135, name:"Padres" },
  AZ:  { color:"#A71930", bg:"rgba(167,25,48,0.12)", id:109, name:"D-backs" },
  SF:  { color:O,         bg:"rgba(253,90,30,0.13)", id:137, name:"Giants" },
  COL: { color:"#7B4FBE", bg:"rgba(123,79,190,0.12)",id:115, name:"Rockies" },
};

function logoUrl(teamId) {
  return `https://www.mlbstatic.com/team-logos/${teamId}.svg`;
}

function isDeployed() {
  return typeof window !== "undefined" &&
    !window.location.hostname.includes("claude") &&
    window.location.hostname !== "localhost";
}

async function mlb(path) {
  if (!isDeployed()) throw new Error("PREVIEW_MODE");
  const res = await fetch(`/api/mlb?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error(`MLB API ${res.status}: ${path}`);
  return res.json();
}

async function fetchAll() {
  const today = new Date().toISOString().slice(0,10);

  // Standings + streak
  const stData = await mlb("/standings?leagueId=104&standingsTypes=regularSeason&hydrate=streak");
  const nlWest = stData.records?.find(r => r.division?.id === 203);
  const standings = (nlWest?.teamRecords || []).map((t, i) => ({
    rank: i + 1,
    abbr: t.team.abbreviation,
    name: t.team.name,
    id:   t.team.id,
    w: t.wins,
    l: t.losses,
    streak: t.streak?.streakCode || null, // e.g. "W3" or "L2"
  }));

  // Today's game
  const schData = await mlb(`/schedule?sportId=1&teamId=${SF_ID}&date=${today}`);
  const todayGame = schData.dates?.[0]?.games?.[0] || null;

  // Next scheduled game
  const future = new Date(); future.setDate(future.getDate() + 14);
  const fStr = future.toISOString().slice(0,10);
  const nextData = await mlb(`/schedule?sportId=1&teamId=${SF_ID}&startDate=${today}&endDate=${fStr}`);
  let nextGame = null;
  outer: for (const d of (nextData.dates || [])) {
    for (const g of (d.games || [])) {
      if (g.status?.abstractGameState !== "Final") {
        const homeTeam = g.teams.home.team || g.teams.home;
        const awayTeam = g.teams.away.team || g.teams.away;
        const isHome = homeTeam.id === SF_ID;
        nextGame = {
          opponent: isHome ? (awayTeam.name || awayTeam.teamName) : (homeTeam.name || homeTeam.teamName),
          opponentId: isHome ? (awayTeam.id) : (homeTeam.id),
          location: isHome ? "Oracle Park" : (homeTeam.name || homeTeam.teamName),
          date: new Date(g.gameDate).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",timeZone:"America/Los_Angeles"}),
          time: new Date(g.gameDate).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",timeZoneName:"short",timeZone:"America/Los_Angeles"}),
        };
        break outer;
      }
    }
  }

  // Last game result (most recent closed game)
  const pastData = await mlb(`/schedule?sportId=1&teamId=${SF_ID}&startDate=2026-05-01&endDate=${today}&gameType=R`);
  let lastGame = null;
  const allPast = [];
  for (const d of (pastData.dates || [])) {
    for (const g of (d.games || [])) {
      if (g.status?.abstractGameState === "Final") allPast.push(g);
    }
  }
  if (allPast.length) {
    const g = allPast[allPast.length - 1];
    const homeTeam = g.teams.home.team || g.teams.home;
    const awayTeam = g.teams.away.team || g.teams.away;
    const isHome = homeTeam.id === SF_ID;
    const sfScore  = isHome ? g.teams.home.score : g.teams.away.score;
    const oppScore = isHome ? g.teams.away.score : g.teams.home.score;
    const oppName  = isHome ? (awayTeam.name||awayTeam.teamName) : (homeTeam.name||homeTeam.teamName);
    const oppId    = isHome ? awayTeam.id : homeTeam.id;
    const won = sfScore > oppScore;
    lastGame = { won, sfScore, oppScore, oppName, oppId };
  }

  if (!todayGame) return { game: null, standings, nextGame, lastGame };

  const homeTeam = todayGame.teams.home.team || todayGame.teams.home;
  const awayTeam = todayGame.teams.away.team || todayGame.teams.away;
  const homeAbbr = homeTeam.abbreviation || "SF";
  const awayAbbr = awayTeam.abbreviation || "AZ";
  const status = todayGame.status?.abstractGameState;

  const baseGame = {
    hasGame: true,
    status: status === "Live" ? "inprogress" : status === "Final" ? "complete" : "scheduled",
    home: homeAbbr, away: awayAbbr,
    homeTeamName: homeTeam.name || homeTeam.teamName,
    awayTeamName: awayTeam.name || awayTeam.teamName,
    homeTeamId: homeTeam.id,
    awayTeamId: awayTeam.id,
    score: { [homeAbbr]: 0, [awayAbbr]: 0 },
  };

  if (status === "Live" || status === "Final") {
    const pk = todayGame.gamePk;
    const [ls, bs] = await Promise.all([
      mlb(`/game/${pk}/linescore`),
      mlb(`/game/${pk}/boxscore`),
    ]);

    baseGame.score[homeAbbr] = ls.teams?.home?.runs ?? 0;
    baseGame.score[awayAbbr] = ls.teams?.away?.runs ?? 0;

    const scoring_by_period = {};
    (ls.innings || []).forEach(inn => {
      scoring_by_period[inn.num] = {
        [homeAbbr]: inn.home?.runs !== undefined ? inn.home.runs : "X",
        [awayAbbr]: inn.away?.runs !== undefined ? inn.away.runs : "·",
      };
    });

    const rhe = {
      [homeAbbr]: { runs: ls.teams?.home?.runs??0, hits: ls.teams?.home?.hits??0, errors: ls.teams?.home?.errors??0 },
      [awayAbbr]: { runs: ls.teams?.away?.runs??0, hits: ls.teams?.away?.hits??0, errors: ls.teams?.away?.errors??0 },
    };

    const batters  = { [homeAbbr]: [], [awayAbbr]: [] };
    const pitchers = { [homeAbbr]: [], [awayAbbr]: [] };

    for (const [side, abbr] of [["home", homeAbbr], ["away", awayAbbr]]) {
      const t = bs.teams?.[side];
      if (!t) continue;
      const orderIds = t.battingOrder?.length ? t.battingOrder : (t.batters || []);
      orderIds.forEach(pid => {
        const p = t.players?.[`ID${pid}`];
        if (!p) return;
        const s = p.stats?.batting || {};
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
      inning = ls.currentInning;
      inningHalf = ls.isTopInning ? "top" : "bottom";
      outs = ls.outs ?? 0;
      count = { balls: ls.balls??0, strikes: ls.strikes??0 };
      onBase = { first:!!ls.offense?.first, second:!!ls.offense?.second, third:!!ls.offense?.third };
      const bid = ls.offense?.batter?.id;
      if (bid) {
        const side = ls.isTopInning ? "away" : "home";
        const bp = bs.teams?.[side]?.players?.[`ID${bid}`];
        if (bp) {
          const s = bp.stats?.batting || {};
          atBat = { name:bp.person.fullName, position:bp.position?.abbreviation||"", ab:s.atBats??0, h:s.hits??0 };
        }
      }
    }
    return { game: { ...baseGame, scoring_by_period, rhe, batters, pitchers, atBat, count, onBase, inning, inningHalf, outs }, standings, nextGame, lastGame };
  }

  return { game: baseGame, standings, nextGame, lastGame };
}

// ── Components ────────────────────────────────────────────────────────────────

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

function TeamLogo({ teamId, size="2.8vw", abbr="" }) {
  const [err, setErr] = useState(false);
  const meta = Object.values(TEAM_META).find(m=>m.id===teamId);
  if (err) {
    return (
      <div style={{width:size,height:size,borderRadius:"50%",background:meta?.color||"rgba(255,255,255,0.15)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
        <span style={{fontSize:`calc(${size} * 0.38)`,fontWeight:900,color:"#fff",fontFamily:"'Courier New',monospace"}}>{abbr.slice(0,2)}</span>
      </div>
    );
  }
  return (
    <img
      src={logoUrl(teamId)}
      alt=""
      onError={()=>setErr(true)}
      style={{width:size,height:size,objectFit:"contain",flexShrink:0}}
    />
  );
}

function StreakBadge({ streak }) {
  if (!streak) return null;
  const isWin = streak.startsWith("W");
  const num = streak.slice(1);
  return (
    <div style={{
      display:"inline-flex",alignItems:"center",gap:"0.2vw",
      background: isWin ? "rgba(46,204,113,0.15)" : "rgba(231,76,60,0.15)",
      border: `1px solid ${isWin ? "rgba(46,204,113,0.35)" : "rgba(231,76,60,0.35)"}`,
      borderRadius:"0.3vw",
      padding:"0.15vw 0.5vw",
      fontFamily:V.mono,
      fontSize:V.sm,
      fontWeight:700,
      color: isWin ? "#2ecc71" : "#e74c3c",
      letterSpacing:"0.05em",
    }}>
      {isWin ? "W" : "L"}{num}
    </div>
  );
}

function NLWestStandings({ standings, nextGame, lastGame }) {
  const leader = standings[0];

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",padding:`1.5vw ${V.p} ${V.p}`}}>

      {/* Next game + last game row */}
      <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:"1vw",marginBottom:"1.5vw",flexShrink:0}}>

        {/* Next game banner */}
        <div style={{background:`linear-gradient(135deg,rgba(253,90,30,0.13),rgba(253,90,30,0.04))`,border:`1px solid rgba(253,90,30,0.3)`,borderRadius:4,padding:`1.4vw 2vw`,display:"flex",alignItems:"center",gap:"1.5vw"}}>
          <div style={{flexShrink:0}}>
            <div style={{fontSize:V.xs,letterSpacing:"0.2em",color:"rgba(255,255,255,0.4)",textTransform:"uppercase",fontFamily:V.mono,marginBottom:"0.3vw"}}>Next Game</div>
            <div style={{fontSize:V.xs,color:"rgba(255,255,255,0.3)",fontFamily:V.mono}}>{nextGame?.location}</div>
          </div>

          <div style={{flex:1}}>
            <div style={{fontSize:V["2xl"],fontWeight:900,color:"#fff",lineHeight:1.1}}>
              <span style={{color:O}}>SF Giants</span>
              <span style={{color:"rgba(255,255,255,0.3)",margin:"0 0.8vw",fontWeight:400,fontSize:V.xl}}>vs</span>
              <span>{nextGame?.opponent}</span>
            </div>
          </div>
          <div style={{flexShrink:0,textAlign:"right"}}>
            <div style={{fontSize:V["2xl"],fontWeight:900,color:O,fontFamily:V.mono,lineHeight:1}}>{nextGame?.time}</div>
            <div style={{fontSize:V.md,color:"rgba(255,255,255,0.5)",fontFamily:V.mono,marginTop:"0.3vw"}}>{nextGame?.date}</div>
          </div>
        </div>

        {/* Last game result */}
        {lastGame && (
          <div style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:4,padding:`1.4vw 1.8vw`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"0.4vw",minWidth:"12vw"}}>
            <div style={{fontSize:V.xs,letterSpacing:"0.2em",color:"rgba(255,255,255,0.35)",textTransform:"uppercase",fontFamily:V.mono}}>Last Game</div>
            <div style={{display:"flex",alignItems:"center",gap:"0.8vw"}}>
              <TeamLogo teamId={lastGame.oppId} size="2.2vw"/>
              <div style={{fontSize:V["2xl"],fontWeight:900,fontFamily:V.mono,color:lastGame.won?"#2ecc71":"#e74c3c"}}>
                {lastGame.won?"W":"L"}
              </div>
              <div style={{fontSize:V.lg,fontWeight:700,color:"#fff",fontFamily:V.mono}}>
                {lastGame.sfScore}–{lastGame.oppScore}
              </div>
            </div>
            <div style={{fontSize:V.xs,color:"rgba(255,255,255,0.3)",fontFamily:V.mono}}>vs {lastGame.oppName}</div>
          </div>
        )}
      </div>

      {/* Standings header */}
      <div style={{display:"flex",alignItems:"baseline",gap:"0.8vw",marginBottom:"0.8vw",flexShrink:0}}>
        <div style={{fontSize:V["2xl"],fontWeight:900,color:"#fff"}}>NL West</div>
        <div style={{fontSize:V.xs,letterSpacing:"0.2em",color:"rgba(255,255,255,0.35)",textTransform:"uppercase",fontFamily:V.mono}}>Standings</div>
      </div>

      {/* Standings table */}
      <div style={{flex:1,minHeight:0}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontFamily:V.serif}}>
          <thead>
            <tr style={{borderBottom:"1px solid rgba(255,255,255,0.1)"}}>
              {["#","","Team","W","L","PCT","GB","STREAK"].map((h,i)=>(
                <th key={i} style={{textAlign:i<3?"left":"center",padding:`0.4vw 0.8vw 0.7vw`,color:"rgba(255,255,255,0.3)",fontWeight:400,fontSize:V.xs,letterSpacing:"0.15em",fontFamily:V.mono,textTransform:"uppercase"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {standings.map((team,i)=>{
              const isG = team.abbr === "SF";
              const meta = TEAM_META[team.abbr] || { color:"rgba(255,255,255,0.4)", bg:"transparent" };
              const pct = (team.w/(team.w+team.l)).toFixed(3).replace(/^0/,"");
              const gb = i===0?"—":(((leader.w-team.w)+(team.l-leader.l))/2).toFixed(1);
              return (
                <tr key={team.abbr} style={{
                  borderBottom:"1px solid rgba(255,255,255,0.06)",
                  background: isG ? "rgba(253,90,30,0.1)" : meta.bg,
                  outline: isG ? `1px solid rgba(253,90,30,0.3)` : "none",
                  outlineOffset: "-1px",
                }}>
                  {/* Rank */}
                  <td style={{padding:"1.1vw 0.8vw",color:isG?O:"rgba(255,255,255,0.3)",fontSize:V.md,fontFamily:V.mono,fontWeight:isG?700:400}}>{team.rank}</td>

                  {/* Logo */}
                  <td style={{padding:"1.1vw 0.4vw 1.1vw 0.8vw",width:"3.5vw"}}>
                    <TeamLogo teamId={team.id} size="3vw" abbr={team.abbr}/>
                  </td>

                  {/* Team name */}
                  <td style={{padding:"1.1vw 0.8vw"}}>
                    <div style={{fontSize:V.lg,fontWeight:isG?900:600,color:isG?"#fff":"rgba(255,255,255,0.8)",letterSpacing:"0.01em"}}>
                      {meta.name || team.name}
                    </div>
                    {isG && <div style={{fontSize:V.xs,color:O,fontFamily:V.mono,letterSpacing:"0.1em",marginTop:"0.1vw"}}>YOUR TEAM</div>}
                  </td>

                  {/* W */}
                  <td style={{textAlign:"center",padding:"1.1vw 0.8vw",fontSize:V.xl,fontWeight:800,color:isG?"#fff":"rgba(255,255,255,0.75)"}}>{team.w}</td>

                  {/* L */}
                  <td style={{textAlign:"center",padding:"1.1vw 0.8vw",fontSize:V.xl,color:"rgba(255,255,255,0.5)"}}>{team.l}</td>

                  {/* PCT */}
                  <td style={{textAlign:"center",padding:"1.1vw 0.8vw",fontFamily:V.mono,fontSize:V.md,color:isG?O:"rgba(255,255,255,0.6)",fontWeight:isG?700:400}}>{pct}</td>

                  {/* GB */}
                  <td style={{textAlign:"center",padding:"1.1vw 0.8vw",fontFamily:V.mono,fontSize:V.md,color:"rgba(255,255,255,0.45)"}}>
                    {gb}
                  </td>

                  {/* Streak */}
                  <td style={{textAlign:"center",padding:"1.1vw 0.8vw"}}>
                    <StreakBadge streak={team.streak}/>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function GiantsScoreboard() {
  const [data, setData]             = useState(null);
  const [error, setError]           = useState(null);
  const [refreshing, setRefreshing] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [pulse, setPulse]           = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true); setError(null);
    try {
      const result = await fetchAll();
      setData(result);
      setLastUpdate(new Date());
      setPulse(true); setTimeout(()=>setPulse(false),600);
    } catch(e) {
      if (e.message === "PREVIEW_MODE") {
        setData({
          game: null,
          standings: [
            { rank:1, abbr:"LAD", name:"Los Angeles Dodgers",  id:119, w:33, l:20, streak:"W2" },
            { rank:2, abbr:"SD",  name:"San Diego Padres",     id:135, w:31, l:21, streak:"L1" },
            { rank:3, abbr:"AZ",  name:"Arizona Diamondbacks", id:109, w:29, l:24, streak:"W1" },
            { rank:4, abbr:"SF",  name:"San Francisco Giants", id:137, w:22, l:32, streak:"L1" },
            { rank:5, abbr:"COL", name:"Colorado Rockies",     id:115, w:20, l:34, streak:"L3" },
          ],
          nextGame: { opponent:"Arizona Diamondbacks", opponentId:109, date:"Tue, May 26", time:"6:45 PM PDT", location:"Oracle Park" },
          lastGame: { won:false, sfScore:2, oppScore:6, oppName:"Arizona Diamondbacks", oppId:109 },
        });
        setError("Preview mode");
      } else {
        setError(e.message);
      }
    } finally { setRefreshing(false); }
  }, []);

  useEffect(()=>{ refresh(); const t=setInterval(refresh,30000); return ()=>clearInterval(t); },[refresh]);

  const game      = data?.game;
  const standings = data?.standings || [];
  const nextGame  = data?.nextGame  || null;
  const lastGame  = data?.lastGame  || null;
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
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:`0.7vw ${V.p}`,borderBottom:"1px solid rgba(255,255,255,0.07)",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:"0.7vw"}}>
          <div style={{width:"0.7vw",height:"0.7vw",borderRadius:"50%",background:isLive?"#2ecc71":O,boxShadow:isLive?"0 0 10px #2ecc71":`0 0 8px ${O}`,animation:isLive?"livePulse 1.8s ease-in-out infinite":"none"}}/>
          <span style={{fontSize:V.sm,letterSpacing:"0.2em",color:isLive?"#2ecc71":O,fontFamily:V.mono,textTransform:"uppercase"}}>
            {refreshing&&!data?"Loading…":isLive?"Live · SF Giants":"No Game In Progress"}
          </span>
          {error&&error!=="Preview mode"&&<span style={{fontSize:V.xs,color:"rgba(253,90,30,0.5)",fontFamily:V.mono,marginLeft:"1vw"}}>⚠ {error}</span>}
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
        ):showGame?(
          <div style={{height:"100%",display:"flex",flexDirection:"column",padding:V.p}}>
            {/* Scores */}
            <div style={{display:"flex",alignItems:"center",marginBottom:V.p,flexShrink:0}}>
              <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",gap:"0.4vw"}}>
                <div style={{fontSize:V.xs,letterSpacing:"0.15em",color:"rgba(255,255,255,0.4)",textTransform:"uppercase",fontFamily:V.mono}}>Away</div>
                <div style={{display:"flex",alignItems:"center",gap:"0.8vw"}}>
                  <TeamLogo teamId={game.awayTeamId} size="2.5vw"/>
                  <div style={{fontSize:V.lg,fontWeight:700,color:"rgba(255,255,255,0.55)"}}>{game.awayTeamName}</div>
                </div>
                <div style={{fontSize:V.score,fontWeight:900,lineHeight:1,color:"rgba(255,255,255,0.75)",letterSpacing:"-0.03em",fontVariantNumeric:"tabular-nums"}}>{awayScore}</div>
              </div>
              <SituationPanel game={game}/>
              <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",alignItems:"flex-end",gap:"0.4vw"}}>
                <div style={{fontSize:V.xs,letterSpacing:"0.15em",color:"rgba(255,255,255,0.4)",textTransform:"uppercase",fontFamily:V.mono}}>Home</div>
                <div style={{display:"flex",alignItems:"center",gap:"0.8vw"}}>
                  <div style={{fontSize:V.lg,fontWeight:700,color:O}}>{game.homeTeamName}</div>
                  <TeamLogo teamId={game.homeTeamId} size="2.5vw"/>
                </div>
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
          <NLWestStandings standings={standings} nextGame={nextGame} lastGame={lastGame}/>
        )}
      </div>

      <div style={{padding:`0.5vw ${V.p}`,borderTop:"1px solid rgba(255,255,255,0.06)",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
        <span style={{fontSize:V.xs,color:"rgba(255,255,255,0.15)",fontFamily:V.mono,letterSpacing:"0.1em"}}>ORACLE PARK · SAN FRANCISCO · SF GIANTS</span>
        <span style={{fontSize:V.xs,color:"rgba(255,255,255,0.15)",fontFamily:V.mono}}>Live via MLB Stats API · Refreshes every 30s</span>
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
