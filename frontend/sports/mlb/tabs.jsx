/* ============================================================
   PLAYIQ — MLB TABS
   MLB-only game-detail tabs and chart helpers
   ============================================================ */

/* ── MLB LOADING SEQUENCE ────────────────────────────────
   Heavy MLB tabs (Edge Finder, Pitching, Low HR, High Contact, Lineup)
   wait on Savant/MLB-Stats round trips that can run many seconds. Instead
   of a static skeleton we show a pitch loop with a progress bar, and when
   the data lands the bat connects and the ball leaves the park.

   Keyframes are injected at runtime (scoped `piq*` names) rather than added
   to index.html, so this file stays self-contained. */

const MLB_LOADER_CSS = `
@keyframes piqPitch {
  0%   { transform: translate(232px, -34px) scale(0.55); opacity: 0; }
  14%  { opacity: 1; }
  100% { transform: translate(0px, 0px) scale(1); opacity: 1; }
}
@keyframes piqBatIdle {
  0%,100% { transform: rotate(-30deg); }
  50%     { transform: rotate(-22deg); }
}
@keyframes piqBatSwing {
  0%   { transform: rotate(-28deg); }
  42%  { transform: rotate(48deg); }
  100% { transform: rotate(35deg); }
}
/* ends at (250,26): clear of the wall top (y=58) but still inside the 320x120 frame */
@keyframes piqHomerX { from { transform: translateX(0); }   to { transform: translateX(186px); } }
@keyframes piqHomerY { from { transform: translateY(0); }   to { transform: translateY(-40px); } }
@keyframes piqCrack  { 0% { opacity: 0; transform: scale(0.5); } 30% { opacity: 1; transform: scale(1.2); } 100% { opacity: 0; transform: scale(1.6); } }
@keyframes piqHrText { 0% { opacity: 0; transform: translateY(6px); } 40% { opacity: 1; transform: translateY(0); } 100% { opacity: 1; transform: translateY(0); } }
`;
if (typeof document !== 'undefined' && !document.getElementById('piq-mlb-loader-css')) {
  const _s = document.createElement('style');
  _s.id = 'piq-mlb-loader-css';
  _s.textContent = MLB_LOADER_CSS;
  document.head.appendChild(_s);
}

// Ticks while `active`, so the bar can advance on real elapsed time.
function useMlbElapsed(active) {
  const [ms, setMs] = React.useState(0);
  React.useEffect(() => {
    if (!active) return;
    const t0 = Date.now();
    const id = setInterval(() => setMs(Date.now() - t0), 120);
    return () => clearInterval(id);
  }, [active]);
  return ms;
}

/* Gate a tab's render on the load sequence.
   'loading' → pitch loop · 'hit' → home-run beat · 'ready' → show content.
   The home-run beat only plays when data actually arrived, so a failed
   fetch falls straight through to the tab's own empty state. */
function useMlbLoadGate(isLoading, hasData) {
  const [phase, setPhase] = React.useState(isLoading ? 'loading' : 'ready');
  React.useEffect(() => {
    if (isLoading) { setPhase('loading'); return; }
    let celebrated = false;
    setPhase(p => { if (p === 'loading' && hasData) { celebrated = true; return 'hit'; } return 'ready'; });
    if (!celebrated) return;
    const t = setTimeout(() => setPhase('ready'), 1150);
    return () => clearTimeout(t);
  }, [isLoading, hasData]);
  return phase;
}

function MlbDataLoader({ phase, source, label }) {
  const hit = phase === 'hit';
  const ms = useMlbElapsed(!hit);
  // Asymptotic estimate — never claims 100% until the data is actually in.
  const pct = hit ? 100 : Math.min(94, Math.round(100 * (1 - Math.exp(-ms / 7000))));
  const secs = (ms / 1000).toFixed(1);
  const barColor = hit ? '#00ff88' : 'var(--cyan)';

  return (
    <div style={{ padding: '30px 0 24px', animation: 'fadeUp 0.3s ease' }}>
      <div style={{ maxWidth: 460, margin: '0 auto' }}>
        <svg viewBox="0 0 320 120" style={{ width: '100%', height: 'auto', display: 'block' }}>
          <defs>
            <linearGradient id="piqLoadGrass" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#12402a" /><stop offset="100%" stopColor="#08200f" />
            </linearGradient>
          </defs>
          {/* ground */}
          <path d="M 0,92 L 320,92 L 320,120 L 0,120 Z" fill="url(#piqLoadGrass)" />
          <line x1="0" y1="92" x2="320" y2="92" stroke="var(--cyan)" strokeWidth="1" opacity="0.3" />
          {/* outfield fence — a solid wall with a lit top rail, not a goalpost */}
          <rect x="284" y="58" width="16" height="34" fill="#0b1a14" stroke="rgba(255,255,255,0.10)" strokeWidth="0.8" />
          <rect x="282" y="56" width="20" height="3" rx="1.5" fill="var(--cyan)" opacity={hit ? 0.9 : 0.45} />
          {/* home plate */}
          <polygon points="38,92 54,92 54,87 46,83 38,87" fill="#eef4fa" opacity="0.8" />

          {/* bat — pivots at the knob; barrel is the thick end */}
          <g style={{ transformBox: 'fill-box', transformOrigin: '50% 100%',
            animation: hit ? 'piqBatSwing 0.5s cubic-bezier(0.2,0.9,0.3,1) forwards' : 'piqBatIdle 1.6s ease-in-out infinite' }}>
            <path d="M 43.4,50 Q 47,47 50.6,50 L 49,80 Q 47,82 45,80 Z" fill="#c9a227" />
            <rect x="45.2" y="80" width="3.6" height="12" rx="1.8" fill="#8a6f1c" />
            <circle cx="47" cy="92" r="2.4" fill="#6d5715" />
          </g>

          {/* contact flash — sits on the swung bat's barrel, where the ball departs */}
          {hit && (
            <g style={{ animation: 'piqCrack 0.45s ease-out forwards', transformBox: 'fill-box', transformOrigin: 'center' }}>
              {[0, 45, 90, 135, 180, 225, 270, 315].map(a => {
                const r1 = 6, r2 = 13, rad = a * Math.PI / 180;
                return <line key={a}
                  x1={66 + r1 * Math.cos(rad)} y1={64 + r1 * Math.sin(rad)}
                  x2={66 + r2 * Math.cos(rad)} y2={64 + r2 * Math.sin(rad)}
                  stroke="#ffd060" strokeWidth="2" strokeLinecap="round" />;
              })}
              <circle cx="66" cy="64" r="4" fill="#fff3c4" opacity="0.95" />
            </g>
          )}

          {/* ball — loops in on the pitch, launches out on contact */}
          <g style={{ animation: hit ? 'piqHomerX 1.05s cubic-bezier(0.25,0.6,0.4,1) forwards' : 'none' }}>
            <g style={{ animation: hit ? 'piqHomerY 1.05s cubic-bezier(0.15,0.9,0.5,1) forwards' : 'piqPitch 1.25s linear infinite' }}>
              <g transform="translate(66,64)">
                <circle r="7" fill="#f4f8fc" />
                <path d="M -3.4,-5.6 A 7,7 0 0 0 -3.4,5.6" fill="none" stroke="#d0555a" strokeWidth="1.1" />
                <path d="M 3.4,-5.6 A 7,7 0 0 1 3.4,5.6" fill="none" stroke="#d0555a" strokeWidth="1.1" />
              </g>
            </g>
          </g>

          {hit && (
            <text x="168" y="30" textAnchor="middle" fill="#00ff88" fontFamily="Orbitron, monospace"
              fontSize="17" fontWeight="900" letterSpacing="2.5"
              style={{ animation: 'piqHrText 0.5s ease-out 0.28s backwards' }}>HOME RUN</text>
          )}
        </svg>

        {/* progress */}
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: hit ? '#00ff88' : 'var(--cyan)', letterSpacing: '0.18em' }}>
              {hit ? 'DATA IN — PLAY BALL' : `FETCHING FROM ${String(source || 'MLB').toUpperCase()}`}
            </span>
            <span style={{ fontSize: 15, fontFamily: 'Orbitron, monospace', fontWeight: 900, color: barColor }}>{pct}%</span>
          </div>
          <div style={{ height: 7, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: barColor,
              boxShadow: `0 0 10px ${hit ? '#00ff88' : 'var(--cyan)'}`, borderRadius: 4,
              transition: 'width 0.35s cubic-bezier(0.16,1,0.3,1), background 0.3s' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)' }}>{label || 'Loading…'}</span>
            <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)' }}>{secs}s</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const L5_STATS = [
  { key: 'hits', label: 'H' },
  { key: 'hr', label: 'HR' },
  { key: 'r', label: 'R' },
  { key: 'rbi', label: 'RBI' },
  { key: 'k', label: 'K' },
  { key: 'bb', label: 'BB' },
];

const BVP_STATS = [
  { key: 'h', label: 'H' },
  { key: 'hr', label: 'HR' },
  { key: 'k', label: 'K' },
  { key: 'bb', label: 'BB' },
];

