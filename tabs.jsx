/* ============================================================
   PLAYIQ — TABS
   All game-detail tab implementations
   ============================================================ */

/* ── OVERVIEW TAB ─────────────────────────────────────── */
function OverviewTab({ gameData }) {
  const { gameInfo, awayForm, homeForm, injuries } = gameData;
  const awayW = awayForm.filter(g => g.result==='W').length;
  const homeW = homeForm.filter(g => g.result==='W').length;
  const getStreak = form => {
    if (!form.length) return '—';
    const last = form[form.length-1].result; let c = 0;
    for (let i = form.length-1; i >= 0; i--) { if (form[i].result===last) c++; else break; }
    return `${c}${last}`;
  };
  const avgScore = form => form.length ? (form.reduce((s,g)=>s+g.myScore,0)/form.length).toFixed(1) : '—';
  const avgAllowed = form => form.length ? (form.reduce((s,g)=>s+g.oppScore,0)/form.length).toFixed(1) : '—';

  const TeamSide = ({ team, abbr, logo, form, wins, color }) => (
    <div style={{ flex: 1, minWidth: 200 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        {logo && <img src={logo} alt={abbr} style={{ width: 48, height: 48, objectFit: 'contain', filter: 'drop-shadow(0 0 8px rgba(0,0,0,0.5))' }} onError={e=>e.target.style.display='none'} />}
        <div>
          <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 22, fontWeight: 700, color, letterSpacing: '0.04em' }}>{abbr}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace' }}>{team}</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        {[['LAST '+form.length, `${wins}-${form.length-wins}`], ['STREAK', getStreak(form)],
          ['AVG PF', avgScore(form)], ['AVG PA', avgAllowed(form)]].map(([l,v])=>(
          <div key={l} style={{ padding: '10px 12px', background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: 3 }}>
            <div style={{ fontSize: 8, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.14em', marginBottom: 3 }}>{l}</div>
            <div style={{ fontSize: 18, fontFamily: 'Orbitron, monospace', color, fontWeight: 700 }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.14em', marginBottom: 8 }}>FORM</div>
        <FormDots form={form} />
      </div>
    </div>
  );

  const injBlock = (side, abbr) => {
    const list = (injuries?.[side] || []).filter(i => /out|doubtful|questionable/i.test(i.status));
    if (!list.length) return null;
    return (
      <div style={{ marginTop: 16, padding: '12px 14px', background: 'rgba(255,107,53,0.06)', border: '1px solid rgba(255,107,53,0.15)', borderRadius: 3 }}>
        <div style={{ fontSize: 9, color: '#ff6b35', fontFamily: 'Space Mono, monospace', letterSpacing: '0.14em', marginBottom: 8 }}>INJURY REPORT · {abbr}</div>
        {list.slice(0,4).map((inj,i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
              background: /out/i.test(inj.status) ? '#ff6b35' : '#ffd060',
              boxShadow: `0 0 4px ${/out/i.test(inj.status)?'#ff6b35':'#ffd060'}` }} />
            <span style={{ fontSize: 11, fontFamily: 'Space Mono, monospace', color: 'var(--text)' }}>{inj.name}</span>
            <span style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'Space Mono, monospace' }}>{inj.pos}</span>
            <span style={{ fontSize: 9, color: /out/i.test(inj.status)?'#ff6b35':'#ffd060', fontFamily: 'Space Mono, monospace', marginLeft: 'auto' }}>{inj.status}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ padding: '20px 0' }}>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 24, padding: '20px', background: 'var(--card)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: 4 }}>
        <TeamSide team={gameInfo.awayFull} abbr={gameInfo.awayAbbr} logo={gameInfo.awayLogo} form={awayForm} wins={awayW} color="var(--cyan)" />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '0 16px' }}>
          <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 20, color: 'var(--dim)', fontWeight: 700 }}>VS</div>
          <OddsStrip game={gameInfo} />
        </div>
        <TeamSide team={gameInfo.homeFull} abbr={gameInfo.homeAbbr} logo={gameInfo.homeLogo} form={homeForm} wins={homeW} color="#ffd060" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {injBlock('away', gameInfo.awayAbbr)}
        {injBlock('home', gameInfo.homeAbbr)}
      </div>
    </div>
  );
}

