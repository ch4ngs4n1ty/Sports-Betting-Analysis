/* ============================================================
   PLAYIQ — SCREENS
   HomeScreen, GamesScreen, GameDetailScreen
   ============================================================ */

/* ── HOME SCREEN ──────────────────────────────────────── */
function HomeScreen({ onSelectSport }) {
  const sports = [
    { key: 'mlb',    label: 'MLB',   full: 'Major League Baseball',           active: true,  season: 'Spring 2026' },
    { key: 'nba',    label: 'NBA',   full: 'National Basketball Association',  active: true,  season: 'Season 2025-26' },
    { key: 'nhl',    label: 'NHL',   full: 'National Hockey League',           active: true,  season: 'Season 2025-26' },
    { key: 'ncaamb', label: 'NCAAB', full: 'College Basketball',               active: false, season: 'Off-season' },
  ];
  return (
    <div style={homeS.wrap}>
      <div style={homeS.hero}>
        <div style={homeS.eyebrow}>SELECT SPORT · DEEP GAME ANALYSIS</div>
        <h1 style={homeS.title}>PLAYIQ</h1>
        <p style={homeS.sub}>Statcast BvP · ESPN live data · Lineup intelligence · Weather signal · AI plays</p>
      </div>
      <div style={homeS.grid}>
        {sports.map(sp => (
          <HudCard key={sp.key} onClick={sp.active ? () => onSelectSport(sp.key) : undefined}
            accent={sp.active ? 'var(--cyan)' : 'var(--dim)'}
            style={{ padding: 24, opacity: sp.active ? 1 : 0.4, cursor: sp.active ? 'pointer' : 'not-allowed', minHeight: 180, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', color: sp.active ? 'var(--cyan)' : 'var(--dim)', letterSpacing: '0.2em', marginBottom: 12 }}>
                {sp.active ? '● LIVE DATA' : '○ COMING SOON'}
              </div>
              <div style={{ fontFamily: 'Orbitron, monospace', fontSize: sp.key==='mlb'?56:42, fontWeight: 900, color: sp.active ? 'var(--text)' : 'var(--dim)', lineHeight: 1, letterSpacing: '0.04em' }}>{sp.label}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', marginTop: 8 }}>{sp.full}</div>
            </div>
            {sp.active && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ fontSize: 10, color: 'var(--cyan)', fontFamily: 'Space Mono, monospace' }}>{sp.season}</span>
                <span style={{ fontSize: 9, color: 'var(--cyan)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.1em', padding: '3px 10px', border: '1px solid rgba(0,212,255,0.25)', borderRadius: 2 }}>VIEW GAMES →</span>
              </div>
            )}
          </HudCard>
        ))}
      </div>
      <div style={homeS.footer}>
        <span>ESPN LIVE · BASEBALL SAVANT STATCAST · MLB STATS API · CLAUDE AI</span>
        <span style={{ color: 'var(--green)' }}>● SYSTEM ONLINE</span>
      </div>
    </div>
  );
}
const homeS = {
  wrap: { maxWidth: 1100, margin: '0 auto', padding: '40px 24px' },
  hero: { marginBottom: 40, borderLeft: '2px solid rgba(0,212,255,0.25)', paddingLeft: 24 },
  eyebrow: { fontSize: 9, fontFamily: 'Space Mono, monospace', color: 'var(--cyan)', letterSpacing: '0.25em', marginBottom: 12 },
  title: { fontFamily: 'Orbitron, monospace', fontSize: 'clamp(40px,7vw,80px)', fontWeight: 900, color: 'var(--text)', lineHeight: 1, margin: '0 0 14px', letterSpacing: '0.08em', textShadow: '0 0 40px rgba(0,212,255,0.2)' },
  sub: { fontSize: 11, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.08em' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 32 },
  footer: { display: 'flex', justifyContent: 'space-between', fontSize: 9, fontFamily: 'Space Mono, monospace', color: 'var(--dim)', letterSpacing: '0.1em', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: 16 },
};

/* ── GAMES SCREEN ─────────────────────────────────────── */
function GamesScreen({ onSelectGame, onBack }) {
  const [games, setGames] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [date, setDate] = React.useState(new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }));
  const [filter, setFilter] = React.useState('all');

  React.useEffect(() => {
    setLoading(true);
    fetchAllGames(date).then(g => { setGames(g); setLoading(false); });
  }, [date]);

  const sports = ['all', ...new Set(games.map(g => g.sportKey))];
  const displayed = filter === 'all' ? games : games.filter(g => g.sportKey === filter);
  const bySport = {};
  displayed.forEach(g => { (bySport[g.sportKey] = bySport[g.sportKey] || []).push(g); });

  const formatTime = iso => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <button onClick={onBack} style={backBtnStyle}>← SPORTS</button>
        <div style={{ flex: 1, fontSize: 9, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', letterSpacing: '0.2em' }}>TODAY'S GAMES</div>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          style={{ background: 'var(--card)', border: '1px solid rgba(0,212,255,0.2)', color: 'var(--cyan)', fontFamily: 'Space Mono, monospace', fontSize: 11, padding: '6px 10px', borderRadius: 2, outline: 'none' }} />
      </div>

      {/* Sport filter tabs */}
      {!loading && sports.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 20, overflowX: 'auto', paddingBottom: 4 }}>
          {sports.map(s => (
            <button key={s} onClick={() => setFilter(s)}
              style={{ padding: '6px 14px', background: filter===s?'rgba(0,212,255,0.1)':'transparent',
                border: `1px solid ${filter===s?'rgba(0,212,255,0.3)':'rgba(255,255,255,0.06)'}`,
                color: filter===s?'var(--cyan)':'var(--muted)', fontFamily: 'Space Mono, monospace',
                fontSize: 10, cursor: 'pointer', borderRadius: 2, whiteSpace: 'nowrap', letterSpacing: '0.08em' }}>
              {s === 'all' ? 'ALL SPORTS' : s.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      {loading ? <Loader text="FETCHING SCHEDULE" /> : (
        Object.keys(bySport).length === 0
          ? <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'Space Mono, monospace', color: 'var(--dim)', fontSize: 11 }}>NO GAMES FOUND FOR {date}</div>
          : Object.entries(bySport).map(([sportKey, sportGames]) => (
            <div key={sportKey} style={{ marginBottom: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 11, fontWeight: 700, color: 'var(--cyan)', letterSpacing: '0.15em' }}>{sportKey.toUpperCase()}</span>
                <div style={{ flex: 1, height: 1, background: 'rgba(0,212,255,0.1)' }} />
                <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace' }}>{sportGames.length} GAMES</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 10 }}>
                {sportGames.map((g, i) => {
                  const isLive = g.statusState === 'in';
                  const isFinal = g.statusState === 'post';
                  const showScore = isLive || isFinal;
                  return (
                    <HudCard key={i} onClick={() => onSelectGame(g)} accent={isLive ? 'var(--green)' : 'var(--cyan)'}
                      style={{ padding: '14px 16px', cursor: 'pointer' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <StatusBadge status={isFinal ? 'Final' : isLive ? 'In Progress' : 'Scheduled'} />
                        <span style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', color: 'var(--muted)' }}>
                          {isFinal ? 'FINAL' : isLive ? g.statusDetail : formatTime(g.date)}
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <img src={g.awayLogo} alt={g.awayAbbr} style={{ width: 28, height: 28, objectFit: 'contain' }} onError={e=>e.target.style.display='none'} />
                          <div>
                            <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{g.awayAbbr}</div>
                            {showScore && <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 22, fontWeight: 900, color: g.awayScore > g.homeScore ? 'var(--green)' : 'var(--text)', lineHeight: 1 }}>{g.awayScore}</div>}
                          </div>
                        </div>
                        <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 13, color: 'var(--dim)', fontWeight: 700, textAlign: 'center' }}>
                          {showScore ? '—' : 'VS'}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', flexDirection: 'row-reverse' }}>
                          <img src={g.homeLogo} alt={g.homeAbbr} style={{ width: 28, height: 28, objectFit: 'contain' }} onError={e=>e.target.style.display='none'} />
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{g.homeAbbr}</div>
                            {showScore && <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 22, fontWeight: 900, color: g.homeScore > g.awayScore ? 'var(--green)' : 'var(--text)', lineHeight: 1 }}>{g.homeScore}</div>}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {g.spread && <span style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', padding: '2px 6px', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 2 }}>{g.spread}</span>}
                          {g.overUnder && <span style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', padding: '2px 6px', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 2 }}>O/U {g.overUnder}</span>}
                        </div>
                        <span style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', color: 'var(--cyan)', letterSpacing: '0.1em' }}>ANALYZE →</span>
                      </div>
                    </HudCard>
                  );
                })}
              </div>
            </div>
          ))
      )}
    </div>
  );
}