function shapeBvpForChart(gameByGame, pitcherName) {
  if (!gameByGame?.length) return [];
  return [...gameByGame].map(g => ({
    date: g.date ? new Date(g.date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '',
    rawDate: g.date,
    opp: pitcherName ? pitcherName.split(' ').slice(-1)[0] : 'SP',
    home: false,
    gamePk: g.gamePk,
    hits: Number(g.h ?? 0), h: Number(g.h ?? 0),
    hr: Number(g.hr ?? 0),
    k: Number(g.k ?? 0),
    bb: Number(g.bb ?? 0),
    ab: Number(g.ab ?? 0),
    pa: Number(g.pa ?? 0),
    weather: g.weather || null,
  }));
}

const MLB_PROP_STAT_LABELS = { hits: 'HITS', rbi: 'RBI', k: 'STRIKEOUTS' };
const MLB_PROP_LINES = { hits: [0.5, 1.5], rbi: [0.5], k: [0.5, 1.5] };

function mlbPropColor(p) {
  if (p == null) return 'var(--muted)';
  if (p >= 0.70) return '#00ff88';
  if (p >= 0.55) return '#ffd060';
  if (p >= 0.45) return '#00d4ff';
  return '#ff6b35';
}

function EdgeFinderTab({ gameData }) {
  const { mlbEdgeData, mlbPropModel, gameInfo } = gameData;
  const [filter, setFilter] = React.useState('all');
  const [propStat, setPropStat] = React.useState('hits');
  const [propLine, setPropLine] = React.useState(0.5);
  const selectPropStat = s => { setPropStat(s); setPropLine(MLB_PROP_LINES[s][0]); };

  const loadPhase = useMlbLoadGate(gameData?._loading?.mlbEdgeData !== false, !!mlbEdgeData);
  if (loadPhase !== 'ready') return <MlbDataLoader phase={loadPhase} source="Baseball Savant" label="Pulling batter-vs-pitcher history…" />;
  if (!mlbEdgeData) return <div style={emptyMsg}>Edge data unavailable — lineups may not be posted yet.</div>;

  const { batters, bvpStatus } = mlbEdgeData;
  const displayed = filter === 'edges' ? batters.filter(b => b.edgeStats && b.bvp?.ops >= 0.700) : batters;

  const BatterEdgeCard = ({ b }) => {
    const [open, setOpen] = React.useState(false);
    const bvp = b.bvp;
    const hasBvp = bvp && bvp.pa > 0;
    const opsColor = hasBvp
      ? (bvp.ops >= 0.900 ? 'var(--green)' : bvp.ops >= 0.700 ? 'var(--gold)' : bvp.ops >= 0.500 ? 'var(--cyan)' : 'var(--orange)')
      : 'var(--muted)';

    const bvpGames = hasBvp ? shapeBvpForChart(bvp.gameByGame, b.pitcher) : [];

    return (
      <HudCard style={{ padding: '18px 20px' }} accent={opsColor}>
        <div onClick={() => setOpen(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', cursor: 'pointer', userSelect: 'none' }}>
          <PlayerCard player={{ name: b.name, headshot: b.headshotUrl, pos: b.position }} size="md" accent={b.teamColor} />
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700 }}>{b.name}</span>
              <span style={{ fontSize: 10, padding: '2px 7px', border: `1px solid ${b.teamColor}66`, color: b.teamColor, fontFamily: 'Space Mono, monospace', borderRadius: 2, letterSpacing: '0.08em' }}>{b.teamAbbr}</span>
              <span style={{ fontSize: 10, padding: '2px 7px', border: `1px solid ${b.teamColor}44`, color: b.teamColor, fontFamily: 'Space Mono, monospace', borderRadius: 2 }}>{b.position}</span>
              {b.order && <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace' }}>#{b.order}</span>}
              <HotBadge tier={b.hotTier} />
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.05em' }}>vs {b.pitcher || 'TBD'}</div>
          </div>
          {hasBvp && (
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <OpsGauge ops={bvp.ops} size={64} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, auto)', columnGap: 14, rowGap: 3 }}>
                {[['PA', bvp.pa], ['H', bvp.hits], ['HR', bvp.hr], ['BB', bvp.bb]].map(([l, v]) => (
                  <React.Fragment key={l}>
                    <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.14em' }}>{l}</span>
                    <span style={{ fontSize: 13, fontFamily: 'Orbitron, monospace', fontWeight: 700,
                      color: l === 'HR' && v > 0 ? 'var(--orange)' : 'var(--text)' }}>{v}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 10, borderLeft: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.15em' }}>
              {open ? 'HIDE' : 'EXPAND'}
            </span>
            <span style={{ fontSize: 14, color: opsColor, fontFamily: 'Orbitron, monospace', transition: 'transform 0.2s',
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
          </div>
        </div>

        {open && (
          <div style={{ marginTop: 18, animation: 'fadeUp 0.25s ease' }}>
            <div style={{ paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: b.teamColor, letterSpacing: '0.22em', marginBottom: 10 }}>
                LAST 5 GAMES (SEASON)
              </div>
              <GameLogChart games={b.gameLog || []} stats={L5_STATS} defaultStat="hits" emptyLabel="NO RECENT SEASON GAMES" accent={b.teamColor} />
            </div>

            <div style={{ paddingTop: 18, marginTop: 18, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: opsColor, letterSpacing: '0.22em' }}>
                  GAMES VS {b.pitcher?.toUpperCase() || 'PITCHER'} (SAVANT)
                </span>
                {hasBvp && (
                  <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace' }}>
                    {bvp.gamesPlayed}G · LAST: {bvp.lastFaced || '—'}
                  </span>
                )}
              </div>
              {hasBvp ? (
                <GameLogChart games={bvpGames} stats={BVP_STATS} defaultStat="h" emptyLabel="NO BvP HISTORY" accent={opsColor} />
              ) : (
                <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', padding: '16px 0', letterSpacing: '0.1em' }}>
                  NO BvP HISTORY
                </div>
              )}
            </div>
          </div>
        )}
      </HudCard>
    );
  };

  // ── Batter-prop projection board (transparent Log5 model) ──
  const MlbPropBoard = () => {
    const [openId, setOpenId] = React.useState(null);
    if (!mlbPropModel) {
      if (gameData?._loading?.mlbPropModel !== false) return <TabLoader source="MLB Stats + Savant" label="Projecting batter props..." rows={4} />;
      return null;
    }
    const all = [...(mlbPropModel.away || []), ...(mlbPropModel.home || [])]
      .map(b => ({ ...b, prob: b.predictions?.[propStat]?.[String(propLine)] }))
      .filter(b => b.prob != null)
      .sort((a, b) => b.prob - a.prob);
    const abbrFor = side => side === 'away' ? gameInfo.awayAbbr : gameInfo.homeAbbr;
    const colorFor = side => side === 'away' ? 'var(--cyan)' : '#ffd060';
    const fmtOdds = p => p == null ? '—' : p > 0.5 ? `-${Math.round(100 * p / (1 - p))}` : `+${Math.round(100 * (1 - p) / p)}`;
    const park = mlbPropModel.park || {};
    const wx = mlbPropModel.weather || {};

    const InputChips = ({ b }) => {
      const inp = b.inputs?.[propStat] || {};
      const chips = propStat === 'hits'
        ? [['batter AVG', inp.battAvg], ['pitcher AVG-against', inp.pitchAvgAgainst], ['→ P(hit)/AB', inp.pHit], ['exp AB', inp.abExp], ['park×', inp.parkMult], ['weather×', inp.wxMult]]
        : propStat === 'k'
        ? [['batter K/PA', inp.battKpa], ['pitcher K/PA', inp.pitchKpa], ['→ P(K)/PA', inp.pK], ['exp PA', inp.paExp], ['arsenal whiff%', inp.whiffPct]]
        : [['batter RBI/G', inp.rbiPerG], ['pitcher run×', inp.pitchMult], ['→ λ (exp RBI)', inp.lambda]];
      const formula = propStat === 'rbi'
        ? 'Poisson: P(RBI ≥ line) = 1 − e^(−λ)'
        : `Log5(batter, pitcher, league) → per-${propStat === 'hits' ? 'AB' : 'PA'} rate, then Binomial tail over expected ${propStat === 'hits' ? 'AB' : 'PA'}`;
      return (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.04)', animation: 'fadeUp 0.2s ease' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
            {chips.map(([l, v]) => (
              <span key={l} style={{ fontSize: 9.5, fontFamily: 'Space Mono, monospace', color: 'var(--text)', padding: '2px 6px', background: 'rgba(255,255,255,0.03)', borderRadius: 2, border: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ color: 'var(--muted)' }}>{l} </span>{v == null ? '—' : v}
              </span>
            ))}
            {b.context?.bvpPa > 0 && (
              <span style={{ fontSize: 9.5, fontFamily: 'Space Mono, monospace', color: '#ffd060', padding: '2px 6px', background: 'rgba(255,208,96,0.08)', borderRadius: 2, border: '1px solid rgba(255,208,96,0.25)' }}>
                BvP {b.context.bvpH}H/{b.context.bvpK}K in {b.context.bvpPa}PA
              </span>
            )}
            <span style={{ fontSize: 9.5, fontFamily: 'Space Mono, monospace', color: b.context?.platoonAdv ? '#5ff5a5' : 'var(--muted)', padding: '2px 6px', borderRadius: 2, border: '1px solid rgba(255,255,255,0.05)' }}>
              {b.context?.platoonAdv ? 'platoon edge' : 'no platoon edge'}
            </span>
          </div>
          <div style={{ fontSize: 9.5, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', lineHeight: 1.5 }}>
            <span style={{ color: 'var(--muted)' }}>METHOD </span>{formula}
          </div>
        </div>
      );
    };

    return (
      <HudCard style={{ padding: '16px 18px', marginBottom: 20 }} accent="#00ff88">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{ fontSize: 12, fontFamily: 'Orbitron, monospace', fontWeight: 900, color: '#00ff88', letterSpacing: '0.12em' }}>◆ PROP PROJECTION MODEL</span>
          <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', letterSpacing: '0.1em' }}>Log5 matchup · likelihood to hit the line</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)' }}>
            {park.venue || ''}{park.factor != null ? ` · park ${park.factor}` : ''}{wx.temp != null ? ` · ${wx.temp}°` : ''}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 5 }}>
            {['hits', 'rbi', 'k'].map(s => (
              <button key={s} onClick={() => selectPropStat(s)}
                style={{ padding: '5px 13px', background: propStat === s ? 'rgba(0,255,136,0.12)' : 'transparent',
                  border: `1px solid ${propStat === s ? 'rgba(0,255,136,0.4)' : 'rgba(255,255,255,0.08)'}`,
                  color: propStat === s ? '#00ff88' : 'var(--muted)', fontFamily: 'Orbitron, monospace', fontWeight: 700,
                  fontSize: 10, cursor: 'pointer', borderRadius: 2, letterSpacing: '0.08em' }}>{MLB_PROP_STAT_LABELS[s]}</button>
            ))}
          </div>
          <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.08)' }} />
          <div style={{ display: 'flex', gap: 5 }}>
            {MLB_PROP_LINES[propStat].map(line => (
              <button key={line} onClick={() => setPropLine(line)}
                style={{ padding: '5px 12px', background: propLine === line ? 'rgba(0,212,255,0.12)' : 'transparent',
                  border: `1px solid ${propLine === line ? 'rgba(0,212,255,0.4)' : 'rgba(255,255,255,0.08)'}`,
                  color: propLine === line ? 'var(--cyan)' : 'var(--muted)', fontFamily: 'Space Mono, monospace',
                  fontSize: 10, cursor: 'pointer', borderRadius: 2 }}>{line}+</button>
            ))}
          </div>
          <span style={{ marginLeft: 'auto', fontSize: 13, fontFamily: 'Orbitron, monospace', fontWeight: 700, color: 'var(--text)', letterSpacing: '0.06em' }}>
            {propLine}+ {MLB_PROP_STAT_LABELS[propStat]}
          </span>
        </div>

        {all.length ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {all.slice(0, 12).map((b, i) => {
              const c = mlbPropColor(b.prob);
              const pct = Math.round(b.prob * 100);
              const tc = colorFor(b.side);
              const isOpen = openId === b.id;
              const confColor = b.confidence === 'HIGH' ? '#00ff88' : b.confidence === 'MED' ? '#ffd060' : 'var(--muted)';
              return (
                <div key={b.id || i} style={{ padding: '9px 10px', borderRadius: 3, background: i % 2 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                  <div onClick={() => setOpenId(isOpen ? null : b.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', cursor: 'pointer', userSelect: 'none' }}>
                    <span style={{ width: 20, textAlign: 'center', fontSize: 14, fontFamily: 'Orbitron, monospace', fontWeight: 900, color: i === 0 ? '#00ff88' : i <= 2 ? 'var(--cyan)' : 'var(--muted)' }}>{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 150 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700 }}>{b.name}</span>
                        <span style={{ fontSize: 9.5, padding: '1px 6px', border: `1px solid ${tc}66`, color: tc, fontFamily: 'Space Mono, monospace', borderRadius: 2 }}>{abbrFor(b.side)} #{b.order || '—'}</span>
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', marginTop: 2 }}>
                        vs {b.pitcher}{b.pitcherThrows ? ` (${b.pitcherThrows}HP)` : ''} · <span style={{ color: confColor }}>{b.confidence}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 180, flex: 1 }}>
                      <div style={{ flex: 1, height: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: c, boxShadow: `0 0 8px ${c}88`, borderRadius: 4, transition: 'width 0.5s cubic-bezier(0.16,1,0.3,1)' }} />
                      </div>
                      <span style={{ width: 46, textAlign: 'right', fontSize: 17, fontFamily: 'Orbitron, monospace', fontWeight: 900, color: c }}>{pct}%</span>
                      <span style={{ width: 48, textAlign: 'right', fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)' }}>{fmtOdds(b.prob)}</span>
                    </div>
                  </div>
                  {isOpen && <InputChips b={b} />}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', padding: '10px 0' }}>No batters to project yet — waiting on lineups.</div>
        )}

        <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', marginTop: 12, lineHeight: 1.6 }}>
          Log5 blends each batter's rate with the pitcher's rate-allowed vs league, adjusted for park, weather, platoon, and BvP; Binomial (hits/K) or Poisson (RBI) over expected plate appearances. Tap a row to see the math. RBIs are inherently noisy — fair odds only, not a guarantee.
        </div>
      </HudCard>
    );
  };

  return (
    <div style={{ padding: '20px 0' }}>
      <MlbPropBoard />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <SectionHeader label="MLB EDGE FINDER" sub="L5 Season (H/HR/R/RBI/K/BB) · BvP Statcast (H/HR/K/BB) · Weather" />
        </div>
        {bvpStatus && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace',
              color: bvpStatus.lineupStatus === 'confirmed' ? 'var(--green)' : 'var(--gold)', letterSpacing: '0.1em' }}>
              LINEUP: {(bvpStatus.lineupStatus || '—').toUpperCase()}
            </span>
            {[['all', 'ALL'], ['edges', 'EDGES ONLY']].map(([v, l]) => (
              <button key={v} onClick={() => setFilter(v)}
                style={{ padding: '4px 10px', background: filter===v ? 'rgba(0,212,255,0.1)' : 'transparent',
                  border: `1px solid ${filter===v ? 'rgba(0,212,255,0.3)' : 'rgba(255,255,255,0.06)'}`,
                  color: filter===v ? 'var(--cyan)' : 'var(--muted)', fontFamily: 'Space Mono, monospace',
                  fontSize: 10, cursor: 'pointer', borderRadius: 2 }}>{l}</button>
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

const MLB_PITCHER_STAT_LABELS = { k: 'STRIKEOUTS', outs: 'OUTS', er: 'EARNED RUNS', hr: 'HOME RUNS' };
const MLB_PITCHER_LINES = { k: [4.5, 5.5, 6.5, 7.5], outs: [14.5, 15.5, 16.5, 17.5, 18.5], er: [1.5, 2.5, 3.5], hr: [0.5, 1.5] };
const MLB_PITCHER_LOG_STATS = [
  { key: 'k', label: 'K' }, { key: 'outs', label: 'OUTS' }, { key: 'er', label: 'ER' },
  { key: 'hr', label: 'HR' }, { key: 'h', label: 'H' }, { key: 'bb', label: 'BB' },
];

// Bar colors from the PITCHER's perspective: K/outs high = good; ER/HR/H/BB high = bad.
function mlbPitcherStatColor(v, key) {
  if (key === 'k')    return v >= 8 ? 'var(--green)' : v >= 6 ? 'var(--gold)' : v >= 4 ? 'var(--cyan)' : 'var(--orange)';
  if (key === 'outs') return v >= 18 ? 'var(--green)' : v >= 15 ? 'var(--gold)' : v >= 12 ? 'var(--cyan)' : 'var(--orange)';
  if (key === 'er')   return v === 0 ? 'var(--green)' : v <= 2 ? 'var(--gold)' : v <= 3 ? 'var(--cyan)' : 'var(--orange)';
  if (key === 'hr')   return v === 0 ? 'var(--green)' : v === 1 ? 'var(--gold)' : 'var(--orange)';
  if (key === 'h')    return v <= 4 ? 'var(--green)' : v <= 6 ? 'var(--gold)' : v <= 8 ? 'var(--cyan)' : 'var(--orange)';
  if (key === 'bb')   return v <= 1 ? 'var(--green)' : v <= 2 ? 'var(--gold)' : v <= 3 ? 'var(--cyan)' : 'var(--orange)';
  return 'var(--muted)';
}

function PitchingEdgeTab({ gameData }) {
  const { gameInfo, pitchingData, mlbPitcherProps } = gameData;
  const [pStat, setPStat] = React.useState('k');
  const [pLine, setPLine] = React.useState(4.5);

  const loadPhase = useMlbLoadGate(gameData?._loading?.pitchingData !== false, !!pitchingData);
  if (loadPhase !== 'ready') return <MlbDataLoader phase={loadPhase} source="MLB Stats API" label="Loading probable pitchers…" />;
  if (!pitchingData) return <div style={emptyMsg}>Pitching data unavailable.</div>;
  const { pitchers } = pitchingData;
  const fv = (v, d = 2) => v != null ? Number(v).toFixed(d) : '—';

  const PitcherCard = ({ p, abbr, color }) => {
    if (!p) return <HudCard style={{ padding: 20, textAlign: 'center' }} accent="var(--dim)"><div style={{ color: 'var(--muted)', fontFamily: 'Space Mono, monospace', fontSize: 10 }}>SP NOT ANNOUNCED</div></HudCard>;
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
          {[['ERA', fv(p.era)], ['WHIP', fv(p.whip)], ['REC', p.record || '—']].map(([l, v]) => (
            <div key={l} style={{ textAlign: 'center', padding: '8px 6px', background: 'var(--surface)', borderRadius: 3 }}>
              <div style={{ fontSize: 9.5, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.12em', marginBottom: 3 }}>{l}</div>
              <div style={{ fontSize: 18, fontFamily: 'Orbitron, monospace', color, fontWeight: 700 }}>{v}</div>
            </div>
          ))}
        </div>
      </HudCard>
    );
  };

  // ── Pitcher projection board (transparent Log5 / Binomial / Normal / Poisson) ──
  const PitcherPropBoard = () => {
    const [openId, setOpenId] = React.useState(null);
    if (!mlbPitcherProps) {
      if (gameData?._loading?.mlbPitcherProps !== false) return <TabLoader source="MLB Stats + Savant" label="Projecting pitcher props..." rows={3} />;
      return null;
    }
    const LINES = mlbPitcherProps.lines || MLB_PITCHER_LINES;
    const sides = ['away', 'home'].map(s => mlbPitcherProps[s]).filter(Boolean);
    if (!sides.length) return null;

    const rows = sides
      .map(p => ({ ...p, prob: p.predictions?.[pStat]?.[String(pLine)] }))
      .filter(p => p.prob != null)
      .sort((a, b) => b.prob - a.prob);
    const abbrFor = side => side === 'away' ? gameInfo.awayAbbr : gameInfo.homeAbbr;
    const colorFor = side => side === 'away' ? 'var(--cyan)' : '#ffd060';
    const fmtOdds = p => p == null ? '—' : p > 0.5 ? `-${Math.round(100 * p / (1 - p))}` : `+${Math.round(100 * (1 - p) / p)}`;
    const park = mlbPitcherProps.park || {};

    const Inputs = ({ p }) => {
      const i = p.inputs?.[pStat] || {};
      const chips = pStat === 'k'
        ? [['pitcher K/BF', i.kPerBF], ['opponent team K-rate', i.oppTeamKrate], ['→ P(K)/batter', i.pK], ['expected batters faced', i.expBF], ['arsenal whiff%', i.whiffPct],
           ...(i.vsOppStarts ? [[`K/BF vs them (${i.vsOppStarts} GP)`, i.vsOppKperBF], ['vs-them weight', i.vsOppWeight]] : [])]
        : pStat === 'outs'
        ? [['expected outs', i.expOuts], ['expected IP', i.expIP], ['std dev', i.outsSd], ['season outs/start', i.seasonOutsPerStart]]
        : pStat === 'er'
        ? [['season ERA', i.era], ['→ λ (expected ER)', i.lambda], ['opponent OPS', i.oppOPS], ['run env ×', i.runMult]]
        : [['season HR/9', i.hrPer9], ['→ λ (expected HR)', i.lambda], ['park factor', i.parkFactor], ['HR env ×', i.hrMult]];
      const method = pStat === 'k'
        ? 'Log5(pitcher K/BF, opponent team K-rate, league) → Binomial tail over expected batters faced'
        : pStat === 'outs'
        ? 'Normal fit to his outs-per-start distribution (workload/durability)'
        : pStat === 'er'
        ? 'Poisson: λ = (ERA ÷ 9) × expected IP, adjusted for opponent / park / weather'
        : 'Poisson: λ = (HR9 ÷ 9) × expected IP, adjusted for park / weather / opponent';
      return (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.04)', animation: 'fadeUp 0.2s ease' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
            {chips.map(([l, v]) => (
              <span key={l} style={{ fontSize: 9.5, fontFamily: 'Space Mono, monospace', color: 'var(--text)', padding: '2px 6px', background: 'rgba(255,255,255,0.03)', borderRadius: 2, border: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ color: 'var(--muted)' }}>{l} </span>{v == null ? '—' : v}
              </span>
            ))}
            <span style={{ fontSize: 9.5, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', padding: '2px 6px', borderRadius: 2, border: '1px solid rgba(255,255,255,0.05)' }}>
              from {p.starts} starts
            </span>
          </div>
          <div style={{ fontSize: 9.5, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', lineHeight: 1.5 }}>
            <span style={{ color: 'var(--muted)' }}>METHOD </span>{method}
          </div>
        </div>
      );
    };

    return (
      <HudCard style={{ padding: '16px 18px', marginBottom: 20 }} accent="#00ff88">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{ fontSize: 12, fontFamily: 'Orbitron, monospace', fontWeight: 900, color: '#00ff88', letterSpacing: '0.12em' }}>◆ PITCHER PROJECTION MODEL</span>
          <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', letterSpacing: '0.1em' }}>likelihood to clear the line</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)' }}>
            {park.venue || ''}{park.factor != null ? ` · park ${park.factor}` : ''}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {['k', 'outs', 'er', 'hr'].map(s => (
              <button key={s} onClick={() => { setPStat(s); setPLine((LINES[s] || [])[0]); }}
                style={{ padding: '5px 12px', background: pStat === s ? 'rgba(0,255,136,0.12)' : 'transparent',
                  border: `1px solid ${pStat === s ? 'rgba(0,255,136,0.4)' : 'rgba(255,255,255,0.08)'}`,
                  color: pStat === s ? '#00ff88' : 'var(--muted)', fontFamily: 'Orbitron, monospace', fontWeight: 700,
                  fontSize: 10, cursor: 'pointer', borderRadius: 2, letterSpacing: '0.08em' }}>{MLB_PITCHER_STAT_LABELS[s]}</button>
            ))}
          </div>
          <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.08)' }} />
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {(LINES[pStat] || []).map(line => (
              <button key={line} onClick={() => setPLine(line)}
                style={{ padding: '5px 11px', background: pLine === line ? 'rgba(0,212,255,0.12)' : 'transparent',
                  border: `1px solid ${pLine === line ? 'rgba(0,212,255,0.4)' : 'rgba(255,255,255,0.08)'}`,
                  color: pLine === line ? 'var(--cyan)' : 'var(--muted)', fontFamily: 'Space Mono, monospace',
                  fontSize: 10, cursor: 'pointer', borderRadius: 2 }}>{line}+</button>
            ))}
          </div>
          <span style={{ marginLeft: 'auto', fontSize: 13, fontFamily: 'Orbitron, monospace', fontWeight: 700, color: 'var(--text)', letterSpacing: '0.06em' }}>
            {pLine}+ {MLB_PITCHER_STAT_LABELS[pStat]}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((p, i) => {
            const c = mlbPropColor(p.prob);
            const pct = Math.round(p.prob * 100);
            const tc = colorFor(p.side);
            const isOpen = openId === p.id;
            const confColor = p.confidence === 'HIGH' ? '#00ff88' : p.confidence === 'MED' ? '#ffd060' : 'var(--muted)';
            return (
              <div key={p.id || i} style={{ padding: '10px', borderRadius: 3, background: i % 2 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                <div onClick={() => setOpenId(isOpen ? null : p.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', cursor: 'pointer', userSelect: 'none' }}>
                  <span style={{ width: 20, textAlign: 'center', fontSize: 14, fontFamily: 'Orbitron, monospace', fontWeight: 900, color: i === 0 ? '#00ff88' : 'var(--muted)' }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700 }}>{p.name}</span>
                      <span style={{ fontSize: 9.5, padding: '1px 6px', border: `1px solid ${tc}66`, color: tc, fontFamily: 'Space Mono, monospace', borderRadius: 2 }}>
                        {abbrFor(p.side)}{p.throws ? ` ${p.throws}HP` : ''}
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', marginTop: 2 }}>
                      vs {p.opponent} · proj {p.expOuts} outs ({p.expIP} IP) · <span style={{ color: confColor }}>{p.confidence}</span>
                      {p.vsOpp?.summary && (
                        <span style={{ color: '#ffd060' }}>
                          {' · '}{p.vsOpp.summary.starts}GP vs them: {p.vsOpp.summary.k9} K/9, {p.vsOpp.summary.era} ERA
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 180, flex: 1 }}>
                    <div style={{ flex: 1, height: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: c, boxShadow: `0 0 8px ${c}88`, borderRadius: 4, transition: 'width 0.5s cubic-bezier(0.16,1,0.3,1)' }} />
                    </div>
                    <span style={{ width: 46, textAlign: 'right', fontSize: 17, fontFamily: 'Orbitron, monospace', fontWeight: 900, color: c }}>{pct}%</span>
                    <span style={{ width: 48, textAlign: 'right', fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)' }}>{fmtOdds(p.prob)}</span>
                  </div>
                </div>
                {isOpen && <Inputs p={p} />}
              </div>
            );
          })}
        </div>

        <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', marginTop: 12, lineHeight: 1.6 }}>
          Shows P(stat ≥ line). For K and OUTS a high % means the pitcher goes deep / misses bats; for ER and HR a high % means he's
          likely to get <span style={{ color: '#ff8a55' }}>hit hard</span> — read those as the OVER, not as "good". Tap a row for the math. Fair odds only, not a guarantee.
        </div>
      </HudCard>
    );
  };

  const PitcherLogCard = ({ p, abbr, color }) => {
    if (!p?.gameLog?.length) return null;
    return (
      <HudCard style={{ padding: '16px 18px' }} accent={color}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontFamily: 'Space Mono, monospace', fontWeight: 700, color: 'var(--text)' }}>{p.name}</span>
          <span style={{ fontSize: 10, padding: '1px 6px', border: `1px solid ${color}66`, color, fontFamily: 'Space Mono, monospace', borderRadius: 2 }}>{abbr}</span>
          <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.12em' }}>
            LAST {p.gameLog.length} STARTS
          </span>
        </div>
        <GameLogChart games={p.gameLog} stats={MLB_PITCHER_LOG_STATS} defaultStat="k"
          emptyLabel="NO STARTS LOGGED" accent={color} colorFor={mlbPitcherStatColor} />
      </HudCard>
    );
  };

  // Head-to-head: this pitcher's recent starts against tonight's opponent.
  const PitcherVsOppCard = ({ p, abbr, color }) => {
    if (!p) return null;
    const games = p.vsOpp?.games || [];
    const s = p.vsOpp?.summary;
    return (
      <HudCard style={{ padding: '16px 18px' }} accent={color}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontFamily: 'Space Mono, monospace', fontWeight: 700, color: 'var(--text)' }}>{p.name}</span>
          <span style={{ fontSize: 10, padding: '1px 6px', border: `1px solid ${color}66`, color, fontFamily: 'Space Mono, monospace', borderRadius: 2 }}>{abbr}</span>
          <span style={{ fontSize: 10, color: '#ffd060', fontFamily: 'Space Mono, monospace', letterSpacing: '0.12em' }}>
            vs {p.opponent?.toUpperCase() || 'OPP'}
          </span>
          {p.vsOpp?.seasonSpan && (
            <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace' }}>
              {p.vsOpp.seasonSpan[0] === p.vsOpp.seasonSpan[1]
                ? p.vsOpp.seasonSpan[0]
                : `${p.vsOpp.seasonSpan[0]}–${p.vsOpp.seasonSpan[1]}`}
            </span>
          )}
          {p.vsOpp?.totalStarts > (p.vsOpp?.games?.length || 0) && (
            <span style={{ fontSize: 9.5, color: 'var(--muted)', fontFamily: 'Space Mono, monospace' }}>
              · chart shows last {p.vsOpp.games.length} of {p.vsOpp.totalStarts}
            </span>
          )}
        </div>
        {s ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginBottom: 14 }}>
              {[['STARTS', s.starts], ['IP', s.ip], ['K', s.k], ['ERA', s.era != null ? s.era.toFixed(2) : '—'], ['K/9', s.k9 ?? '—']].map(([l, v]) => (
                <div key={l} style={{ textAlign: 'center', padding: '7px 4px', background: 'var(--surface)', borderRadius: 3 }}>
                  <div style={{ fontSize: 9.5, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.1em', marginBottom: 3 }}>{l}</div>
                  <div style={{ fontSize: 14, fontFamily: 'Orbitron, monospace', color, fontWeight: 700 }}>{v}</div>
                </div>
              ))}
            </div>
            <GameLogChart games={games} stats={MLB_PITCHER_LOG_STATS} defaultStat="k"
              emptyLabel="NO STARTS VS THIS TEAM" accent={color} colorFor={mlbPitcherStatColor} />
          </>
        ) : (
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', padding: '14px 0', letterSpacing: '0.08em' }}>
            HAS NOT FACED THIS TEAM (last 3 seasons)
          </div>
        )}
      </HudCard>
    );
  };

  return (
    <div style={{ padding: '20px 0' }}>
      <PitcherPropBoard />

      <SectionHeader label="STARTING PITCHERS" sub="Season ERA · WHIP · Record" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
        <PitcherCard p={pitchers?.away} abbr={gameInfo.awayAbbr} color="var(--cyan)" />
        <PitcherCard p={pitchers?.home} abbr={gameInfo.homeAbbr} color="#ffd060" />
      </div>

      {mlbPitcherProps && (mlbPitcherProps.away || mlbPitcherProps.home) && (
        <>
          <SectionHeader label="HEAD-TO-HEAD vs TONIGHT'S OPPONENT" sub="Every start against this exact team (last 6 seasons) · totals cover all of them · roster turnover makes this context, not gospel" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 12, marginBottom: 24 }}>
            <PitcherVsOppCard p={mlbPitcherProps.away} abbr={gameInfo.awayAbbr} color="var(--cyan)" />
            <PitcherVsOppCard p={mlbPitcherProps.home} abbr={gameInfo.homeAbbr} color="#ffd060" />
          </div>

          <SectionHeader label="PER-START HISTORY (ALL OPPONENTS)" sub="K · Outs · ER · HR · H · BB over recent starts" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 12 }}>
            <PitcherLogCard p={mlbPitcherProps.away} abbr={gameInfo.awayAbbr} color="var(--cyan)" />
            <PitcherLogCard p={mlbPitcherProps.home} abbr={gameInfo.homeAbbr} color="#ffd060" />
          </div>
        </>
      )}
    </div>
  );
}

/* ── HIGH CONTACT TAB ────────────────────────────────────
   Visualizes the hit-risk report from /api/mlb/high-contact: a 0–100 risk
   score per starting pitcher, weighted breakdown of 6 sub-signals (pitcher
   traffic, pitch-type weakness, opp-vs-hand, lineup strength, weather,
   BvP), current-vs-prev pitcher numbers, Savant arsenal table, opposing
   team-vs-hand splits, bullpen, weather, and a verified-data row. */
function HighContactTab({ gameData }) {
  const { gameInfo, highContactData } = gameData;
  const loadPhase = useMlbLoadGate(gameData?._loading?.highContactData !== false, !!highContactData);
  if (loadPhase !== 'ready') return <MlbDataLoader phase={loadPhase} source="MLB Stats + Savant" label="Scoring hit-risk across six signals…" />;
  if (!highContactData) return <div style={emptyMsg}>High-contact report unavailable.</div>;

  const SUB_LABELS = {
    pitcherTraffic: 'PITCHER TRAFFIC',
    pitchType:      'PITCH-TYPE WEAKNESS',
    oppVsHand:      'OPP vs HAND',
    lineupStrength: 'LINEUP STRENGTH',
    weather:        'WEATHER',
    bvp:            'BvP',
  };
  const SUB_ORDER = ['pitcherTraffic', 'pitchType', 'oppVsHand', 'lineupStrength', 'weather', 'bvp'];

  const riskColor = score =>
    score == null ? 'var(--muted)' :
    score >= 65   ? '#ff6b35' :
    score >= 40   ? '#ffd060' :
                    '#00ff88';

  const angleFor = side => {
    if (side?.riskScore == null) return 'INSUFFICIENT DATA — wait for confirmed lineup + arsenal.';
    if (side.riskScore >= 65) return `LEAN HITTERS — over team total / first-5 over / opposing batter hits ${side.opponent || ''}.`;
    if (side.riskScore >= 40) return 'MIXED — single-batter props only, fade NRFI / look at HR props.';
    return 'LEAN PITCHER — under team total / pitcher K props / under hits-allowed.';
  };

  // Render an input value compactly (trim trailing zeros on floats).
  const formatInputVal = v => {
    if (v == null) return '—';
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, '');
    return String(v);
  };

  // Small caption under a data section showing where the numbers came from.
  const SourceTag = ({ children }) => (
    <span style={{ fontSize: 9.5, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.04em', textTransform: 'none' }}>
      · src: {children}
    </span>
  );

  // Collapsible provenance: per-parameter source + exact endpoint + the actual
  // inputs used + the formula, so every score can be independently verified.
  const MethodologyPanel = ({ side }) => {
    const [open, setOpen] = React.useState(false);
    const meth = side.methodology || [];
    if (!meth.length) return null;
    return (
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <div onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, userSelect: 'none' }}>
          <span style={{ fontSize: 12, color: 'var(--cyan)', display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>▸</span>
          <span style={{ fontSize: 10, color: 'var(--cyan)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.18em', fontWeight: 700 }}>METHODOLOGY & SOURCES</span>
          <span style={{ fontSize: 9.5, color: 'var(--muted)', fontFamily: 'Space Mono, monospace' }}>· verify every number</span>
        </div>
        {open && (
          <div style={{ marginTop: 10, animation: 'fadeUp 0.25s ease', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {meth.map(m => {
              const c = riskColor(m.score);
              return (
                <div key={m.key} style={{ padding: '10px 12px', background: 'var(--surface)', borderRadius: 3, border: '1px solid rgba(255,255,255,0.04)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                    <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700, letterSpacing: '0.08em' }}>
                      {m.label} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· weight {Math.round(m.weight * 100)}%</span>
                    </span>
                    <span style={{ fontSize: 11, fontFamily: 'Orbitron, monospace', color: c, fontWeight: 700 }}>
                      {m.score != null ? `score ${m.score}` : 'N/A'}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', marginBottom: 3 }}>
                    <span style={{ color: 'var(--muted)' }}>SOURCE </span>{m.source}
                  </div>
                  <div style={{ fontSize: 9.5, fontFamily: 'Space Mono, monospace', color: 'var(--cyan)', wordBreak: 'break-all', marginBottom: 6, lineHeight: 1.5 }}>
                    {m.endpoint}
                  </div>
                  {m.inputs && Object.keys(m.inputs).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
                      {Object.entries(m.inputs).map(([k, v]) => (
                        <span key={k} style={{ fontSize: 9.5, fontFamily: 'Space Mono, monospace', color: 'var(--text)', padding: '2px 6px', background: 'rgba(255,255,255,0.03)', borderRadius: 2, border: '1px solid rgba(255,255,255,0.05)' }}>
                          <span style={{ color: 'var(--muted)' }}>{k}=</span>{formatInputVal(v)}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.formula && (
                    <div style={{ fontSize: 9.5, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', lineHeight: 1.55 }}>
                      <span style={{ color: 'var(--muted)' }}>CALC </span>{m.formula}
                    </div>
                  )}
                  {m.note && (
                    <div style={{ fontSize: 9.5, fontFamily: 'Space Mono, monospace', color: '#ff8a55', lineHeight: 1.55, marginTop: m.formula ? 4 : 0 }}>
                      <span style={{ color: 'var(--muted)' }}>NOTE </span>{m.note} → excluded, weights renormalized
                    </div>
                  )}
                </div>
              );
            })}
            {highContactData.riskFormula && (
              <div style={{ fontSize: 9.5, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', lineHeight: 1.6, padding: '8px 10px', background: 'rgba(0,212,255,0.04)', borderRadius: 3, border: '1px solid rgba(0,212,255,0.12)' }}>
                <span style={{ color: 'var(--cyan)' }}>COMPOSITE </span>{highContactData.riskFormula}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // First-5-innings money-line model (XGBoost) — top-of-tab projection card.
  const F5MoneyLineCard = () => {
    const [open, setOpen] = React.useState(false);
    const f5 = highContactData.f5;
    if (!f5) {
      return (
        <HudCard style={{ padding: '14px 18px', marginBottom: 14 }} accent="var(--dim)">
          <div style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', letterSpacing: '0.08em' }}>
            ◆ F5 MONEY LINE MODEL — unavailable (model not trained yet, or starters unconfirmed)
          </div>
        </HudCard>
      );
    }
    const aw = gameInfo.awayAbbr, hm = gameInfo.homeAbbr;
    const fmtOdds = o => o == null ? '—' : o > 0 ? `+${o}` : `${o}`;
    const fmtNum = (v, d = 4) => v == null ? '—' : Number(v).toFixed(d);
    const rows = [
      { key: 'away', label: aw, p: f5.probs.away, odds: f5.fairOdds.away, color: 'var(--cyan)' },
      { key: 'tie', label: 'TIE', p: f5.probs.tie, odds: f5.fairOdds.tie, color: 'var(--muted)' },
      { key: 'home', label: hm, p: f5.probs.home, odds: f5.fairOdds.home, color: '#ffd060' },
    ];
    const pickLabel = f5.pick === 'home' ? hm : f5.pick === 'away' ? aw : 'TIE';
    const val = f5.model?.val || {};
    return (
      <HudCard style={{ padding: '16px 18px', marginBottom: 14 }} accent="#00ff88">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{ fontSize: 12, fontFamily: 'Orbitron, monospace', fontWeight: 900, color: '#00ff88', letterSpacing: '0.12em' }}>◆ F5 MONEY LINE MODEL</span>
          <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', letterSpacing: '0.1em' }}>XGBoost · who leads after 5 innings</span>
          {val.home_away_auc != null && (
            <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)' }}>val AUC {val.home_away_auc.toFixed(3)}</span>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(r => {
            const pct = Math.round(r.p * 100);
            const isPick = f5.pick === r.key;
            return (
              <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 50, fontSize: 12, fontFamily: 'Orbitron, monospace', fontWeight: 700, color: r.color }}>{r.label}</span>
                <div style={{ flex: 1, height: 10, background: 'rgba(255,255,255,0.05)', borderRadius: 5, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: r.color, boxShadow: `0 0 8px ${r.color}88`, borderRadius: 5, transition: 'width 0.6s cubic-bezier(0.16,1,0.3,1)' }} />
                </div>
                <span style={{ width: 44, textAlign: 'right', fontSize: 16, fontFamily: 'Orbitron, monospace', fontWeight: 900, color: r.color }}>{pct}%</span>
                <span style={{ width: 50, textAlign: 'right', fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)' }}>{fmtOdds(r.odds)}</span>
                <span style={{ width: 56, fontSize: 9.5, color: '#00ff88', fontFamily: 'Orbitron, monospace', fontWeight: 700, letterSpacing: '0.1em' }}>{isPick ? '◄ PICK' : ''}</span>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 10, fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--text)', lineHeight: 1.5 }}>
          Model lean: <span style={{ color: '#00ff88', fontWeight: 700 }}>{pickLabel} F5</span> at {Math.round(f5.probs[f5.pick] * 100)}% (fair {fmtOdds(f5.fairOdds[f5.pick])}).
          <span style={{ color: 'var(--muted)' }}> Compare to the book's F5 line — only bet when it pays more than fair.</span>
        </div>

        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
          <div onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, userSelect: 'none' }}>
            <span style={{ fontSize: 12, color: 'var(--cyan)', display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>▸</span>
            <span style={{ fontSize: 10, color: 'var(--cyan)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.16em', fontWeight: 700 }}>MODEL DETAILS & FEATURES</span>
          </div>
          {open && (
            <div style={{ marginTop: 10, animation: 'fadeUp 0.25s ease' }}>
              <div style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', marginBottom: 8, lineHeight: 1.7 }}>
                <span style={{ color: 'var(--muted)' }}>SOURCE </span>{f5.source}<br />
                <span style={{ color: 'var(--muted)' }}>VALIDATION ({val.split || '—'}) </span>
                log-loss {fmtNum(val.log_loss)} vs base {fmtNum(val.base_rate_log_loss)} / logistic {fmtNum(val.logistic_log_loss)}
                {val.accuracy != null && ` · acc ${(val.accuracy * 100).toFixed(1)}%`}
                {val.home_away_auc != null && ` · home/away AUC ${val.home_away_auc.toFixed(3)}`}
                {val.n_val != null && ` · n=${val.n_val}`}<br />
                <span style={{ color: 'var(--muted)' }}>MODEL </span>{f5.model?.nTrees} trees · trained {f5.model?.trainedAt ? String(f5.model.trainedAt).slice(0, 10) : '—'}
              </div>
              <div style={{ fontSize: 9.5, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.12em', marginBottom: 6 }}>FEATURE VECTOR (entering this game)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {Object.entries(f5.features).map(([k, v]) => (
                  <span key={k} style={{ fontSize: 9.5, fontFamily: 'Space Mono, monospace', color: 'var(--text)', padding: '2px 6px', background: 'rgba(255,255,255,0.03)', borderRadius: 2, border: '1px solid rgba(255,255,255,0.05)' }}>
                    <span style={{ color: 'var(--muted)' }}>{k}=</span>{formatInputVal(v)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </HudCard>
    );
  };

  const PitcherRiskCard = ({ side, color, abbr }) => {
    if (!side?.pitcher) {
      return (
        <HudCard style={{ padding: 18, textAlign: 'center' }} accent="var(--dim)">
          <div style={{ color: 'var(--muted)', fontFamily: 'Space Mono, monospace', fontSize: 10 }}>SP NOT ANNOUNCED</div>
        </HudCard>
      );
    }
    const score = side.riskScore;
    const rc = riskColor(score);
    const subs = side.subscores || {};
    const weights = side.weights || {};
    const cur = side.stats?.current || {};
    const prev = side.stats?.previous || {};

    return (
      <HudCard style={{ padding: 18 }} accent={color}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color, letterSpacing: '0.18em', marginBottom: 4 }}>
              {abbr}{side.pitcher.throws ? ` · ${side.pitcher.throws}HP` : ''}
            </div>
            <div style={{ fontFamily: 'Space Mono, monospace', fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {side.pitcher.name}
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace' }}>vs {side.opponent || '—'}</div>
          </div>
          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <RiskGauge score={score} color={rc} />
            <div style={{ fontSize: 10, color: rc, fontFamily: 'Space Mono, monospace', fontWeight: 700, letterSpacing: '0.18em', marginTop: 4 }}>
              {side.riskLevel || '—'} RISK
            </div>
          </div>
        </div>

        <div style={{ paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.04)', marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.18em', marginBottom: 8 }}>BREAKDOWN <SourceTag>sources + math below ▾</SourceTag></div>
          {SUB_ORDER.map(key => {
            const raw = subs[key];
            const w = weights[key] || 0;
            const present = raw != null;
            const subColor = present ? riskColor(raw) : 'var(--muted)';
            return (
              <div key={key} style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.1em' }}>
                    {SUB_LABELS[key]} <span style={{ color: 'var(--muted)' }}>· {Math.round(w * 100)}%</span>
                  </span>
                  <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: subColor, fontWeight: 700 }}>
                    {present ? raw : '—'}
                  </span>
                </div>
                <div style={{ height: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${present ? raw : 0}%`, background: subColor,
                    boxShadow: present ? `0 0 6px ${subColor}66` : 'none', borderRadius: 2,
                    transition: 'width 0.5s cubic-bezier(0.16,1,0.3,1)' }} />
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.04)', marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.18em', marginBottom: 8 }}>PITCHER · CURRENT vs PREV <SourceTag>MLB Stats API</SourceTag></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {[
              ['ERA',   cur.era,    prev.era,    v => v != null ? Number(v).toFixed(2) : '—'],
              ['WHIP',  cur.whip,   prev.whip,   v => v != null ? Number(v).toFixed(2) : '—'],
              ['H/9',   cur.h9,     prev.h9,     v => v != null ? Number(v).toFixed(1) : '—'],
              ['K/9',   cur.k9,     prev.k9,     v => v != null ? Number(v).toFixed(1) : '—'],
              ['BB/9',  cur.bb9,    prev.bb9,    v => v != null ? Number(v).toFixed(1) : '—'],
              ['oAVG',  cur.oppAvg, prev.oppAvg, v => v != null ? Number(v).toFixed(3) : '—'],
              ['oOPS',  cur.oppOps, prev.oppOps, v => v != null ? Number(v).toFixed(3) : '—'],
              ['HR/9',  cur.hrPer9, prev.hrPer9, v => v != null ? Number(v).toFixed(2) : '—'],
            ].map(([l, c, p, fmt]) => (
              <div key={l} style={{ padding: '7px 6px', background: 'var(--surface)', borderRadius: 3, textAlign: 'center' }}>
                <div style={{ fontSize: 9.5, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.1em', marginBottom: 3 }}>{l}</div>
                <div style={{ fontSize: 13, fontFamily: 'Orbitron, monospace', color, fontWeight: 700, lineHeight: 1 }}>{fmt(c)}</div>
                <div style={{ fontSize: 9.5, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', marginTop: 3 }}>prev: {fmt(p)}</div>
              </div>
            ))}
          </div>
        </div>

        {side.arsenal?.length > 0 && (
          <div style={{ paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.04)', marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.18em', marginBottom: 8 }}>
              ARSENAL · TOP {Math.min(side.arsenal.length, 5)} PITCHES <SourceTag>Baseball Savant · Statcast</SourceTag>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {side.arsenal.slice(0, 5).map((p, i) => {
                const xw = p.xwoba;
                const xwColor = xw == null ? 'var(--muted)' :
                                xw >= 0.380 ? '#ff6b35' :
                                xw >= 0.330 ? '#ffd060' :
                                xw >= 0.290 ? 'var(--cyan)' : '#00ff88';
                return (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 50px 75px 60px', gap: 8, alignItems: 'center', padding: '4px 6px', background: i === 0 ? 'rgba(255,255,255,0.02)' : 'transparent', borderRadius: 2 }}>
                    <div style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                    <div style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', textAlign: 'right' }}>{p.usage ? `${p.usage.toFixed(0)}%` : '—'}</div>
                    <div style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: xwColor, fontWeight: 700, textAlign: 'right' }}>
                      xwOBA {xw != null ? xw.toFixed(3) : '—'}
                    </div>
                    <div style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', textAlign: 'right' }}>
                      whiff {p.whiffPct != null ? `${p.whiffPct.toFixed(0)}%` : '—'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {side.oppHandSplits && (
          <div style={{ paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.04)', marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.18em', marginBottom: 8 }}>
              {side.opponent ? side.opponent.toUpperCase() : 'OPP'} vs {side.pitcher.throws === 'L' ? 'LHP' : 'RHP'} <SourceTag>MLB Stats API · statSplits</SourceTag>
            </div>
            {(() => {
              const sp = side.pitcher.throws === 'L' ? side.oppHandSplits.vsL : side.oppHandSplits.vsR;
              if (!sp) return <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace' }}>NO SPLIT DATA</div>;
              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                  {[['AVG', sp.avg], ['OBP', sp.obp], ['SLG', sp.slg], ['OPS', sp.ops]].map(([l, v]) => (
                    <div key={l} style={{ padding: '6px 4px', textAlign: 'center', background: 'var(--surface)', borderRadius: 3 }}>
                      <div style={{ fontSize: 9.5, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.1em', marginBottom: 2 }}>{l}</div>
                      <div style={{ fontSize: 12, fontFamily: 'Orbitron, monospace', color: 'var(--text)', fontWeight: 700 }}>
                        {v != null ? v.toFixed(3) : '—'}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        <div style={{ paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.04)', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          {side.bullpen ? (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.15em' }}>BULLPEN <SourceTag>MLB Stats API</SourceTag></span>
              <span style={{ fontSize: 11, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700 }}>
                {side.bullpen.era != null ? side.bullpen.era.toFixed(2) : '—'} ERA
              </span>
              <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)' }}>
                {side.bullpen.whip != null ? side.bullpen.whip.toFixed(2) : '—'} WHIP
              </span>
            </div>
          ) : (
            <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace' }}>BULLPEN —</span>
          )}
          {side.weather && <WeatherPill weather={side.weather} />}
        </div>

        <div style={{ padding: '10px 12px', background: `${rc}10`, border: `1px solid ${rc}33`, borderRadius: 3 }}>
          <div style={{ fontSize: 9.5, color: rc, fontFamily: 'Space Mono, monospace', letterSpacing: '0.2em', marginBottom: 4 }}>ANGLE</div>
          <div style={{ fontSize: 11, color: 'var(--text)', fontFamily: 'Space Mono, monospace', lineHeight: 1.5 }}>{angleFor(side)}</div>
        </div>

        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.04)', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {[
            ['pitcherStats', 'STATS'],
            ['prevSeasonStats', 'PREV'],
            ['arsenal', 'ARSENAL'],
            ['lineupPosted', 'LINEUP'],
            ['oppHandSplits', 'SPLITS'],
            ['bullpen', 'PEN'],
            ['weather', 'WX'],
            ['bvpSample', 'BvP'],
          ].map(([key, lbl]) => {
            const ok = side.verified?.[key];
            return (
              <span key={key} style={{ fontSize: 9.5, padding: '2px 6px', borderRadius: 2, fontFamily: 'Space Mono, monospace', letterSpacing: '0.1em',
                color: ok ? '#00ff88' : 'var(--muted)',
                background: ok ? 'rgba(0,255,136,0.08)' : 'transparent',
                border: `1px solid ${ok ? 'rgba(0,255,136,0.25)' : 'rgba(255,255,255,0.05)'}` }}>
                {ok ? '✓' : '○'} {lbl}
              </span>
            );
          })}
        </div>

        <MethodologyPanel side={side} />
      </HudCard>
    );
  };

  return (
    <div style={{ padding: '20px 0' }}>
      <SectionHeader
        label="HIGH-CONTACT PITCHING"
        sub="Weighted hit-risk score · MLB Stats API + Baseball Savant · expand METHODOLOGY on each card to verify every number"
      />
      <F5MoneyLineCard />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 12 }}>
        <PitcherRiskCard side={highContactData.away} color="var(--cyan)" abbr={gameInfo.awayAbbr} />
        <PitcherRiskCard side={highContactData.home} color="#ffd060" abbr={gameInfo.homeAbbr} />
      </div>
    </div>
  );
}

function RiskGauge({ score, color, size = 90 }) {
  const r = size * 0.40, cx = size / 2, cy = size / 2, sw = size * 0.085;
  const pct = score == null ? 0 : Math.max(0, Math.min(score, 100)) / 100;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={sw} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={sw}
        strokeDasharray={`${circ * pct} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: 'stroke-dasharray 0.9s cubic-bezier(0.16,1,0.3,1)' }} />
      <text x={cx} y={cy + size * 0.06} textAnchor="middle" fill={color}
        fontSize={size * 0.32} fontFamily="Orbitron, monospace" fontWeight="700">
        {score != null ? score : '—'}
      </text>
    </svg>
  );
}

/* ── LOW HOME RUN MODEL TAB ──────────────────────────────
   Visualizes /api/mlb/low-hr-model: Under-0.5-HR parlay candidates
   scored on the 13-point blueprint (SP HR/9 rank, 0 HR BvP, no-HR
   rate ≥94%, ISO, barrel%, SP ground-ball lean, park, wind, lineup
   spot) with a park/weather strip, both starters' HR-suppression
   profiles, a suggested 2-4 leg slip, and per-batter score cards. */
function LowHrModelTab({ gameData }) {
  const { gameInfo, lowHrData } = gameData;
  const [filter, setFilter] = React.useState('all');

  const loadPhase = useMlbLoadGate(gameData?._loading?.lowHrData !== false, !!lowHrData);
  if (loadPhase !== 'ready') return <MlbDataLoader phase={loadPhase} source="Baseball Savant" label="Scoring Under 0.5 HR candidates…" />;
  if (!lowHrData) return <div style={emptyMsg}>Low HR model unavailable — lineups may not be posted yet.</div>;

  const { park, weather, windFlag, pitchers, candidates = [], slip = [], leagueAvgHr9 } = lowHrData;

  const ratingColor = r => r === 'STRONG' ? '#00ff88' : r === 'DECENT' ? '#ffd060' : '#ff6b35';
  const sideColor = s => s === 'away' ? 'var(--cyan)' : '#ffd060';
  const sideAbbr = s => s === 'away' ? gameInfo.awayAbbr : gameInfo.homeAbbr;
  const fmtOdds = o => o == null ? '—' : o > 0 ? `+${o}` : String(o);

  const counts = {
    all: candidates.length,
    strong: candidates.filter(c => c.rating === 'STRONG').length,
    decent: candidates.filter(c => c.rating === 'DECENT').length,
  };
  const displayed = filter === 'all' ? candidates : candidates.filter(c => c.rating === filter.toUpperCase());

  const windChip = {
    OUT:     { color: '#ff6b35', label: '⚠ WIND OUT' },
    IN:      { color: '#00ff88', label: '✓ WIND IN' },
    DOME:    { color: 'var(--cyan)', label: '● DOME / ROOF CLOSED' },
    NEUTRAL: { color: 'var(--muted)', label: '○ WIND NEUTRAL' },
  }[windFlag] || { color: 'var(--muted)', label: '—' };

  const parkColor = park?.classification === 'HR-SUPPRESSING' ? '#00ff88'
    : park?.classification === 'HR-FRIENDLY' ? '#ff6b35'
    : park?.classification === 'NEUTRAL' ? '#ffd060' : 'var(--muted)';
  // Park factor bar: 80 (Oracle) → 0%, 125 (Great American) → 100%
  const parkPct = park?.factor != null ? Math.max(0, Math.min(100, (park.factor - 80) / 45 * 100)) : 0;

  const SpHrCard = ({ p, abbr, color, oppAbbr }) => {
    if (!p) {
      return (
        <HudCard style={{ padding: 18, textAlign: 'center' }} accent="var(--dim)">
          <div style={{ color: 'var(--muted)', fontFamily: 'Space Mono, monospace', fontSize: 10 }}>SP NOT ANNOUNCED</div>
        </HudCard>
      );
    }
    const hr9Color = p.hrPer9 == null ? 'var(--muted)' : p.hrPer9 <= 0.80 ? '#00ff88' : p.hrPer9 <= 1.10 ? '#ffd060' : '#ff6b35';
    return (
      <HudCard style={{ padding: 18 }} accent={color}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color, letterSpacing: '0.18em', marginBottom: 4 }}>
              {abbr}{p.throws ? ` · ${p.throws}HP` : ''} · vs {oppAbbr} LINEUP
            </div>
            <div style={{ fontFamily: 'Space Mono, monospace', fontSize: 15, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.name}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {p.top15 && (
                <span style={{ fontSize: 10, padding: '2px 8px', background: 'rgba(0,255,136,0.12)', border: '1px solid rgba(0,255,136,0.35)', color: '#00ff88', fontFamily: 'Orbitron, monospace', fontWeight: 700, borderRadius: 2, letterSpacing: '0.12em' }}>
                  ★ TOP-15 LOW HR/9
                </span>
              )}
              {p.rank != null && (
                <span style={{ fontSize: 10, padding: '2px 8px', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--muted)', fontFamily: 'Space Mono, monospace', borderRadius: 2 }}>
                  RANK #{p.rank}/{p.totalRanked}
                </span>
              )}
            </div>
          </div>
          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <div style={{ fontSize: 9.5, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.16em', marginBottom: 2 }}>HR/9</div>
            <div style={{ fontSize: 30, fontFamily: 'Orbitron, monospace', fontWeight: 900, color: hr9Color, lineHeight: 1 }}>
              {p.hrPer9 != null ? p.hrPer9.toFixed(2) : '—'}
            </div>
            <div style={{ fontSize: 9.5, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', marginTop: 3 }}>
              lg avg {leagueAvgHr9 != null ? leagueAvgHr9.toFixed(2) : '—'}
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
          {[
            ['GO/AO', p.goAo != null ? p.goAo.toFixed(2) : '—', p.goAo != null && p.goAo >= 1.3 ? '#00ff88' : 'var(--text)'],
            ['BRL% ALW', p.barrelPctAllowed != null ? `${p.barrelPctAllowed.toFixed(1)}%` : '—', p.barrelPctAllowed != null && p.barrelPctAllowed < 6 ? '#00ff88' : 'var(--text)'],
            ['HH% ALW', p.hardHitPctAllowed != null ? `${p.hardHitPctAllowed.toFixed(1)}%` : '—', 'var(--text)'],
            ['HR L3 GM', p.hrLast3 != null ? `${p.hrLast3}` : '—', p.hrLast3 != null && p.hrLast3 === 0 ? '#00ff88' : p.hrLast3 >= 3 ? '#ff6b35' : 'var(--text)'],
          ].map(([l, v, c]) => (
            <div key={l} style={{ textAlign: 'center', padding: '7px 4px', background: 'var(--surface)', borderRadius: 3 }}>
              <div style={{ fontSize: 9.5, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.08em', marginBottom: 3 }}>{l}</div>
              <div style={{ fontSize: 14, fontFamily: 'Orbitron, monospace', color: c, fontWeight: 700 }}>{v}</div>
            </div>
          ))}
        </div>
      </HudCard>
    );
  };

  const CandidateCard = ({ c }) => {
    const rc = ratingColor(c.rating);
    const tc = sideColor(c.side);
    const headshot = c.id
      ? `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current/w_426,q_auto:best/v1/people/${c.id}/headshot/67/current`
      : null;
    return (
      <HudCard style={{ padding: '16px 18px' }} accent={rc}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <PlayerCard player={{ name: c.name, headshot, pos: c.position }} size="md" accent={tc} />
          <div style={{ flex: 1, minWidth: 170 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700 }}>{c.name}</span>
              <span style={{ fontSize: 10, padding: '2px 7px', border: `1px solid ${tc}66`, color: tc, fontFamily: 'Space Mono, monospace', borderRadius: 2, letterSpacing: '0.08em' }}>{sideAbbr(c.side)}</span>
              {c.order && (
                <span style={{ fontSize: 10, padding: '2px 7px', border: '1px solid rgba(255,255,255,0.1)', color: c.order >= 7 ? '#00ff88' : 'var(--muted)', fontFamily: 'Space Mono, monospace', borderRadius: 2 }}>
                  BATS #{c.order}
                </span>
              )}
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace' }}>
              vs {c.pitcher || 'TBD'}{c.pitcherThrows ? ` (${c.pitcherThrows}HP)` : ''}
              {c.bvp ? ` · BvP ${c.bvp.hr} HR / ${c.bvp.pa} PA` : ' · no BvP history'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 9.5, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.14em', marginBottom: 2 }}>MODEL NO-HR</div>
              <div style={{ fontSize: 20, fontFamily: 'Orbitron, monospace', fontWeight: 700, color: rc }}>
                {c.modelNoHrPct != null ? `${c.modelNoHrPct.toFixed(1)}%` : '—'}
              </div>
              <div style={{ fontSize: 9.5, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', marginTop: 1 }}>fair {fmtOdds(c.fairOdds)}</div>
            </div>
            <div style={{ textAlign: 'center', padding: '6px 12px', background: `${rc}10`, border: `1px solid ${rc}33`, borderRadius: 3 }}>
              <div style={{ fontSize: 22, fontFamily: 'Orbitron, monospace', fontWeight: 900, color: rc, lineHeight: 1 }}>
                {c.score}<span style={{ fontSize: 11, color: 'var(--muted)' }}>/{c.maxScore}</span>
              </div>
              <div style={{ fontSize: 9.5, color: rc, fontFamily: 'Space Mono, monospace', letterSpacing: '0.16em', marginTop: 3, fontWeight: 700 }}>{c.rating}</div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
          {(c.breakdown || []).map(b => {
            const full = b.pts >= b.max;
            const partial = b.pts > 0 && b.pts < b.max;
            const bc = full ? '#00ff88' : partial ? '#ffd060' : 'var(--muted)';
            return (
              <span key={b.key} title={b.detail} style={{ fontSize: 9.5, padding: '3px 7px', borderRadius: 2, fontFamily: 'Space Mono, monospace', letterSpacing: '0.06em', cursor: 'help',
                color: bc,
                background: b.pts > 0 ? `${full ? 'rgba(0,255,136,0.08)' : 'rgba(255,208,96,0.08)'}` : 'transparent',
                border: `1px solid ${b.pts > 0 ? (full ? 'rgba(0,255,136,0.25)' : 'rgba(255,208,96,0.25)') : 'rgba(255,255,255,0.05)'}` }}>
                {b.pts > 0 ? '✓' : '○'} +{b.pts} {b.label}
              </span>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
          {[
            ['NO-HR RATE', c.season?.gameNoHrPct != null ? `${c.season.gameNoHrPct.toFixed(1)}%` : '—'],
            ['ISO', c.season?.iso != null ? c.season.iso.toFixed(3) : '—'],
            ['BRL%', c.statcast?.barrelPct != null ? `${c.statcast.barrelPct.toFixed(1)}%` : '—'],
            ['SZN HR', c.season?.hr != null ? `${c.season.hr} in ${c.season.pa} PA` : '—'],
            ['L15 HR', c.recent ? `${c.recent.hr15}` : '—'],
          ].map(([l, v]) => (
            <span key={l} style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)' }}>
              <span style={{ color: 'var(--muted)', letterSpacing: '0.1em' }}>{l}</span> <span style={{ color: 'var(--text)', fontWeight: 700 }}>{v}</span>
            </span>
          ))}
          {(c.flags || []).map(f => (
            <span key={f} style={{ fontSize: 9.5, padding: '2px 7px', borderRadius: 2, fontFamily: 'Space Mono, monospace', letterSpacing: '0.08em',
              color: '#ff6b35', background: 'rgba(255,107,53,0.08)', border: '1px solid rgba(255,107,53,0.25)' }}>
              ⚠ {f}
            </span>
          ))}
        </div>
      </HudCard>
    );
  };

  return (
    <div style={{ padding: '20px 0' }}>
      <SectionHeader
        label="LOW HOME RUN MODEL"
        sub="Under 0.5 HR slip builder · SP HR/9 rank + BvP history + no-HR rate + park & wind · 13-pt score"
      />

      {/* Park + weather context strip */}
      <HudCard style={{ padding: '14px 18px', marginBottom: 12 }} accent={parkColor}>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.18em', marginBottom: 4 }}>BALLPARK</div>
            <div style={{ fontSize: 13, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700, marginBottom: 6 }}>
              {park?.venue || 'Unknown venue'}
              {park?.roofType ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {park.roofType}</span> : null}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, maxWidth: 220, height: 5, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${parkPct}%`, background: parkColor, boxShadow: `0 0 8px ${parkColor}88`, borderRadius: 2, transition: 'width 0.7s cubic-bezier(0.16,1,0.3,1)' }} />
              </div>
              <span style={{ fontSize: 12, fontFamily: 'Orbitron, monospace', color: parkColor, fontWeight: 700 }}>
                {park?.factor != null ? park.factor : '—'}
              </span>
              <span style={{ fontSize: 10, padding: '2px 8px', border: `1px solid ${parkColor}44`, color: parkColor, fontFamily: 'Space Mono, monospace', borderRadius: 2, letterSpacing: '0.1em' }}>
                {park?.classification || 'UNKNOWN'}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, padding: '4px 10px', border: `1px solid ${windChip.color}44`, color: windChip.color, fontFamily: 'Space Mono, monospace', borderRadius: 2, letterSpacing: '0.1em', fontWeight: 700 }}>
              {windChip.label}
            </span>
            {weather && <WeatherPill weather={weather} />}
          </div>
        </div>
      </HudCard>

      {/* Both starters' HR-suppression profile */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 12, marginBottom: 12 }}>
        <SpHrCard p={pitchers?.away} abbr={gameInfo.awayAbbr} color="var(--cyan)" oppAbbr={gameInfo.homeAbbr} />
        <SpHrCard p={pitchers?.home} abbr={gameInfo.homeAbbr} color="#ffd060" oppAbbr={gameInfo.awayAbbr} />
      </div>

      {/* Suggested slip */}
      <HudCard style={{ padding: '16px 18px', marginBottom: 16 }} accent={slip.length ? '#00ff88' : 'var(--muted)'}>
        <div style={{ fontSize: 10, color: slip.length ? '#00ff88' : 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.22em', marginBottom: 10 }}>
          ◆ SUGGESTED SLIP — UNDER 0.5 HR PARLAY
        </div>
        {slip.length ? (
          <>
            {slip.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', marginBottom: 4, background: 'rgba(255,255,255,0.02)', borderRadius: 3, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontFamily: 'Orbitron, monospace', fontWeight: 900, color: '#00ff88', width: 18 }}>{i + 1}</span>
                <span style={{ fontSize: 12, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700, flex: 1, minWidth: 140 }}>
                  {s.name} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>UNDER 0.5 HR</span>
                </span>
                <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: sideColor(s.side) }}>{sideAbbr(s.side)} · #{s.order || '—'}</span>
                <span style={{ fontSize: 10, fontFamily: 'Orbitron, monospace', color: ratingColor(s.rating), fontWeight: 700 }}>{s.score}/{s.maxScore}</span>
                <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--text)' }}>
                  {s.modelNoHrPct != null ? `${s.modelNoHrPct.toFixed(1)}%` : '—'} <span style={{ color: 'var(--muted)' }}>fair {fmtOdds(s.fairOdds)}</span>
                </span>
              </div>
            ))}
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', marginTop: 8, lineHeight: 1.6 }}>
              Only bet when model probability beats the book's implied probability — compare "fair" odds vs the listed price.
              Parlay risk stacks: 2-3 legs preferred over 4.
            </div>
          </>
        ) : (
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace' }}>
            No 2+ qualifying legs (score ≥ 7) yet — wait for confirmed lineups or skip this slate.
          </div>
        )}
      </HudCard>

      {/* Rating filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {[['all', `ALL (${counts.all})`], ['strong', `STRONG 10+ (${counts.strong})`], ['decent', `DECENT 7-9 (${counts.decent})`]].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)}
            style={{ padding: '6px 14px', background: filter === k ? 'rgba(0,212,255,0.1)' : 'transparent',
              border: `1px solid ${filter === k ? 'rgba(0,212,255,0.3)' : 'rgba(255,255,255,0.06)'}`,
              color: filter === k ? 'var(--cyan)' : 'var(--muted)', fontFamily: 'Space Mono, monospace',
              fontSize: 10, cursor: 'pointer', borderRadius: 2, letterSpacing: '0.08em' }}>
            {l}
          </button>
        ))}
      </div>

      {/* Candidate cards */}
      {displayed.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {displayed.map((c, i) => <CandidateCard key={`${c.id || c.name}-${i}`} c={c} />)}
        </div>
      ) : (
        <div style={emptyMsg}>
          {candidates.length ? 'No candidates match this filter.' : 'No scored batters yet — lineups may not be posted.'}
        </div>
      )}
    </div>
  );
}

/* ── MLB LINEUP — 3D FIELD VIEW ──────────────────────────
   Places each hitter's card at the fielding position they're starting at,
   on a perspective-tilted diamond. The FIELD is rotated in 3D (rotateX) but
   each card is counter-rotated by the same angle so headshots/text stay
   crisp and the cards remain real, clickable DOM — readable at any tilt and
   fast on mobile (no WebGL). DH / PH / PR don't field, so they go to a
   dugout strip instead of being faked onto a position. */

// Fielders sit at ~75-80% of the distance to the wall — verified by rendering
// the SVG, which is how the original numbers were caught putting the outfield
// BEYOND the fence. Keep spots and MLB_FAIR_PATH in sync if either changes.
const MLB_FIELD_SPOTS = [
  { pos: 'CF', x: 50, y: 22 },
  { pos: 'LF', x: 21, y: 32 },
  { pos: 'RF', x: 79, y: 32 },
  { pos: 'SS', x: 37, y: 45 },
  { pos: '2B', x: 63, y: 45 },
  { pos: '3B', x: 26, y: 60 },
  { pos: '1B', x: 74, y: 60 },
  { pos: 'P',  x: 50, y: 63 },
  { pos: 'C',  x: 50, y: 93 },
];
// Fair territory outline — reused for the grass fill, mow-stripe clip and the
// outfield-grass logo watermark so they all share one silhouette.
const MLB_FAIR_PATH = 'M 50,87 L 5,40 Q 50,-16 95,40 Z';
// Players deep in the outfield read smaller; amplifies the perspective so the
// eye instantly sorts infield from outfield.
const mlbDepthScale = y => 0.80 + 0.32 * (y / 100);
const MLB_FIELD_POS_SET = new Set(MLB_FIELD_SPOTS.map(s => s.pos));
const MLB_TILT_PRESETS = [['BROADCAST', 58], ['ANGLED', 36], ['OVERHEAD', 6]];
const mlbHeadshot = id => id
  ? `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current/w_426,q_auto:best/v1/people/${id}/headshot/67/current`
  : null;
const mlbLastName = n => String(n || '').trim().split(/\s+/).slice(-1)[0] || '—';

// Mowing stripes: wedges radiating from home plate, clipped to fair territory.
function mlbGrassWedges() {
  const hx = 50, hy = 87, R = 130, out = [];
  for (let a = -47; a < 47; a += 11.75) {
    const p = deg => [hx + R * Math.sin(deg * Math.PI / 180), hy - R * Math.cos(deg * Math.PI / 180)];
    const [x1, y1] = p(a), [x2, y2] = p(a + 11.75);
    out.push(`M ${hx},${hy} L ${x1.toFixed(1)},${y1.toFixed(1)} L ${x2.toFixed(1)},${y2.toFixed(1)} Z`);
  }
  return out;
}

function MlbLineupFieldTab({ gameData }) {
  const { gameInfo, mlbLineups, mlbPropModel } = gameData;
  const [side, setSide] = React.useState('away');
  const [tilt, setTilt] = React.useState(58);
  const [selId, setSelId] = React.useState(null);

  const loadPhase = useMlbLoadGate(gameData?._loading?.mlbLineups !== false, !!mlbLineups);
  if (loadPhase !== 'ready') return <MlbDataLoader phase={loadPhase} source="MLB Stats API" label="Loading the lineup card…" />;
  if (!mlbLineups) return <div style={emptyMsg}>Lineup data unavailable.</div>;

  const team = mlbLineups[side] || {};
  const lineup = team.lineup || [];
  const accent = side === 'away' ? 'var(--cyan)' : '#ffd060';
  const accentRaw = side === 'away' ? '#00d4ff' : '#ffd060';
  const abbr = side === 'away' ? gameInfo.awayAbbr : gameInfo.homeAbbr;
  const logo = side === 'away' ? gameInfo.awayLogo : gameInfo.homeLogo;
  const posted = lineup.length >= 9;
  // Mid-game the MLB boxscore batting order reflects substitutions, so the
  // field genuinely shows who is out there right now.
  const isLive = gameInfo.statusState === 'in';

  // Slot each hitter onto the field; non-fielders (DH/PH/PR) go to the dugout.
  const byPos = {};
  const dugout = [];
  for (const b of lineup) {
    const p = String(b.position || '').toUpperCase();
    if (MLB_FIELD_POS_SET.has(p) && !byPos[p]) byPos[p] = b;
    else dugout.push(b);
  }
  if (!byPos.P && team.probablePitcher) {
    byPos.P = { ...team.probablePitcher, position: 'P', order: null, isSP: true };
  }

  const propsFor = id => (mlbPropModel?.[side] || []).find(b => String(b.id) === String(id)) || null;
  const selected = selId
    ? (lineup.find(b => String(b.id) === String(selId))
       || (byPos.P && String(byPos.P.id) === String(selId) ? byPos.P : null))
    : null;

  const FieldCard = ({ spot, player, idx }) => {
    const isSel = player && String(player.id) === String(selId);
    const dim = selId && !isSel;                       // focus mode: fade the rest
    const depth = mlbDepthScale(spot.y);
    const size = player ? 50 : 30;
    return (
      <div style={{ position: 'absolute', left: `${spot.x}%`, top: `${spot.y}%`, width: 0, height: 0,
        transformStyle: 'preserve-3d', zIndex: isSel ? 30 : Math.round(spot.y) }}>
        {/* contact shadow stays flat on the grass — this is what sells the depth */}
        <div style={{ position: 'absolute', left: -26 * depth, top: -6, width: 52 * depth, height: 13 * depth,
          borderRadius: '50%', background: 'rgba(0,0,0,0.55)', filter: 'blur(4px)', pointerEvents: 'none',
          opacity: dim ? 0.3 : 1, transition: 'opacity 0.25s' }} />
        <div
          onClick={() => player && setSelId(isSel ? null : String(player.id))}
          title={player ? `${player.name} · ${spot.pos}${player.order ? ` · bats ${player.order}` : ''}` : `${spot.pos} — not posted`}
          style={{
            position: 'absolute', bottom: 0, left: 0,
            transform: `translateX(-50%) rotateX(-${tilt}deg) scale(${depth * (isSel ? 1.18 : 1)})`,
            transformOrigin: 'center bottom',
            transition: 'transform 0.3s cubic-bezier(0.16,1,0.3,1), opacity 0.25s',
            opacity: dim ? 0.42 : 1,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            cursor: player ? 'pointer' : 'default', userSelect: 'none',
            animation: `fadeUp 0.45s ease ${idx * 50}ms backwards`,
          }}>
          {player ? (
            <>
              <div style={{ position: 'relative' }}>
                {/* halo pool under the portrait for separation against grass */}
                <div style={{ position: 'absolute', inset: -5, borderRadius: '50%',
                  background: `radial-gradient(circle, ${accentRaw}33 0%, transparent 70%)`, pointerEvents: 'none' }} />
                <div style={{ position: 'relative', width: size, height: size, borderRadius: '50%', overflow: 'hidden',
                  border: `2.5px solid ${isSel ? accentRaw : accentRaw + 'aa'}`,
                  background: 'linear-gradient(180deg, #16223a 0%, #0d1524 100%)',
                  boxShadow: isSel ? `0 0 22px ${accentRaw}, 0 6px 14px rgba(0,0,0,0.6)` : `0 0 10px ${accentRaw}55, 0 5px 12px rgba(0,0,0,0.55)` }}>
                  <img src={mlbHeadshot(player.id)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={e => { e.target.style.display = 'none'; }} />
                </div>
                {player.order != null && (
                  <div style={{ position: 'absolute', top: -3, left: -7, minWidth: 18, height: 18, padding: '0 3px', borderRadius: 9,
                    background: 'var(--bg)', border: `1.5px solid ${accentRaw}`, color: accentRaw,
                    fontFamily: 'Orbitron, monospace', fontSize: 10, fontWeight: 900, lineHeight: '15px',
                    textAlign: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.5)' }}>{player.order}</div>
                )}
                {player.isSP && (
                  <div style={{ position: 'absolute', top: -3, left: -10, padding: '1px 5px', borderRadius: 3,
                    background: 'var(--bg)', border: '1.5px solid rgba(0,255,136,0.6)', color: '#00ff88',
                    fontFamily: 'Orbitron, monospace', fontSize: 9.5, fontWeight: 900, letterSpacing: '0.08em',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.5)' }}>SP</div>
                )}
              </div>
              {/* name plate — the primary "who is that" signal */}
              <div style={{ padding: '2px 7px', borderRadius: 3, background: 'rgba(5,8,15,0.94)',
                border: `1px solid ${accentRaw}66`, whiteSpace: 'nowrap', backdropFilter: 'blur(2px)',
                boxShadow: '0 3px 8px rgba(0,0,0,0.45)' }}>
                <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700, letterSpacing: '0.02em' }}>
                  {mlbLastName(player.name)}
                </span>
                <span style={{ fontSize: 9.5, fontFamily: 'Orbitron, monospace', color: accentRaw, marginLeft: 5, letterSpacing: '0.08em' }}>
                  {spot.pos}
                </span>
              </div>
            </>
          ) : (
            <>
              <div style={{ width: size, height: size, borderRadius: '50%', border: '1.5px dashed rgba(255,255,255,0.22)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(5,8,15,0.35)' }}>
                <span style={{ fontSize: 10, fontFamily: 'Orbitron, monospace', color: 'var(--muted)', letterSpacing: '0.1em' }}>{spot.pos}</span>
              </div>
              <span style={{ fontSize: 9.5, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', letterSpacing: '0.1em' }}>—</span>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: '20px 0' }}>
      <SectionHeader label="LINEUP — FIELD VIEW"
        sub="Every starter placed at the position they're playing · tap a card for their projection" />

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {[['away', gameInfo.awayAbbr], ['home', gameInfo.homeAbbr]].map(([v, l]) => (
            <button key={v} onClick={() => { setSide(v); setSelId(null); }}
              style={{ padding: '6px 16px', background: side === v ? `${v === 'away' ? 'rgba(0,212,255,0.12)' : 'rgba(255,208,96,0.12)'}` : 'transparent',
                border: `1px solid ${side === v ? (v === 'away' ? 'rgba(0,212,255,0.45)' : 'rgba(255,208,96,0.45)') : 'rgba(255,255,255,0.08)'}`,
                color: side === v ? (v === 'away' ? 'var(--cyan)' : '#ffd060') : 'var(--muted)',
                fontFamily: 'Orbitron, monospace', fontWeight: 700, fontSize: 11, cursor: 'pointer',
                borderRadius: 2, letterSpacing: '0.1em' }}>{l}</button>
          ))}
        </div>
        {isLive && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, padding: '3px 9px', borderRadius: 2,
            fontFamily: 'Space Mono, monospace', letterSpacing: '0.12em', color: '#00ff88',
            background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.4)' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#00ff88',
              boxShadow: '0 0 6px #00ff88', animation: 'livePulse 1.6s ease-in-out infinite' }} />
            ON THE FIELD NOW
          </span>
        )}
        <span style={{ fontSize: 10, padding: '3px 9px', borderRadius: 2, fontFamily: 'Space Mono, monospace', letterSpacing: '0.1em',
          color: posted ? '#00ff88' : '#ffd060',
          background: posted ? 'rgba(0,255,136,0.1)' : 'rgba(255,208,96,0.1)',
          border: `1px solid ${posted ? 'rgba(0,255,136,0.35)' : 'rgba(255,208,96,0.35)'}` }}>
          {posted ? '✓ LINEUP CONFIRMED' : '◐ LINEUP NOT POSTED'}
        </span>
        {gameInfo.venue && (
          <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.06em' }}>
            {gameInfo.venue}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 9.5, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.14em' }}>CAMERA</span>
          {MLB_TILT_PRESETS.map(([l, deg]) => (
            <button key={l} onClick={() => setTilt(deg)}
              style={{ padding: '4px 9px', background: tilt === deg ? 'rgba(0,212,255,0.1)' : 'transparent',
                border: `1px solid ${tilt === deg ? 'rgba(0,212,255,0.35)' : 'rgba(255,255,255,0.07)'}`,
                color: tilt === deg ? 'var(--cyan)' : 'var(--muted)', fontFamily: 'Space Mono, monospace',
                fontSize: 9.5, cursor: 'pointer', borderRadius: 2, letterSpacing: '0.08em' }}>{l}</button>
          ))}
        </div>
      </div>

      {!posted && (
        <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', marginBottom: 10, lineHeight: 1.6 }}>
          Batting order usually posts ~2–3h before first pitch. The starting pitcher is already on the mound; the other
          spots fill in automatically once {abbr} releases the card.
        </div>
      )}

      {/* ── The field ── */}
      <div style={{ perspective: '1150px', perspectiveOrigin: '50% 42%', marginBottom: 18 }}>
        <div style={{ position: 'relative', width: '100%', maxWidth: 780, margin: '0 auto', aspectRatio: '5 / 4',
          transform: `rotateX(${tilt}deg)`, transformOrigin: 'center 72%', transformStyle: 'preserve-3d',
          transition: 'transform 0.5s cubic-bezier(0.16,1,0.3,1)' }}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            <defs>
              <linearGradient id="piqGrass" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#14472c" /><stop offset="55%" stopColor="#0d3320" /><stop offset="100%" stopColor="#082015" />
              </linearGradient>
              <linearGradient id="piqDirt" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3f2e1c" /><stop offset="100%" stopColor="#2a1e12" />
              </linearGradient>
              <radialGradient id="piqLight" cx="50%" cy="12%" r="82%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.11" />
                <stop offset="45%" stopColor="#ffffff" stopOpacity="0.025" />
                <stop offset="100%" stopColor="#000000" stopOpacity="0.42" />
              </radialGradient>
              <clipPath id="piqFair"><path d={MLB_FAIR_PATH} /></clipPath>
            </defs>

            {/* stadium bowl — foul territory + stands ringing the field */}
            <path d="M 50,95 L -10,36 Q 50,-36 110,36 Z" fill="#080d14" />
            <path d="M 50,92 L -2,38 Q 50,-27 102,38 Z" fill="#0c1520" />

            {/* fair territory grass + mow stripes */}
            <path d={MLB_FAIR_PATH} fill="url(#piqGrass)" />
            <g clipPath="url(#piqFair)">
              {mlbGrassWedges().map((d, i) => (
                <path key={i} d={d} fill="#ffffff" opacity={i % 2 ? 0.038 : 0} />
              ))}
              {/* team mark mowed into the outfield grass (aspect pre-compensated) */}
              {logo && <image href={logo} x="38" y="12" width="24" height="30" opacity="0.10" preserveAspectRatio="xMidYMid meet" />}
              {/* warning track hugging the wall */}
              <path d="M 5,40 Q 50,-16 95,40" fill="none" stroke="url(#piqDirt)" strokeWidth="5" opacity="0.8" />
            </g>

            {/* infield dirt skin */}
            <path d="M 50,87 L 20,56 Q 50,9 80,56 Z" fill="url(#piqDirt)" />
            {/* grass diamond inside the skin, with dirt basepaths straddling its edges */}
            <polygon points="50,87 72,64 50,41 28,64" fill="url(#piqGrass)"
              stroke="url(#piqDirt)" strokeWidth="3.4" strokeLinejoin="round" />
            {/* base cutouts + bags */}
            {[[72, 64], [50, 41], [28, 64]].map(([x, y], i) => (
              <g key={i}>
                <ellipse cx={x} cy={y} rx="4.2" ry="3.4" fill="url(#piqDirt)" />
                <rect x={x - 1.3} y={y - 1.3} width="2.6" height="2.6" fill="#eef4fa" opacity="0.92" transform={`rotate(45 ${x} ${y})`} />
              </g>
            ))}
            {/* mound + rubber */}
            <ellipse cx="50" cy="63" rx="7" ry="5.6" fill="url(#piqDirt)" />
            <rect x="48.2" y="62.4" width="3.6" height="1" fill="#eef4fa" opacity="0.85" />
            {/* home plate circle, plate, batter's boxes */}
            <ellipse cx="50" cy="87" rx="9" ry="7" fill="url(#piqDirt)" />
            <rect x="44.2" y="83.6" width="4" height="6.4" fill="none" stroke="#eef4fa" strokeWidth="0.4" opacity="0.5" />
            <rect x="51.8" y="83.6" width="4" height="6.4" fill="none" stroke="#eef4fa" strokeWidth="0.4" opacity="0.5" />
            <rect x="48.6" y="86.2" width="2.8" height="2.2" fill="#eef4fa" opacity="0.92" />

            {/* stadium lighting + vignette (under the accent lines so they stay crisp) */}
            <rect x="0" y="0" width="100" height="100" fill="url(#piqLight)" />

            {/* foul lines + outfield wall */}
            <path d="M 50,87 L 5,40" stroke={accentRaw} strokeWidth="0.55" opacity="0.6" fill="none" />
            <path d="M 50,87 L 95,40" stroke={accentRaw} strokeWidth="0.55" opacity="0.6" fill="none" />
            <path d="M 5,40 Q 50,-16 95,40" fill="none" stroke={accentRaw} strokeWidth="1" opacity="0.8"
              style={{ filter: `drop-shadow(0 0 1.5px ${accentRaw})` }} />
          </svg>

          {MLB_FIELD_SPOTS.map((spot, i) => (
            <FieldCard key={spot.pos} spot={spot} player={byPos[spot.pos] || null} idx={i} />
          ))}
        </div>
      </div>

      {/* Selected player detail — reuses the prop model already loaded */}
      {selected && (() => {
        const pm = propsFor(selected.id);
        return (
          <HudCard style={{ padding: '12px 16px', marginBottom: 16 }} accent={accent}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700 }}>{selected.name}</span>
              <span style={{ fontSize: 10, padding: '2px 7px', border: `1px solid ${accentRaw}66`, color: accent, fontFamily: 'Space Mono, monospace', borderRadius: 2 }}>
                {selected.position}{selected.order ? ` · BATS ${selected.order}` : ''}
              </span>
              {pm ? (
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  {[['HIT 0.5+', pm.predictions?.hits?.['0.5']], ['RBI 0.5+', pm.predictions?.rbi?.['0.5']], ['K 0.5+', pm.predictions?.k?.['0.5']]].map(([l, v]) => (
                    <span key={l} style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', letterSpacing: '0.08em' }}>
                      {l} <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 13, fontWeight: 700, color: mlbPropColor(v) }}>
                        {v != null ? `${Math.round(v * 100)}%` : '—'}
                      </span>
                    </span>
                  ))}
                </span>
              ) : (
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace' }}>
                  no projection {selected.isSP ? '(pitcher)' : 'yet'}
                </span>
              )}
            </div>
          </HudCard>
        );
      })()}

      {/* Batting order — the spatial view doesn't convey sequence, so keep it */}
      {posted && (
        <>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.18em', marginBottom: 8 }}>
            BATTING ORDER
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            {lineup.slice().sort((a, b) => (a.order || 99) - (b.order || 99)).map(b => {
              const isSel = String(b.id) === String(selId);
              return (
                <button key={b.id} onClick={() => setSelId(isSel ? null : String(b.id))}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 9px', borderRadius: 2, cursor: 'pointer',
                    background: isSel ? `${accentRaw}1a` : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${isSel ? accentRaw + '77' : 'rgba(255,255,255,0.06)'}` }}>
                  <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 11, fontWeight: 900, color: accent }}>{b.order}</span>
                  <span style={{ fontFamily: 'Space Mono, monospace', fontSize: 10, color: 'var(--text)' }}>{mlbLastName(b.name)}</span>
                  <span style={{ fontFamily: 'Space Mono, monospace', fontSize: 9.5, color: 'var(--muted)' }}>{b.position}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Non-fielders */}
      {dugout.length > 0 && (
        <>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.18em', marginBottom: 8 }}>
            DUGOUT · BATS BUT DOESN'T FIELD
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {dugout.map(b => (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                background: 'var(--surface)', borderRadius: 3, border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', overflow: 'hidden', border: `1px solid ${accentRaw}55` }}>
                  <img src={mlbHeadshot(b.id)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={e => { e.target.style.display = 'none'; }} />
                </div>
                <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700 }}>{b.name}</span>
                <span style={{ fontSize: 10, padding: '1px 6px', border: `1px solid ${accentRaw}44`, color: accent, fontFamily: 'Space Mono, monospace', borderRadius: 2 }}>
                  {b.position}{b.order ? ` · ${b.order}` : ''}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

Object.assign(window, { EdgeFinderTab, PitchingEdgeTab, HighContactTab, LowHrModelTab, MlbLineupFieldTab, MlbDataLoader, useMlbLoadGate });