/* ── H2H TAB ──────────────────────────────────────────── */
function H2HTab({ gameData }) {
  const { gameInfo, h2h } = gameData;
  const games = h2h?.games || [];
  if (!games.length) return <div style={emptyMsg}>No head-to-head data found for the last 3 seasons.</div>;
  const awayWins = games.filter(g => g.winner==='away' && g.awayAbbr===gameInfo.awayAbbr || g.winner==='home' && g.homeAbbr===gameInfo.awayAbbr).length;
  const catLabels = gameInfo.sportKey === 'mlb'
    ? [{ key:'hits', label:'H' }, { key:'rbi', label:'RBI' }, { key:'runs', label:'R' }]
    : [{ key:'pts', label:'PTS' }, { key:'reb', label:'REB' }, { key:'ast', label:'AST' }];

  return (
    <div style={{ padding: '20px 0' }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        {[
          [gameInfo.awayAbbr, awayWins, 'var(--cyan)'],
          [gameInfo.homeAbbr, games.length - awayWins, '#ffd060'],
        ].map(([abbr, wins, color]) => (
          <HudCard key={abbr} style={{ flex: 1, padding: '14px 18px', textAlign: 'center' }} accent={color}>
            <div style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.16em', marginBottom: 6 }}>{abbr} WINS</div>
            <div style={{ fontSize: 40, fontFamily: 'Orbitron, monospace', color, fontWeight: 900 }}>{wins}</div>
            <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'Space Mono, monospace' }}>last {games.length}</div>
          </HudCard>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {games.map((g, i) => {
          const awayWon = (g.awayAbbr === gameInfo.awayAbbr && g.winner === 'away') || (g.homeAbbr === gameInfo.awayAbbr && g.winner === 'home');
          const winnerScore = awayWon ? (g.awayAbbr === gameInfo.awayAbbr ? g.awayScore : g.homeScore) : (g.awayAbbr === gameInfo.homeAbbr ? g.awayScore : g.homeScore);
          const loserScore = awayWon ? (g.awayAbbr === gameInfo.homeAbbr ? g.awayScore : g.homeScore) : (g.awayAbbr === gameInfo.awayAbbr ? g.awayScore : g.homeScore);
          return (
            <HudCard key={i} style={{ padding: '14px 16px' }} accent={awayWon ? 'var(--cyan)' : '#ffd060'}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', width: 80, flexShrink: 0 }}>{g.date}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                  <span style={{ fontFamily: 'Space Mono, monospace', fontSize: 12, color: g.awayAbbr===gameInfo.awayAbbr?'var(--cyan)':'#ffd060', fontWeight: 700 }}>{g.awayAbbr}</span>
                  <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 18, fontWeight: 900,
                    color: g.awayScore > g.homeScore ? '#00ff88' : 'var(--text)' }}>{g.awayScore}</span>
                  <span style={{ color: 'var(--dim)', fontFamily: 'Space Mono, monospace', fontSize: 11 }}>—</span>
                  <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 18, fontWeight: 900,
                    color: g.homeScore > g.awayScore ? '#00ff88' : 'var(--text)' }}>{g.homeScore}</span>
                  <span style={{ fontFamily: 'Space Mono, monospace', fontSize: 12, color: g.homeAbbr===gameInfo.homeAbbr?'#ffd060':'var(--cyan)', fontWeight: 700 }}>{g.homeAbbr}</span>
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {catLabels.map(cat => {
                    const awayLdr = g.awayLeaders?.[cat.key];
                    const homeLdr = g.homeLeaders?.[cat.key];
                    if (!awayLdr && !homeLdr) return null;
                    return (
                      <div key={cat.key} style={{ display: 'flex', gap: 8, fontSize: 9, fontFamily: 'Space Mono, monospace' }}>
                        <span style={{ color: 'var(--cyan)' }}>{awayLdr ? `${awayLdr.name} ${awayLdr.value}${cat.label}` : '—'}</span>
                        <span style={{ color: 'var(--dim)' }}>vs</span>
                        <span style={{ color: '#ffd060' }}>{homeLdr ? `${homeLdr.name} ${homeLdr.value}${cat.label}` : '—'}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </HudCard>
          );
        })}
      </div>
    </div>
  );
}

/* ── ROSTER TAB ───────────────────────────────────────── */
function RosterTab({ gameData }) {
  const { gameInfo, awayRoster, homeRoster } = gameData;
  const [side, setSide] = React.useState('away');
  const roster = side === 'away' ? awayRoster : homeRoster;
  const statusColor = s => {
    if (!s || /^active$/i.test(s)) return '#00ff88';
    if (/out/i.test(s)) return '#ff6b35';
    if (/doubtful/i.test(s)) return '#ff6b35';
    if (/questionable/i.test(s)) return '#ffd060';
    if (/day.to.day/i.test(s)) return '#ffd060';
    return 'var(--muted)';
  };
  return (
    <div style={{ padding: '20px 0' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[['away', gameInfo.awayFull, gameInfo.awayAbbr], ['home', gameInfo.homeFull, gameInfo.homeAbbr]].map(([s, full, abbr]) => (
          <button key={s} onClick={() => setSide(s)}
            style={{ flex: 1, padding: '10px 16px', background: side===s ? 'rgba(0,212,255,0.08)' : 'transparent',
              border: `1px solid ${side===s ? 'rgba(0,212,255,0.3)' : 'rgba(255,255,255,0.06)'}`,
              color: side===s ? 'var(--cyan)' : 'var(--muted)', fontFamily: 'Space Mono, monospace',
              fontSize: 11, cursor: 'pointer', borderRadius: 2, letterSpacing: '0.08em', transition: 'all 0.2s' }}>
            {abbr} · {full}
          </button>
        ))}
      </div>
      {!roster?.length ? <div style={emptyMsg}>Roster not available.</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
          {roster.map(p => (
            <HudCard key={p.id} style={{ padding: '14px 12px', textAlign: 'center' }}
              accent={statusColor(p.status)}>
              <PlayerCard player={{ ...p, headshot: p.headshot }} accent={statusColor(p.status)} size="md" />
              <div style={{ marginTop: 10, fontSize: 9, fontFamily: 'Space Mono, monospace',
                color: statusColor(p.status), letterSpacing: '0.1em' }}>
                {/^active$/i.test(p.status) ? '● ACTIVE' : p.status?.toUpperCase() || 'ACTIVE'}
              </div>
            </HudCard>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── FORM TAB ─────────────────────────────────────────── */
function FormTab({ gameData }) {
  const { gameInfo, awayForm, homeForm } = gameData;
  const [side, setSide] = React.useState('away');
  const form = side === 'away' ? awayForm : homeForm;
  const abbr = side === 'away' ? gameInfo.awayAbbr : gameInfo.homeAbbr;
  const cats = form.find(g => g.cats)?.cats || (gameInfo.sportKey === 'mlb'
    ? [{ key:'hits',label:'H'},{ key:'rbi',label:'RBI'},{ key:'runs',label:'R'}]
    : [{ key:'pts',label:'PTS'},{ key:'reb',label:'REB'},{ key:'ast',label:'AST'}]);
  const [statKey, setStatKey] = React.useState(cats[0]?.key || 'pts');

  return (
    <div style={{ padding: '20px 0' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[['away', gameInfo.awayAbbr], ['home', gameInfo.homeAbbr]].map(([s, a]) => (
          <button key={s} onClick={() => setSide(s)}
            style={{ padding: '8px 16px', background: side===s ? 'rgba(0,212,255,0.08)' : 'transparent',
              border: `1px solid ${side===s ? 'rgba(0,212,255,0.3)' : 'rgba(255,255,255,0.06)'}`,
              color: side===s ? 'var(--cyan)' : 'var(--muted)', fontFamily: 'Space Mono, monospace',
              fontSize: 10, cursor: 'pointer', borderRadius: 2, transition: 'all 0.2s' }}>
            {a}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {cats.map(c => (
            <button key={c.key} onClick={() => setStatKey(c.key)}
              style={{ padding: '6px 12px', background: statKey===c.key ? 'rgba(0,212,255,0.1)' : 'transparent',
                border: `1px solid ${statKey===c.key ? 'rgba(0,212,255,0.3)' : 'rgba(255,255,255,0.06)'}`,
                color: statKey===c.key ? 'var(--cyan)' : 'var(--dim)', fontFamily: 'Space Mono, monospace',
                fontSize: 10, cursor: 'pointer', borderRadius: 2 }}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${form.length}, 1fr)`, gap: 8 }}>
        {form.map((g, i) => {
          const leader = g.player?.[statKey];
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              {/* Player card above bar */}
              <HudCard style={{ width: '100%', padding: '10px 8px', textAlign: 'center' }}
                accent={g.result==='W' ? '#00ff88' : '#ff6b35'}>
                {leader ? (
                  <>
                    <PlayerCard player={{ name: leader.name, headshot: leader.headshot }} size="sm" accent={g.result==='W' ? '#00ff88' : '#ff6b35'} />
                    <div style={{ fontSize: 18, fontFamily: 'Orbitron, monospace', fontWeight: 700,
                      color: g.result==='W' ? '#00ff88' : '#ff6b35', marginTop: 6 }}>{leader.value}</div>
                    <div style={{ fontSize: 8, color: 'var(--dim)', fontFamily: 'Space Mono, monospace' }}>{statKey.toUpperCase()}</div>
                  </>
                ) : <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace' }}>—</div>}
              </HudCard>
              {/* Game result */}
              <div style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', textAlign: 'center', color: 'var(--muted)' }}>
                <div style={{ color: g.result==='W'?'#00ff88':'#ff6b35', fontWeight: 700, marginBottom: 2 }}>{g.result} {g.myScore}-{g.oppScore}</div>
                <div>{g.home ? 'vs' : '@'} {g.opponent}</div>
                <div style={{ color: 'var(--dim)', marginTop: 2 }}>{g.date}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── EDGE FINDER TAB (MLB) ────────────────────────────── */
// Stat sets for game-log charts
const L5_STATS  = [
  { key: 'hits', label: 'H'   },
  { key: 'hr',   label: 'HR'  },
  { key: 'r',    label: 'R'   },
  { key: 'rbi',  label: 'RBI' },
  { key: 'k',    label: 'K'   },
  { key: 'bb',   label: 'BB'  },
];
const BVP_STATS = [
  { key: 'h',    label: 'H'   },
  { key: 'hr',   label: 'HR'  },
  // Backend BvP gameByGame tracks h/hr/k/bb/pa/ab (not r/rbi — those depend on teammates)
  { key: 'k',    label: 'K'   },
  { key: 'bb',   label: 'BB'  },
];

// Shape BvP gameByGame entries for GameLogChart
function shapeBvpForChart(gameByGame, pitcherName) {
  if (!gameByGame?.length) return [];
  // Newest first. The backend stores weather on each entry already.
  return [...gameByGame].map(g => ({
    date: g.date ? new Date(g.date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '',
    rawDate: g.date,
    opp: pitcherName ? pitcherName.split(' ').slice(-1)[0] : 'SP',
    home: false,
    gamePk: g.gamePk,
    hits: Number(g.h ?? 0), h: Number(g.h ?? 0),
    hr: Number(g.hr ?? 0),
    k:  Number(g.k  ?? 0),
    bb: Number(g.bb ?? 0),
    ab: Number(g.ab ?? 0),
    pa: Number(g.pa ?? 0),
    weather: g.weather || null,
  }));
}

function EdgeFinderTab({ gameData }) {
  const { gameInfo, mlbEdgeData } = gameData;
  const [filter, setFilter] = React.useState('all');

  if (!mlbEdgeData) return <div style={emptyMsg}>Edge data loading or unavailable.</div>;

  const { batters, bvpStatus } = mlbEdgeData;
  const displayed = filter === 'edges' ? batters.filter(b => b.edgeStats && b.bvp?.ops >= 0.700) : batters;

  const BatterEdgeCard = ({ b }) => {
    const [open, setOpen] = React.useState(false);
    const bvp = b.bvp;
    const hasBvp = bvp && bvp.pa > 0;
    const opsColor = hasBvp
      ? (bvp.ops >= 0.900 ? 'var(--green)' : bvp.ops >= 0.700 ? 'var(--gold)' : bvp.ops >= 0.500 ? 'var(--cyan)' : 'var(--orange)')
      : 'var(--dim)';

    const bvpGames = hasBvp ? shapeBvpForChart(bvp.gameByGame, b.pitcher) : [];

    return (
      <HudCard style={{ padding: '18px 20px' }} accent={opsColor}>
        {/* Header — clickable, toggles the drilldown */}
        <div onClick={() => setOpen(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', cursor: 'pointer', userSelect: 'none' }}>
          <PlayerCard player={{ name: b.name, headshot: b.headshotUrl, pos: b.position }} size="md" accent={b.teamColor} />
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700 }}>{b.name}</span>
              <span style={{ fontSize: 9, padding: '2px 7px', border: `1px solid ${b.teamColor}66`, color: b.teamColor, fontFamily: 'Space Mono, monospace', borderRadius: 2, letterSpacing: '0.08em' }}>{b.teamAbbr}</span>
              <span style={{ fontSize: 9, padding: '2px 7px', border: `1px solid ${b.teamColor}44`, color: b.teamColor, fontFamily: 'Space Mono, monospace', borderRadius: 2 }}>{b.position}</span>
              {b.order && <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace' }}>#{b.order}</span>}
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.05em' }}>vs {b.pitcher || 'TBD'}</div>
          </div>
          {hasBvp && (
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <OpsGauge ops={bvp.ops} size={64} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, auto)', columnGap: 14, rowGap: 3 }}>
                {[['PA', bvp.pa], ['H', bvp.hits], ['HR', bvp.hr], ['BB', bvp.bb]].map(([l, v]) => (
                  <React.Fragment key={l}>
                    <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.14em' }}>{l}</span>
                    <span style={{ fontSize: 13, fontFamily: 'Orbitron, monospace', fontWeight: 700,
                      color: l === 'HR' && v > 0 ? 'var(--orange)' : 'var(--text)' }}>{v}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
          {/* Expand chevron */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 10, borderLeft: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.15em' }}>
              {open ? 'HIDE' : 'EXPAND'}
            </span>
            <span style={{ fontSize: 14, color: opsColor, fontFamily: 'Orbitron, monospace', transition: 'transform 0.2s',
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
          </div>
        </div>

        {/* Drilldown — only rendered when expanded */}
        {open && (
          <div style={{ marginTop: 18, animation: 'fadeUp 0.25s ease' }}>
            {/* LAST 5 SEASON GAMES */}
            <div style={{ paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', color: b.teamColor, letterSpacing: '0.22em', marginBottom: 10 }}>
                LAST 5 GAMES (SEASON)
              </div>
              <GameLogChart
                games={b.gameLog || []}
                stats={L5_STATS}
                defaultStat="hits"
                emptyLabel="NO RECENT SEASON GAMES"
                accent={b.teamColor}
              />
            </div>

            {/* BvP HISTORICAL GAMES */}
            <div style={{ paddingTop: 18, marginTop: 18, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', color: opsColor, letterSpacing: '0.22em' }}>
                  GAMES VS {b.pitcher?.toUpperCase() || 'PITCHER'} (SAVANT)
                </span>
                {hasBvp && (
                  <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace' }}>
                    {bvp.gamesPlayed}G · LAST: {bvp.lastFaced || '—'}
                  </span>
                )}
              </div>
              {hasBvp ? (
                <GameLogChart
                  games={bvpGames}
                  stats={BVP_STATS}
                  defaultStat="h"
                  emptyLabel="NO BvP HISTORY"
                  accent={opsColor}
                />
              ) : (
                <div style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', padding: '16px 0', letterSpacing: '0.1em' }}>
                  NO BvP HISTORY
                </div>
              )}
            </div>
          </div>
        )}
      </HudCard>
    );
  };

  return (
    <div style={{ padding: '20px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <SectionHeader label="MLB EDGE FINDER" sub="L5 Season (H/HR/R/RBI/K/BB) · BvP Statcast (H/HR/K/BB) · Weather" />
        </div>
        {bvpStatus && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 9, fontFamily: 'Space Mono, monospace',
              color: bvpStatus.lineupStatus==='confirmed' ? 'var(--green)' : 'var(--gold)', letterSpacing: '0.1em' }}>
              LINEUP: {(bvpStatus.lineupStatus||'—').toUpperCase()}
            </span>
            {[['all','ALL'],['edges','EDGES ONLY']].map(([v,l]) => (
              <button key={v} onClick={() => setFilter(v)}
                style={{ padding: '4px 10px', background: filter===v?'rgba(0,212,255,0.1)':'transparent',
                  border: `1px solid ${filter===v?'rgba(0,212,255,0.3)':'rgba(255,255,255,0.06)'}`,
                  color: filter===v?'var(--cyan)':'var(--dim)', fontFamily: 'Space Mono, monospace',
                  fontSize: 9, cursor: 'pointer', borderRadius: 2 }}>{l}</button>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {displayed.map((b, i) => <BatterEdgeCard key={b.id || i} b={b} />)}
      </div>
    </div>
  );
}

/* ── NBA EDGE FINDER TAB ──────────────────────────────── */
const NBA_STATS = [
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
];

// Performance tiers: orange (low) · cyan (mid) · gold (strong) · green (elite).
const nbaStatColorFor = (v, sk) => {
  if (sk === 'pts') return v >= 30 ? 'var(--green)' : v >= 20 ? 'var(--gold)' : v >= 10 ? 'var(--cyan)' : 'var(--orange)';
  if (sk === 'reb') return v >= 12 ? 'var(--green)' : v >= 8  ? 'var(--gold)' : v >= 4  ? 'var(--cyan)' : 'var(--dim)';
  if (sk === 'ast') return v >= 10 ? 'var(--green)' : v >= 6  ? 'var(--gold)' : v >= 3  ? 'var(--cyan)' : 'var(--dim)';
  return 'var(--muted)';
};

function NbaEdgeFinderTab({ gameData }) {
  const { gameInfo, nbaEdgeData } = gameData;
  const [filter, setFilter] = React.useState('all'); // 'all' | 'away' | 'home'

  if (!nbaEdgeData) return <div style={emptyMsg}>NBA edge data loading or unavailable.</div>;
  const { players } = nbaEdgeData;
  if (!players?.length) return <div style={emptyMsg}>No players found.</div>;

  const displayed = filter === 'all' ? players : players.filter(p => p.side === filter);

  const NbaPlayerCard = ({ p }) => {
    const [open, setOpen] = React.useState(false);
    const hasH2H = (p.h2h || []).length > 0;
    const hasL5  = (p.l5  || []).length > 0;

    return (
      <HudCard style={{ padding: '18px 20px' }} accent={p.teamColor}>
        {/* Header — clickable, toggles the drilldown */}
        <div onClick={() => setOpen(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', cursor: 'pointer', userSelect: 'none' }}>
          <PlayerCard player={{ name: p.name, headshot: p.headshot, pos: p.pos }} size="md" accent={p.teamColor} />
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700 }}>{p.name}</span>
              <span style={{ fontSize: 9, padding: '2px 7px', border: `1px solid ${p.teamColor}66`, color: p.teamColor, fontFamily: 'Space Mono, monospace', borderRadius: 2, letterSpacing: '0.08em' }}>{p.teamAbbr}</span>
              <span style={{ fontSize: 9, padding: '2px 7px', border: `1px solid ${p.teamColor}44`, color: p.teamColor, fontFamily: 'Space Mono, monospace', borderRadius: 2 }}>{p.pos}</span>
              {p.jersey && p.jersey !== '—' && <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace' }}>#{p.jersey}</span>}
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.05em' }}>
              vs {p.oppAbbr} · L5 {p.avgPts.toFixed(1)}/{p.avgReb.toFixed(1)}/{p.avgAst.toFixed(1)} · {(p.h2h || []).length}G vs {p.oppAbbr}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            {[['PTS', p.avgPts], ['REB', p.avgReb], ['AST', p.avgAst]].map(([l, v]) => (
              <div key={l} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 8, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.16em', marginBottom: 2 }}>{l}</div>
                <div style={{ fontSize: 18, fontFamily: 'Orbitron, monospace', fontWeight: 700, color: p.teamColor }}>{v.toFixed(1)}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 10, borderLeft: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.15em' }}>
              {open ? 'HIDE' : 'EXPAND'}
            </span>
            <span style={{ fontSize: 14, color: p.teamColor, fontFamily: 'Orbitron, monospace', transition: 'transform 0.2s',
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
          </div>
        </div>

        {open && (
          <div style={{ marginTop: 18, animation: 'fadeUp 0.25s ease' }}>
            {/* H2H vs opposing team — shown first per user request */}
            <div style={{ paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', color: p.teamColor, letterSpacing: '0.22em' }}>
                  HEAD-TO-HEAD vs {p.oppAbbr}
                </span>
                <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace' }}>
                  {hasH2H ? `${p.h2h.length}G · last: ${p.h2h[0].date}` : 'NO GAMES'}
                </span>
              </div>
              {hasH2H ? (
                <GameLogChart
                  games={p.h2h}
                  stats={NBA_STATS}
                  defaultStat="pts"
                  emptyLabel={`NO GAMES VS ${p.oppAbbr} THIS SEASON`}
                  accent={p.teamColor}
                  colorFor={nbaStatColorFor}
                />
              ) : (
                <div style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', padding: '16px 0', letterSpacing: '0.1em' }}>
                  NO GAMES VS {p.oppAbbr} THIS SEASON
                </div>
              )}
            </div>

            {/* Last 5 season games */}
            <div style={{ paddingTop: 18, marginTop: 18, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', color: p.teamColor, letterSpacing: '0.22em', marginBottom: 10 }}>
                LAST 5 GAMES (SEASON)
              </div>
              {hasL5 ? (
                <GameLogChart
                  games={p.l5}
                  stats={NBA_STATS}
                  defaultStat="pts"
                  emptyLabel="NO RECENT GAMES"
                  accent={p.teamColor}
                  colorFor={nbaStatColorFor}
                />
              ) : (
                <div style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', padding: '16px 0', letterSpacing: '0.1em' }}>
                  NO RECENT GAMES
                </div>
              )}
            </div>
          </div>
        )}
      </HudCard>
    );
  };

  return (
    <div style={{ padding: '20px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <SectionHeader label="NBA EDGE FINDER" sub="H2H vs opposing team · Last 5 season games · PTS / REB / AST" />
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {[['all', 'BOTH'], ['away', gameInfo.awayAbbr], ['home', gameInfo.homeAbbr]].map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)}
              style={{ padding: '4px 12px', background: filter === v ? 'rgba(0,212,255,0.1)' : 'transparent',
                border: `1px solid ${filter === v ? 'rgba(0,212,255,0.3)' : 'rgba(255,255,255,0.06)'}`,
                color: filter === v ? 'var(--cyan)' : 'var(--dim)', fontFamily: 'Space Mono, monospace',
                fontSize: 10, cursor: 'pointer', borderRadius: 2, letterSpacing: '0.08em' }}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {displayed.map((p, i) => <NbaPlayerCard key={p.id || i} p={p} />)}
      </div>
    </div>
  );
}

/* ── PITCHING EDGE TAB (MLB) ─────────────────────────── */
function PitchingEdgeTab({ gameData }) {
  const { gameInfo, pitchingData } = gameData;
  if (!pitchingData) return <div style={emptyMsg}>Pitching data loading or unavailable.</div>;
  const { pitchers } = pitchingData;
  const fv = (v, d=2) => v != null ? Number(v).toFixed(d) : '—';

  const PitcherCard = ({ p, abbr, color }) => {
    if (!p) return <HudCard style={{ padding: 20, textAlign: 'center' }} accent="var(--dim)"><div style={{ color: 'var(--dim)', fontFamily: 'Space Mono, monospace', fontSize: 10 }}>SP NOT ANNOUNCED</div></HudCard>;
    return (
      <HudCard style={{ padding: 18 }} accent={color}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 16 }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', overflow: 'hidden', border: `2px solid ${color}44`, flexShrink: 0 }}>
            <img src={p.headshot} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display='none'} />
          </div>
          <div>
            <div style={{ fontFamily: 'Space Mono, monospace', fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 3 }}>{p.name}</div>
            <div style={{ fontSize: 10, color, fontFamily: 'Space Mono, monospace' }}>{abbr}{p.throws ? ` · ${p.throws}HP` : ''}{p.record ? ` · ${p.record}` : ''}</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {[['ERA', fv(p.era)], ['WHIP', fv(p.whip)], ['REC', p.record||'—']].map(([l,v]) => (
            <div key={l} style={{ textAlign: 'center', padding: '8px 6px', background: 'var(--surface)', borderRadius: 3 }}>
              <div style={{ fontSize: 8, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.12em', marginBottom: 3 }}>{l}</div>
              <div style={{ fontSize: 18, fontFamily: 'Orbitron, monospace', color, fontWeight: 700 }}>{v}</div>
            </div>
          ))}
        </div>
      </HudCard>
    );
  };

  return (
    <div style={{ padding: '20px 0' }}>
      <SectionHeader label="STARTING PITCHERS" sub="Season ERA · WHIP · Record" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
        <PitcherCard p={pitchers?.away} abbr={gameInfo.awayAbbr} color="var(--cyan)" />
        <PitcherCard p={pitchers?.home} abbr={gameInfo.homeAbbr} color="#ffd060" />
      </div>
    </div>
  );
}

/* ── AI PLAYS TAB ─────────────────────────────────────── */
function AIPlaysTab({ gameData }) {
  const [plays, setPlays] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [userPlay, setUserPlay] = React.useState('');
  const [discussion, setDiscussion] = React.useState(null);
  const [discussing, setDiscussing] = React.useState(false);

  const hasKey = !!getApiKey();

  const generate = async () => {
    setLoading(true);
    const result = await generateAIPlays(gameData);
    setLoading(false);
    setPlays(result);
  };

  const discuss = async () => {
    if (!userPlay.trim()) return;
    if (!hasKey) { setDiscussion('Add your Claude API key in the top bar to discuss plays.'); return; }
    setDiscussing(true);
    try {
      const { gameInfo } = gameData;
      const resp = await claudeComplete(
        `You are a sports betting analyst. A bettor wants to discuss this play: "${userPlay}"
Game: ${gameInfo.awayFull} @ ${gameInfo.homeFull} (${gameInfo.sportLabel})
Spread: ${gameInfo.spread || 'N/A'} | O/U: ${gameInfo.overUnder || 'N/A'}
Give a concise 3-4 sentence analysis of this bet.`,
        { maxTokens: 400 }
      );
      setDiscussion(resp);
    } catch (e) {
      setDiscussion(e.message === 'NO_API_KEY'
        ? 'Add your Claude API key in the top bar to discuss plays.'
        : 'Unable to analyze play at this time.');
    }
    setDiscussing(false);
  };

  const confColor = c => c==='HIGH'?'#00ff88':c==='MEDIUM'?'#ffd060':'var(--muted)';
  const typeColor = t => ({SPREAD:'var(--cyan)',TOTAL:'#a855f7',PROP:'#ff6b35',ML:'#ffd060'}[t]||'var(--dim)');

  return (
    <div style={{ padding: '20px 0', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <SectionHeader label="◆ AI RECOMMENDED PLAYS" sub="Powered by Claude · Based on form, H2H, injuries" />
        {!hasKey && (
          <div style={{ padding: '14px 16px', marginBottom: 12, background: 'rgba(255,107,53,0.06)',
            border: '1px solid rgba(255,107,53,0.2)', borderRadius: 3, fontSize: 11,
            color: '#ff6b35', fontFamily: 'Space Mono, monospace', letterSpacing: '0.08em' }}>
            ⚠ Add your Claude API key in the top bar to generate AI plays.
          </div>
        )}
        {!plays && !loading && (
          <button onClick={generate} style={{ padding: '12px 24px', background: 'rgba(0,212,255,0.1)',
            border: '1px solid rgba(0,212,255,0.3)', color: 'var(--cyan)', fontFamily: 'Space Mono, monospace',
            fontSize: 11, cursor: 'pointer', borderRadius: 2, letterSpacing: '0.1em', transition: 'all 0.2s' }}>
            ◆ GENERATE AI PLAYS
          </button>
        )}
        {loading && <Loader text="ANALYZING..." />}
        {plays && plays.error === 'NO_API_KEY' && (
          <div style={{ padding: '14px 16px', background: 'rgba(255,107,53,0.06)',
            border: '1px solid rgba(255,107,53,0.2)', borderRadius: 3, fontSize: 11,
            color: '#ff6b35', fontFamily: 'Space Mono, monospace' }}>
            No API key set. Paste your Claude key (sk-ant-…) in the top bar.
          </div>
        )}
        {Array.isArray(plays) && plays.length === 0 && (
          <div style={emptyMsg}>No plays returned. Try again.</div>
        )}
        {Array.isArray(plays) && plays.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {plays.map((p, i) => (
              <HudCard key={i} style={{ padding: '16px 18px' }} accent={confColor(p.confidence)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 9, padding: '2px 8px', border: `1px solid ${typeColor(p.type)}44`,
                    color: typeColor(p.type), fontFamily: 'Space Mono, monospace', letterSpacing: '0.1em', borderRadius: 2 }}>{p.type}</span>
                  <span style={{ fontSize: 9, padding: '2px 8px', border: `1px solid ${confColor(p.confidence)}44`,
                    color: confColor(p.confidence), fontFamily: 'Space Mono, monospace', letterSpacing: '0.1em', borderRadius: 2 }}>{p.confidence}</span>
                </div>
                <div style={{ fontSize: 15, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700, marginBottom: 8 }}>{p.play}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', lineHeight: 1.5 }}>{p.reason}</div>
              </HudCard>
            ))}
          </div>
        )}
      </div>

      <div>
        <SectionHeader label="YOUR PLAY" sub="Discuss with Claude" />
        <textarea value={userPlay} onChange={e => setUserPlay(e.target.value)}
          placeholder="e.g. 'Braves -1.5' or 'Over 8.5 runs' or 'Acuña over 1.5 hits'"
          style={{ width: '100%', minHeight: 80, background: 'var(--card)', border: '1px solid rgba(0,212,255,0.15)',
            color: 'var(--text)', fontFamily: 'Space Mono, monospace', fontSize: 12, padding: '12px 14px',
            borderRadius: 3, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }} />
        <button onClick={discuss} disabled={discussing}
          style={{ marginTop: 8, padding: '10px 20px', background: 'rgba(0,212,255,0.08)',
            border: '1px solid rgba(0,212,255,0.25)', color: 'var(--cyan)', fontFamily: 'Space Mono, monospace',
            fontSize: 10, cursor: 'pointer', borderRadius: 2, letterSpacing: '0.1em' }}>
          {discussing ? 'ANALYZING...' : 'DISCUSS →'}
        </button>
        {discussion && (
          <HudCard style={{ padding: '14px 16px', marginTop: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'Space Mono, monospace', lineHeight: 1.6 }}>{discussion}</div>
          </HudCard>
        )}
      </div>
    </div>
  );
}

const emptyMsg = { padding: '40px 24px', textAlign: 'center', fontFamily: 'Space Mono, monospace',
  fontSize: 11, color: 'var(--dim)', letterSpacing: '0.1em' };

Object.assign(window, { OverviewTab, H2HTab, RosterTab, FormTab, EdgeFinderTab, NbaEdgeFinderTab, PitchingEdgeTab, AIPlaysTab });