/* ── GAME DETAIL SCREEN ───────────────────────────────── */
const TABS_MLB = [
  { id: 'overview',  label: 'OVERVIEW'   },
  { id: 'h2h',       label: 'HEAD-TO-HEAD' },
  { id: 'form',      label: 'LAST 5'     },
  { id: 'roster',    label: 'ROSTERS'    },
  { id: 'edges',     label: 'EDGE FINDER' },
  { id: 'pitching',  label: 'PITCHING'   },
  { id: 'ai',        label: '◆ AI PLAYS' },
];
const TABS_NBA = [
  { id: 'overview',  label: 'OVERVIEW'   },
  { id: 'h2h',       label: 'HEAD-TO-HEAD' },
  { id: 'form',      label: 'LAST 5'     },
  { id: 'roster',    label: 'ROSTERS'    },
  { id: 'edges',     label: 'EDGE FINDER' },
  { id: 'ai',        label: '◆ AI PLAYS' },
];
const TABS_OTHER = [
  { id: 'overview', label: 'OVERVIEW'   },
  { id: 'h2h',      label: 'HEAD-TO-HEAD' },
  { id: 'form',     label: 'LAST 5'     },
  { id: 'roster',   label: 'ROSTERS'    },
  { id: 'ai',       label: '◆ AI PLAYS' },
];

