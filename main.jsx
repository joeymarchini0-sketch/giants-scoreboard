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
    inSeason:false, abbrevs:["GSW","GS"],
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
    inSeason:true, abbrevs:["GSV"],
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
    { sport:"wnba", teamKey:"valkyries", abbrevs:["GSV"] },
    { sport:"nba",  teamKey:"warriors",  abbrevs:["GSW","GS"] },
    { sport:"nfl",  teamKey:"niners",    abbrevs:["SF","SFO"] },
    { sport:"nhl",  teamKey:"sharks",    abbrevs:["SJS","SJ"] },
  ];

  for (const {sport, teamKey, abbrevs} of sportChecks) {
    try {
      const games = await espn(sport);
      for (const g of games) {
        const isBayHome = abbrevs.includes(g.home);
        const isBayAway = abbrevs.includes(g.away);
        if ((isBayHome || isBayAway) && g.status === "inprogress") {
          const isHome = isBayHome;
          const opp = isHome ? g.awayName : g.homeName;
          const bayScore = isHome ? g.homeScore : g.awayScore;
          const oppScore = isHome ? g.awayScore : g.homeScore;
          // Period label per sport
          let situation = "Live";
          if (g.period && g.clock) {
            const pLabel = sport==="nfl"?`Q${g.period}`:sport==="nhl"?`P${g.period}`:`Q${g.period}`;
            situation = `${pLabel} ${g.clock}`;
          }
          live.push({teamKey,opponent:`${isHome?"vs":"at"} ${opp}`,bayScore,oppScore,situation});
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
  const homeAbbr=ht.abbreviation||"SF", awayAbbr=at.abbreviation||"MIL";
  const status=todayGame.status?.abstractGameState;
  const baseGame={
    hasGame:true,
    status:status==="Live"?"inprogress":status==="Final"?"complete":"scheduled",
    home:homeAbbr,away:awayAbbr,
    homeTeamName:ht.name||ht.teamName,awayTeamName:at.name||at.teamName,
    homeTeamId:ht.id,awayTeamId:at.id,
    score:{[homeAbbr]:0,[awayAbbr]:0},
  };

  if (status==="Live"||status==="Final") {
    const pk=todayGame.gamePk;
    const [ls,bs]=await Promise.all([mlb(`/game/${pk}/linescore`),mlb(`/game/${pk}/boxscore`)]);
    baseGame.score[homeAbbr]=ls.teams?.home?.runs??0;
    baseGame.score[awayAbbr]=ls.teams?.away?.runs??0;
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
  return (
    <div style={{minHeight:"100vh",background:"#111",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"2.5vw",padding:"4vw",fontFamily:"Georgia,serif"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:"2.2vw",fontWeight:900,color:"#fff",letterSpacing:"0.05em"}}>BAY AREA SPORTS</div>
        <div style={{fontSize:"0.85vw",color:"rgba(255,255,255,0.35)",fontFamily:"'Courier New',monospace",letterSpacing:"0.2em",textTransform:"uppercase",marginTop:"0.3vw"}}>Live Scores & Standings</div>
      </div>

      {hasLive ? (
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"1vw",width:"100%",maxWidth:"65vw"}}>
          <div style={{fontSize:"0.75vw",letterSpacing:"0.2em",color:"rgba(255,255,255,0.35)",fontFamily:"'Courier New',monospace",textTransform:"uppercase",marginBottom:"0.3vw"}}>Live Now</div>
          {liveGames.map((g,i)=>{
            const team=TEAMS[g.teamKey];
            return (
              <button key={i} onClick={()=>onSelectGame(g.teamKey)} style={{
                width:"100%",background:`linear-gradient(135deg,${team.primary}22,${team.primary}44)`,
                border:`2px solid ${team.primary}`,borderRadius:6,
                padding:"1.4vw 2.5vw",cursor:"pointer",
                display:"flex",alignItems:"center",justifyContent:"space-between",
                transition:"all 0.2s",
              }}
                onMouseOver={e=>e.currentTarget.style.background=`linear-gradient(135deg,${team.primary}44,${team.primary}66)`}
                onMouseOut={e=>e.currentTarget.style.background=`linear-gradient(135deg,${team.primary}22,${team.primary}44)`}
              >
                <div style={{display:"flex",alignItems:"center",gap:"1.5vw"}}>
                  <TeamLogo src={team.logo} size="4vw" fallbackText={team.name.slice(0,2)}/>
                  <div style={{textAlign:"left"}}>
                    <div style={{fontSize:"1.8vw",fontWeight:900,color:"#fff"}}>{team.name}</div>
                    <div style={{fontSize:"0.9vw",color:"rgba(255,255,255,0.5)",fontFamily:"'Courier New',monospace",marginTop:"0.1vw"}}>{g.opponent}</div>
                  </div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:"4vw",fontWeight:900,lineHeight:1,fontVariantNumeric:"tabular-nums",display:"flex",alignItems:"center",gap:"0.5vw"}}>
                    <span style={{color:team.primary}}>{g.bayScore}</span>
                    <span style={{color:"rgba(255,255,255,0.25)",fontSize:"2.2vw"}}>–</span>
                    <span style={{color:"rgba(255,255,255,0.8)"}}>{g.oppScore}</span>
                  </div>
                  <div style={{fontSize:"0.8vw",color:team.primary,fontFamily:"'Courier New',monospace",marginTop:"0.2vw"}}>{g.situation}</div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div style={{textAlign:"center",padding:"2vw 4vw",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:6}}>
          <div style={{fontSize:"1.1vw",color:"rgba(255,255,255,0.4)",fontFamily:"'Courier New',monospace",letterSpacing:"0.1em"}}>
            {checking?"CHECKING FOR LIVE GAMES…":"NO GAMES LIVE RIGHT NOW"}
          </div>
        </div>
      )}

      <button onClick={onStandings} style={{
        background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.2)",
        color:"#fff",padding:"1.2vw 5vw",borderRadius:4,
        fontSize:"1.1vw",fontFamily:"'Courier New',monospace",letterSpacing:"0.2em",
        cursor:"pointer",textTransform:"uppercase",transition:"all 0.2s",
      }}
        onMouseOver={e=>{e.currentTarget.style.background="rgba(255,255,255,0.12)";e.currentTarget.style.borderColor="rgba(255,255,255,0.4)";}}
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
              <div style={{fontSize:"0.65vw",letterSpacing:"0.2em",color:"rgba(255,255,255,0.4)",textTransform:"uppercase",fontFamily:"'Courier New',monospace",marginBottom:"0.2vw"}}>Next Game</div>
              <div style={{fontSize:"0.65vw",color:"rgba(255,255,255,0.3)",fontFamily:"'Courier New',monospace"}}>{nextGame?.location}</div>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:"1.6vw",fontWeight:900,color:"#fff",lineHeight:1.1}}>
                <span style={{color:O}}>SF Giants</span>
                <span style={{color:"rgba(255,255,255,0.3)",margin:"0 0.6vw",fontWeight:400,fontSize:"1.1vw"}}>vs</span>
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
              <div style={{fontSize:"0.65vw",letterSpacing:"0.2em",color:"rgba(255,255,255,0.35)",textTransform:"uppercase",fontFamily:"'Courier New',monospace"}}>Last Game</div>
              <div style={{display:"flex",alignItems:"center",gap:"0.6vw"}}>
                <TeamLogo src={`https://www.mlbstatic.com/team-logos/${lastGame.oppId}.svg`} size="1.8vw" fallbackText="OPP"/>
                <div style={{fontSize:"1.8vw",fontWeight:900,fontFamily:"'Courier New',monospace",color:lastGame.won?"#2ecc71":"#e74c3c"}}>{lastGame.won?"W":"L"}</div>
                <div style={{fontSize:"1.3vw",fontWeight:700,color:"#fff",fontFamily:"'Courier New',monospace"}}>{lastGame.sfScore}–{lastGame.oppScore}</div>
              </div>
              <div style={{fontSize:"0.65vw",color:"rgba(255,255,255,0.3)",fontFamily:"'Courier New',monospace"}}>vs {lastGame.oppName}</div>
            </div>
          )}
        </div>
        {/* Standings */}
        <div style={{display:"flex",alignItems:"baseline",gap:"0.6vw",flexShrink:0}}>
          <div style={{fontSize:"1.8vw",fontWeight:900,color:"#fff"}}>NL West</div>
          <div style={{fontSize:"0.65vw",letterSpacing:"0.2em",color:"rgba(255,255,255,0.35)",textTransform:"uppercase",fontFamily:"'Courier New',monospace"}}>Standings</div>
        </div>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr style={{borderBottom:"1px solid rgba(255,255,255,0.1)"}}>
              {["#","","Team","W","L","PCT","GB","STREAK"].map((h,i)=>(
                <th key={i} style={{textAlign:i<3?"left":"center",padding:"0.3vw 0.6vw 0.6vw",color:"rgba(255,255,255,0.3)",fontWeight:400,fontSize:"0.65vw",letterSpacing:"0.15em",fontFamily:"'Courier New',monospace",textTransform:"uppercase"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {standings.map((t,i)=>{
              const isG=t.abbr==="SF";
              const meta=MLB_COLORS[t.abbr]||{color:"rgba(255,255,255,0.4)",bg:"transparent"};
              const pct=(t.w/(t.w+t.l)).toFixed(3).replace(/^0/,"");
              const gb=i===0?"—":(((leader.w-t.w)+(t.l-leader.l))/2).toFixed(1);
              return (
                <tr key={t.abbr} style={{borderBottom:"1px solid rgba(255,255,255,0.06)",background:isG?"rgba(253,90,30,0.1)":meta.bg,outline:isG?"1px solid rgba(253,90,30,0.3)":"none",outlineOffset:"-1px"}}>
                  <td style={{padding:"0.9vw 0.6vw",color:isG?O:"rgba(255,255,255,0.3)",fontSize:"0.9vw",fontFamily:"'Courier New',monospace",fontWeight:isG?700:400}}>{t.rank}</td>
                  <td style={{padding:"0.9vw 0.3vw",width:"3vw"}}><TeamLogo src={`https://www.mlbstatic.com/team-logos/${t.id}.svg`} size="2.5vw" fallbackText={t.abbr}/></td>
                  <td style={{padding:"0.9vw 0.6vw"}}>
                    <div style={{fontSize:"1.1vw",fontWeight:isG?900:500,color:isG?"#fff":"rgba(255,255,255,0.8)"}}>
                      {t.name.split(" ").pop()}
                      {isG&&<span style={{marginLeft:"0.5vw",fontSize:"0.6vw",color:O,fontFamily:"'Courier New',monospace"}}>YOUR TEAM</span>}
                    </div>
                  </td>
                  <td style={{textAlign:"center",padding:"0.9vw 0.6vw",fontSize:"1.3vw",fontWeight:800,color:isG?"#fff":"rgba(255,255,255,0.75)"}}>{t.w}</td>
                  <td style={{textAlign:"center",padding:"0.9vw 0.6vw",fontSize:"1.3vw",color:"rgba(255,255,255,0.45)"}}>{t.l}</td>
                  <td style={{textAlign:"center",padding:"0.9vw 0.6vw",fontFamily:"'Courier New',monospace",fontSize:"0.85vw",color:isG?O:"rgba(255,255,255,0.55)",fontWeight:isG?700:400}}>{pct}</td>
                  <td style={{textAlign:"center",padding:"0.9vw 0.6vw",fontFamily:"'Courier New',monospace",fontSize:"0.85vw",color:"rgba(255,255,255,0.4)"}}>{gb}</td>
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
            <div style={{fontSize:"0.65vw",color:"rgba(255,255,255,0.4)",fontFamily:"'Courier New',monospace",letterSpacing:"0.15em",textTransform:"uppercase"}}>OFF SEASON</div>
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
                <th key={h} style={{textAlign:i<2?"left":"center",padding:"0.4vw 0.8vw 0.7vw",color:"rgba(255,255,255,0.3)",fontWeight:400,fontSize:"0.7vw",letterSpacing:"0.15em",fontFamily:"'Courier New',monospace",textTransform:"uppercase"}}>{h}</th>
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
                  <td style={{padding:"1.2vw 0.8vw",color:isBay?team.primary:"rgba(255,255,255,0.3)",fontSize:"1vw",fontFamily:"'Courier New',monospace",fontWeight:isBay?700:400}}>{t.rank}</td>
                  <td style={{padding:"1.2vw 0.8vw",fontSize:"1.3vw",fontWeight:isBay?900:500,color:isBay?"#fff":"rgba(255,255,255,0.75)"}}>
                    {t.name}
                    {isBay&&<span style={{marginLeft:"0.6vw",fontSize:"0.65vw",color:team.primary,fontFamily:"'Courier New',monospace"}}>YOUR TEAM</span>}
                  </td>
                  <td style={{textAlign:"center",padding:"1.2vw 0.8vw",fontSize:"1.5vw",fontWeight:700,color:isBay?"#fff":"rgba(255,255,255,0.7)"}}>{t.w}</td>
                  <td style={{textAlign:"center",padding:"1.2vw 0.8vw",fontSize:"1.5vw",color:"rgba(255,255,255,0.45)"}}>{t.l}</td>
                  <td style={{textAlign:"center",padding:"1.2vw 0.8vw",fontFamily:"'Courier New',monospace",fontSize:"0.95vw",color:isBay?team.primary:"rgba(255,255,255,0.55)"}}>{pct}</td>
                  <td style={{textAlign:"center",padding:"1.2vw 0.8vw",fontFamily:"'Courier New',monospace",fontSize:"0.95vw",color:"rgba(255,255,255,0.4)"}}>{gb}</td>
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
            <div style={{fontSize:"0.65vw",color:"rgba(255,255,255,0.4)",fontFamily:"'Courier New',monospace",letterSpacing:"0.15em",textTransform:"uppercase"}}>IN SEASON · 2025-26</div>
          </div>
        </div>
        <HomeBtn onClick={onHome}/>
      </div>
      <div style={{flex:1,padding:"2vw 2.5vw",display:"flex",flexDirection:"column",gap:"1.5vw",overflowY:"auto"}}>
        {/* Next game */}
        <div style={{background:`${team.primary}15`,border:`1px solid ${team.primary}44`,borderRadius:4,padding:"1vw 1.5vw",display:"flex",alignItems:"center",justifyContent:"space-between",gap:"1vw"}}>
          <div>
            <div style={{fontSize:"0.65vw",letterSpacing:"0.2em",color:"rgba(255,255,255,0.4)",textTransform:"uppercase",fontFamily:"'Courier New',monospace",marginBottom:"0.3vw"}}>Next Game · Chase Center</div>
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
                <th key={h} style={{textAlign:i<2?"left":"center",padding:"0.4vw 0.8vw 0.7vw",color:"rgba(255,255,255,0.3)",fontWeight:400,fontSize:"0.7vw",letterSpacing:"0.15em",fontFamily:"'Courier New',monospace",textTransform:"uppercase"}}>{h}</th>
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
                  <td style={{padding:"1vw 0.8vw",color:isBay?team.primary:"rgba(255,255,255,0.3)",fontSize:"1vw",fontFamily:"'Courier New',monospace",fontWeight:isBay?700:400}}>{t.rank}</td>
                  <td style={{padding:"1vw 0.8vw",fontSize:"1.3vw",fontWeight:isBay?900:500,color:isBay?"#fff":"rgba(255,255,255,0.75)"}}>
                    {t.name}
                    {isBay&&<span style={{marginLeft:"0.6vw",fontSize:"0.65vw",color:team.primary,fontFamily:"'Courier New',monospace"}}>YOUR TEAM</span>}
                  </td>
                  <td style={{textAlign:"center",padding:"1vw 0.8vw",fontSize:"1.4vw",fontWeight:700,color:isBay?"#fff":"rgba(255,255,255,0.7)"}}>{t.w}</td>
                  <td style={{textAlign:"center",padding:"1vw 0.8vw",fontSize:"1.4vw",color:"rgba(255,255,255,0.45)"}}>{t.l}</td>
                  <td style={{textAlign:"center",padding:"1vw 0.8vw",fontFamily:"'Courier New',monospace",fontSize:"0.95vw",color:isBay?team.primary:"rgba(255,255,255,0.55)"}}>{pct}</td>
                  <td style={{textAlign:"center",padding:"1vw 0.8vw",fontFamily:"'Courier New',monospace",fontSize:"0.95vw",color:"rgba(255,255,255,0.4)"}}>{gb}</td>
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
                <span style={{fontSize:"0.7vw",fontFamily:"'Courier New',monospace",color:isActive?t.primary:"rgba(255,255,255,0.4)",fontWeight:isActive?700:400}}>{t.name}</span>
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
      <div style={{fontSize:"0.65vw",letterSpacing:"0.16em",color:"rgba(255,255,255,0.3)",textTransform:"uppercase",fontFamily:"'Courier New',monospace"}}>{label}</div>
      <div style={{display:"flex",gap:"0.4vw"}}>
        {Array.from({length:total}).map((_,i)=>(
          <div key={i} style={{width:"0.9vw",height:"0.9vw",borderRadius:"50%",background:i<count?activeColor:"rgba(255,255,255,0.1)",border:`1.5px solid ${i<count?activeColor:"rgba(255,255,255,0.2)"}`,boxShadow:i<count?`0 0 7px ${activeColor}88`:"none",transition:"all 0.25s"}}/>
        ))}
      </div>
    </div>
  );
}

function GiantsScoreboard({onHome}) {
  const [gdata,setGdata]=useState(null);
  const [refreshing,setRefreshing]=useState(true);
  const [lastUpdate,setLastUpdate]=useState(null);
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
  const homeAbbr=game?.home||"SF", awayAbbr=game?.away||"MIL";
  const homeScore=game?.score?.[homeAbbr]??0;
  const awayScore=game?.score?.[awayAbbr]??0;

  if(!gdata) return <div style={{height:"100vh",background:"#27251F",display:"flex",alignItems:"center",justifyContent:"center",color:O,fontSize:"1.2vw",fontFamily:"'Courier New',monospace",letterSpacing:"0.2em"}}>LOADING…</div>;

  // If no live game, show standings
  if(!isLive) return <GiantsStandingsSlide onHome={onHome}/>;

  return (
    <div style={{position:"fixed",inset:0,background:`radial-gradient(ellipse at 20% 0%,#3d1c09 0%,#27251F 50%)`,fontFamily:"Georgia,serif",color:"#fff",display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{height:"0.4vw",background:`linear-gradient(90deg,${O},#c94510)`,flexShrink:0}}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0.7vw 1.4vw",borderBottom:"1px solid rgba(255,255,255,0.07)",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:"0.7vw"}}>
          <div style={{width:"0.7vw",height:"0.7vw",borderRadius:"50%",background:"#2ecc71",boxShadow:"0 0 10px #2ecc71",animation:"livePulse 1.8s ease-in-out infinite"}}/>
          <span style={{fontSize:"0.8vw",letterSpacing:"0.2em",color:"#2ecc71",fontFamily:"'Courier New',monospace",textTransform:"uppercase"}}>Live · SF Giants</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:"1vw"}}>
          <span style={{fontSize:"0.8vw",color:"rgba(255,255,255,0.25)",fontFamily:"'Courier New',monospace"}}>{refreshing?"Refreshing…":lastUpdate?`Updated ${lastUpdate.toLocaleTimeString()}`:""}</span>
          <button onClick={refresh} disabled={refreshing} style={{background:"transparent",border:`1px solid rgba(253,90,30,0.35)`,color:O,padding:"0.3vw 1vw",borderRadius:2,fontSize:"0.65vw",fontFamily:"'Courier New',monospace",cursor:"pointer",textTransform:"uppercase"}}>{refreshing?"…":"Refresh"}</button>
          <HomeBtn onClick={onHome}/>
        </div>
      </div>
      {/* Scrollable content */}
      <div style={{flex:1,minHeight:0,overflowY:"auto",padding:"1.4vw"}}>
        {/* Score */}
        <div style={{display:"flex",alignItems:"center",marginBottom:"1.4vw"}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:"0.65vw",letterSpacing:"0.15em",color:"rgba(255,255,255,0.4)",textTransform:"uppercase",fontFamily:"'Courier New',monospace",marginBottom:"0.3vw"}}>Away</div>
            <div style={{display:"flex",alignItems:"center",gap:"0.8vw",marginBottom:"0.5vw"}}>
              <TeamLogo src={`https://www.mlbstatic.com/team-logos/${game.awayTeamId}.svg`} size="2.5vw" fallbackText={awayAbbr}/>
              <div style={{fontSize:"1.2vw",fontWeight:700,color:"rgba(255,255,255,0.55)"}}>{game.awayTeamName}</div>
            </div>
            <div style={{fontSize:"7vw",fontWeight:900,lineHeight:1,color:"rgba(255,255,255,0.75)",letterSpacing:"-0.03em",fontVariantNumeric:"tabular-nums"}}>{awayScore}</div>
          </div>
          {/* Situation panel */}
          <div style={{width:"18vw",flexShrink:0,display:"flex",flexDirection:"column",alignItems:"center",gap:"0.7vw",padding:"0 1.4vw"}}>
            <div style={{display:"flex",alignItems:"center",gap:"0.4vw"}}>
              <span style={{fontSize:"1.05vw",color:"rgba(255,255,255,0.4)",fontFamily:"'Courier New',monospace"}}>{game.inningHalf==="top"?"▲":"▼"}</span>
              <span style={{fontSize:"1.05vw",fontWeight:700,color:"rgba(255,255,255,0.65)",fontFamily:"'Courier New',monospace"}}>{game.inning===1?"1st":game.inning===2?"2nd":game.inning===3?"3rd":`${game.inning}th`} Inning</span>
            </div>
            {game.atBat&&(
              <div style={{width:"100%",boxSizing:"border-box",background:"rgba(253,90,30,0.08)",border:"1px solid rgba(253,90,30,0.25)",borderRadius:3,padding:"0.8vw 1.2vw",textAlign:"center"}}>
                <div style={{fontSize:"0.65vw",letterSpacing:"0.18em",color:"rgba(255,255,255,0.3)",textTransform:"uppercase",fontFamily:"'Courier New',monospace",marginBottom:"0.3vw"}}>At Bat</div>
                <div style={{fontSize:"1.2vw",fontWeight:800,color:"#fff"}}>{game.atBat.name}</div>
                <div style={{display:"flex",justifyContent:"center",gap:"0.5vw",marginTop:"0.4vw"}}>
                  <span style={{fontSize:"0.65vw",color:O,fontFamily:"'Courier New',monospace",background:"rgba(253,90,30,0.15)",padding:"2px 7px",borderRadius:2}}>{game.atBat.position}</span>
                  <span style={{fontSize:"0.65vw",color:"rgba(255,255,255,0.35)",fontFamily:"'Courier New',monospace"}}>{game.atBat.h}-for-{game.atBat.ab}</span>
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
            {game.onBase&&<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"0.3vw"}}><div style={{fontSize:"0.65vw",letterSpacing:"0.16em",color:"rgba(255,255,255,0.3)",textTransform:"uppercase",fontFamily:"'Courier New',monospace"}}>Runners</div><Diamond onBase={game.onBase}/></div>}
          </div>
          <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",alignItems:"flex-end"}}>
            <div style={{fontSize:"0.65vw",letterSpacing:"0.15em",color:"rgba(255,255,255,0.4)",textTransform:"uppercase",fontFamily:"'Courier New',monospace",marginBottom:"0.3vw"}}>Home</div>
            <div style={{display:"flex",alignItems:"center",gap:"0.8vw",marginBottom:"0.5vw"}}>
              <div style={{fontSize:"1.2vw",fontWeight:700,color:O}}>{game.homeTeamName}</div>
              <TeamLogo src={`https://www.mlbstatic.com/team-logos/${game.homeTeamId}.svg`} size="2.5vw" fallbackText={homeAbbr}/>
            </div>
            <div style={{fontSize:"7vw",fontWeight:900,lineHeight:1,letterSpacing:"-0.03em",fontVariantNumeric:"tabular-nums",color:O,textShadow:homeScore>awayScore?`0 0 4vw rgba(253,90,30,0.5)`:"none"}}>{homeScore}</div>
          </div>
        </div>
        <div style={{height:1,background:"rgba(255,255,255,0.07)",marginBottom:"1.4vw"}}/>
        {/* Linescore */}
        <div style={{marginBottom:"1.4vw"}}>
          <div style={{fontSize:"0.65vw",letterSpacing:"0.2em",color:"rgba(255,255,255,0.3)",textTransform:"uppercase",fontFamily:"'Courier New',monospace",marginBottom:"0.5vw"}}>Linescore</div>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>
              <th style={{textAlign:"left",padding:"0.3vw 1vw 0.5vw 0.3vw",color:"rgba(255,255,255,0.4)",fontWeight:400,fontSize:"0.65vw",fontFamily:"'Courier New',monospace"}}>TEAM</th>
              {Object.keys(game.scoring_by_period||{}).map(i=><th key={i} style={{textAlign:"center",padding:"0.3vw 0.5vw",color:"rgba(255,255,255,0.4)",fontWeight:400,fontSize:"0.65vw",fontFamily:"'Courier New',monospace",width:"2vw"}}>{i}</th>)}
              <th style={{textAlign:"center",padding:"0.3vw 0.8vw",color:"rgba(255,255,255,0.4)",fontWeight:400,fontSize:"0.65vw",fontFamily:"'Courier New',monospace",borderLeft:"1px solid rgba(255,255,255,0.1)"}}>R</th>
              <th style={{textAlign:"center",padding:"0.3vw 0.8vw",color:"rgba(255,255,255,0.4)",fontWeight:400,fontSize:"0.65vw",fontFamily:"'Courier New',monospace"}}>H</th>
              <th style={{textAlign:"center",padding:"0.3vw 0.8vw",color:"rgba(255,255,255,0.4)",fontWeight:400,fontSize:"0.65vw",fontFamily:"'Courier New',monospace"}}>E</th>
            </tr></thead>
            <tbody>
              {[awayAbbr,homeAbbr].map((abbr,ti)=>(
                <tr key={abbr} style={{borderTop:"1px solid rgba(255,255,255,0.07)"}}>
                  <td style={{padding:"0.5vw 1vw 0.5vw 0.3vw",fontWeight:700,fontSize:"0.95vw",fontFamily:"'Courier New',monospace",color:ti===1?O:"rgba(255,255,255,0.55)"}}>{abbr}</td>
                  {Object.entries(game.scoring_by_period||{}).map(([inn,vals])=>{const val=vals[abbr],isX=val==="X";return <td key={inn} style={{textAlign:"center",padding:"0.5vw 0.5vw",fontFamily:"'Courier New',monospace",fontSize:"0.8vw",color:isX?"rgba(255,255,255,0.2)":val>0?"#fff":"rgba(255,255,255,0.4)",fontWeight:val>0?700:400}}>{isX?"—":val??"·"}</td>;})}
                  <td style={{textAlign:"center",padding:"0.5vw 0.8vw",fontWeight:800,fontSize:"1.1vw",color:"#fff",fontFamily:"'Courier New',monospace",borderLeft:"1px solid rgba(255,255,255,0.1)"}}>{game.rhe?.[abbr]?.runs??""}</td>
                  <td style={{textAlign:"center",padding:"0.5vw 0.8vw",color:"rgba(255,255,255,0.7)",fontFamily:"'Courier New',monospace",fontSize:"0.8vw"}}>{game.rhe?.[abbr]?.hits??""}</td>
                  <td style={{textAlign:"center",padding:"0.5vw 0.8vw",color:(game.rhe?.[abbr]?.errors??0)>0?"#e74c3c":"rgba(255,255,255,0.4)",fontFamily:"'Courier New',monospace",fontSize:"0.8vw"}}>{game.rhe?.[abbr]?.errors??""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{height:1,background:"rgba(255,255,255,0.07)",marginBottom:"1.4vw"}}/>
        {/* Batting + Pitching */}
        {(() => {
          // Giants might be home OR away — find the right abbr
          const sfAbbr = Object.keys(game.batters||{}).find(k=>["SF"].includes(k)) || homeAbbr;
          const oppAbbr = sfAbbr === homeAbbr ? awayAbbr : homeAbbr;
          const sfTeamName = sfAbbr === homeAbbr ? game.homeTeamName : game.awayTeamName;
          const oppTeamName = sfAbbr === homeAbbr ? game.awayTeamName : game.homeTeamName;
          return (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 1.4vw"}}>
          <div>
            <div style={{fontSize:"0.65vw",letterSpacing:"0.2em",color:O,opacity:0.7,textTransform:"uppercase",fontFamily:"'Courier New',monospace",marginBottom:"0.5vw"}}>Giants Batting</div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:"0.8vw",fontFamily:"'Courier New',monospace"}}>
              <thead><tr>{["Player","AB","H","HR","RBI","R"].map(h=><th key={h} style={{textAlign:h==="Player"?"left":"center",padding:"0.2vw 0.3vw 0.4vw",color:"rgba(255,255,255,0.3)",fontWeight:400,fontSize:"0.65vw"}}>{h}</th>)}</tr></thead>
              <tbody>
                {(game.batters?.[sfAbbr]||[]).map((p,i)=>{const isUp=game.atBat?.name===p.name;return(
                  <tr key={i} style={{borderTop:"1px solid rgba(255,255,255,0.05)",background:isUp?"rgba(253,90,30,0.08)":"transparent"}}>
                    <td style={{padding:"0.4vw 0.4vw 0.4vw 0",color:"#fff"}}>
                      {isUp&&<span style={{display:"inline-block",width:"0.5vw",height:"0.5vw",borderRadius:"50%",background:O,marginRight:"0.4vw",verticalAlign:"middle",boxShadow:`0 0 5px ${O}`}}/>}
                      <span style={{color:"rgba(255,255,255,0.4)",marginRight:"0.4vw",fontSize:"0.65vw"}}>{p.position}</span>{p.name}
                    </td>
                    {[p.ab,p.h,p.hr,p.rbi,p.r].map((v,j)=><td key={j} style={{textAlign:"center",padding:"0.4vw 0.3vw",color:j===2||j===3?(v||0)>0?O:"rgba(255,255,255,0.2)":(v||0)>0?"#fff":"rgba(255,255,255,0.3)",fontWeight:(v||0)>0&&j>0?700:400}}>{j>0?(v||"—"):v}</td>)}
                  </tr>
                );})}
              </tbody>
            </table>
          </div>
          <div style={{borderLeft:"1px solid rgba(255,255,255,0.07)",paddingLeft:"1.4vw"}}>
            <div style={{fontSize:"0.65vw",letterSpacing:"0.2em",color:O,opacity:0.7,textTransform:"uppercase",fontFamily:"'Courier New',monospace",marginBottom:"0.5vw"}}>Pitching</div>
            {[{label:sfTeamName,key:sfAbbr},{label:oppTeamName,key:oppAbbr}].map(({label,key})=>(
              <div key={key} style={{marginBottom:key===homeAbbr?"1vw":0}}>
                <div style={{fontSize:"0.65vw",color:"rgba(255,255,255,0.35)",textTransform:"uppercase",fontFamily:"'Courier New',monospace",marginBottom:"0.3vw",letterSpacing:"0.1em"}}>{label}</div>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:"0.8vw",fontFamily:"'Courier New',monospace"}}>
                  <thead><tr>{["Pitcher","IP","K","BB","ER"].map(h=><th key={h} style={{textAlign:h==="Pitcher"?"left":"center",padding:"0.2vw 0.3vw 0.3vw",color:"rgba(255,255,255,0.3)",fontWeight:400,fontSize:"0.65vw"}}>{h}</th>)}</tr></thead>
                  <tbody>
                    {(game.pitchers?.[key]||[]).map((p,i)=>(
                      <tr key={i} style={{borderTop:"1px solid rgba(255,255,255,0.05)"}}>
                        <td style={{padding:"0.35vw 0.4vw 0.35vw 0",color:key===homeAbbr?"#fff":"rgba(255,255,255,0.6)"}}>
                          {p.status==="active"&&<span style={{display:"inline-block",width:"0.5vw",height:"0.5vw",borderRadius:"50%",background:"#2ecc71",marginRight:"0.4vw",verticalAlign:"middle",boxShadow:"0 0 4px #2ecc71"}}/>}
                          {p.name}
                        </td>
                        {[p.ip,p.k,p.bb,p.er].map((v,j)=><td key={j} style={{textAlign:"center",padding:"0.35vw 0.3vw",color:j===3&&v>0?"#e74c3c":j===2&&v>3?"#e74c3c":"rgba(255,255,255,0.55)"}}>{v??0}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
          );
        })()}
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
      {screen==="valkyries"&&<ValkyriasStandingsSlide onHome={()=>setScreen("home")}/>}
      {screen==="warriors" &&<OffSeasonSlide teamKey="warriors"  onHome={()=>setScreen("home")}/>}
      {screen==="niners"   &&<OffSeasonSlide teamKey="niners"    onHome={()=>setScreen("home")}/>}
      {screen==="sharks"   &&<OffSeasonSlide teamKey="sharks"    onHome={()=>setScreen("home")}/>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App/></React.StrictMode>
)