function GameDetailScreen({ game, onBack }) {
  const [tab, setTab] = React.useState(() => sessionStorage.getItem('piq_tab') || 'overview');
  const [gameData, setGameData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [stepIdx, setStepIdx] = React.useState(0);
  const tabs = game.sportKey === 'mlb' ? TABS_MLB : game.sportKey === 'nba' ? TABS_NBA : TABS_OTHER;

  React.useEffect(() => { sessionStorage.setItem('piq_tab', tab); }, [tab]);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true); setStepIdx(0);
      try {
        setStepIdx(1);
        const [awayFormRaw, homeFormRaw, injuries, awayRoster, homeRoster] = await Promise.all([
          fetchTeamForm(game.sportKey, game.awayTeamId),
          fetchTeamForm(game.sportKey, game.homeTeamId),
          fetchInjuries(game),
          fetchRoster(game.sportKey, game.awayTeamId),
          fetchRoster(game.sportKey, game.homeTeamId),
        ]);
        setStepIdx(2);
        const [awayForm, homeForm] = await Promise.all([
          enrichFormWithPlayerStats(game.sportKey, game.awayTeamId, awayFormRaw),
          enrichFormWithPlayerStats(game.sportKey, game.homeTeamId, homeFormRaw),
        ]);
        setStepIdx(3);
        const h2h = await fetchH2H(game);
        setStepIdx(4);

        let mlbEdgeData = null, pitchingData = null, nbaEdgeData = null;
        if (game.sportKey === 'mlb') {
          const starterData = await fetchMlbStarters(game);
          const bvpData = await fetchGameBvp(game, starterData.lineups, starterData.pitchers);
          mlbEdgeData = await buildMlbEdgeData(game, bvpData);
          pitchingData = { pitchers: starterData.pitchers };
        } else if (game.sportKey === 'nba') {
          nbaEdgeData = await buildNbaEdgeData(game);
        }
        setStepIdx(5);

        if (!cancelled) setGameData({ gameInfo: game, awayForm, homeForm, injuries, awayRoster, homeRoster, h2h, mlbEdgeData, pitchingData, nbaEdgeData });
      } catch (e) { console.error(e); }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [game.eventId]);

  const edgeLabel = game.sportKey === 'mlb' ? 'BvP ANALYSIS' : game.sportKey === 'nba' ? 'EDGE FINDER' : 'EXTRAS';
  const steps = ['LOADING GAME', 'TEAM STATS', 'FORM + PLAYERS', 'HEAD-TO-HEAD', edgeLabel, 'COMPLETE'];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px 40px' }}>
      {/* Game header */}
      <div style={{ padding: '20px 0 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <button onClick={onBack} style={backBtnStyle}>← GAMES</button>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
              <img src={game.awayLogo} alt={game.awayAbbr} style={{ width: 32, height: 32, objectFit:'contain' }} onError={e=>e.target.style.display='none'} />
              <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 'clamp(16px,2.5vw,26px)', fontWeight: 700, color: 'var(--text)', letterSpacing: '0.04em' }}>{game.awayAbbr}</span>
              <span style={{ fontFamily: 'Space Mono, monospace', fontSize: 14, color: 'var(--dim)' }}>@</span>
              <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 'clamp(16px,2.5vw,26px)', fontWeight: 700, color: 'var(--text)', letterSpacing: '0.04em' }}>{game.homeAbbr}</span>
              <img src={game.homeLogo} alt={game.homeAbbr} style={{ width: 32, height: 32, objectFit:'contain' }} onError={e=>e.target.style.display='none'} />
              <StatusBadge status={game.statusState==='in'?'In Progress':game.statusState==='post'?'Final':'Scheduled'} />
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace' }}>{game.awayFull} · {game.homeFull}{game.venue ? ` · ${game.venue}` : ''}</div>
          </div>
          <OddsStrip game={game} />
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '40px 0' }}>
          <Loader text={steps[stepIdx] || 'LOADING'} />
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            {steps.map((s, i) => (
              <div key={i} style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', letterSpacing: '0.1em', padding: '3px 10px', borderRadius: 2,
                background: i < stepIdx ? 'rgba(0,255,136,0.1)' : i === stepIdx ? 'rgba(0,212,255,0.1)' : 'transparent',
                border: `1px solid ${i < stepIdx ? 'rgba(0,255,136,0.25)' : i === stepIdx ? 'rgba(0,212,255,0.3)' : 'rgba(255,255,255,0.06)'}`,
                color: i < stepIdx ? 'var(--green)' : i === stepIdx ? 'var(--cyan)' : 'var(--dim)' }}>
                {i < stepIdx ? '✓' : i === stepIdx ? '●' : '○'} {s}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 0, overflowX: 'auto', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 0 }}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ padding: '14px 18px', background: 'transparent', border: 'none', borderBottom: `2px solid ${tab===t.id?'var(--cyan)':'transparent'}`,
                  color: tab===t.id?'var(--cyan)':'var(--muted)', fontFamily: 'Space Mono, monospace',
                  fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap', letterSpacing: '0.1em',
                  transition: 'all 0.2s', marginBottom: -1 }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ minHeight: 400 }}>
            {tab === 'overview'  && <OverviewTab gameData={gameData} />}
            {tab === 'h2h'       && <H2HTab gameData={gameData} />}
            {tab === 'form'      && <FormTab gameData={gameData} />}
            {tab === 'roster'    && <RosterTab gameData={gameData} />}
            {tab === 'edges'     && (game.sportKey === 'nba' ? <NbaEdgeFinderTab gameData={gameData} /> : <EdgeFinderTab gameData={gameData} />)}
            {tab === 'pitching'  && <PitchingEdgeTab gameData={gameData} />}
            {tab === 'ai'        && <AIPlaysTab gameData={gameData} />}
          </div>
        </>
      )}
    </div>
  );
}

const backBtnStyle = {
  background: 'transparent', border: '1px solid rgba(0,212,255,0.2)', color: 'var(--cyan)',
  fontFamily: 'Space Mono, monospace', fontSize: 10, letterSpacing: '0.12em',
  padding: '7px 14px', cursor: 'pointer', borderRadius: 2, flexShrink: 0,
};

Object.assign(window, { HomeScreen, GamesScreen, GameDetailScreen });
