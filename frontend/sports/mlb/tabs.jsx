/* ============================================================
   PLAYIQ — MLB TABS
   MLB-only game-detail tabs and chart helpers
   ============================================================ */

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

function EdgeFinderTab({ gameData }) {
  const { mlbEdgeData } = gameData;
  const [filter, setFilter] = React.useState('all');

  if (!mlbEdgeData) {
    if (gameData?._loading?.mlbEdgeData !== false) return <TabLoader source="Savant" label="Fetching BvP from Baseball Savant..." rows={5} />;
    return <div style={emptyMsg}>Edge data unavailable — lineups may not be posted yet.</div>;
  }

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
        <div onClick={() => setOpen(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', cursor: 'pointer', userSelect: 'none' }}>
          <PlayerCard player={{ name: b.name, headshot: b.headshotUrl, pos: b.position }} size="md" accent={b.teamColor} />
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700 }}>{b.name}</span>
              <span style={{ fontSize: 9, padding: '2px 7px', border: `1px solid ${b.teamColor}66`, color: b.teamColor, fontFamily: 'Space Mono, monospace', borderRadius: 2, letterSpacing: '0.08em' }}>{b.teamAbbr}</span>
              <span style={{ fontSize: 9, padding: '2px 7px', border: `1px solid ${b.teamColor}44`, color: b.teamColor, fontFamily: 'Space Mono, monospace', borderRadius: 2 }}>{b.position}</span>
              {b.order && <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace' }}>#{b.order}</span>}
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
                    <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.14em' }}>{l}</span>
                    <span style={{ fontSize: 13, fontFamily: 'Orbitron, monospace', fontWeight: 700,
                      color: l === 'HR' && v > 0 ? 'var(--orange)' : 'var(--text)' }}>{v}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 10, borderLeft: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.15em' }}>
              {open ? 'HIDE' : 'EXPAND'}
            </span>
            <span style={{ fontSize: 14, color: opsColor, fontFamily: 'Orbitron, monospace', transition: 'transform 0.2s',
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
          </div>
        </div>

        {open && (
          <div style={{ marginTop: 18, animation: 'fadeUp 0.25s ease' }}>
            <div style={{ paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', color: b.teamColor, letterSpacing: '0.22em', marginBottom: 10 }}>
                LAST 5 GAMES (SEASON)
              </div>
              <GameLogChart games={b.gameLog || []} stats={L5_STATS} defaultStat="hits" emptyLabel="NO RECENT SEASON GAMES" accent={b.teamColor} />
            </div>

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
                <GameLogChart games={bvpGames} stats={BVP_STATS} defaultStat="h" emptyLabel="NO BvP HISTORY" accent={opsColor} />
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
              color: bvpStatus.lineupStatus === 'confirmed' ? 'var(--green)' : 'var(--gold)', letterSpacing: '0.1em' }}>
              LINEUP: {(bvpStatus.lineupStatus || '—').toUpperCase()}
            </span>
            {[['all', 'ALL'], ['edges', 'EDGES ONLY']].map(([v, l]) => (
              <button key={v} onClick={() => setFilter(v)}
                style={{ padding: '4px 10px', background: filter===v ? 'rgba(0,212,255,0.1)' : 'transparent',
                  border: `1px solid ${filter===v ? 'rgba(0,212,255,0.3)' : 'rgba(255,255,255,0.06)'}`,
                  color: filter===v ? 'var(--cyan)' : 'var(--dim)', fontFamily: 'Space Mono, monospace',
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

function PitchingEdgeTab({ gameData }) {
  const { gameInfo, pitchingData } = gameData;
  if (!pitchingData) {
    if (gameData?._loading?.pitchingData !== false) return <TabLoader source="Stats" label="Loading probable pitchers..." rows={2} />;
    return <div style={emptyMsg}>Pitching data unavailable.</div>;
  }
  const { pitchers } = pitchingData;
  const fv = (v, d = 2) => v != null ? Number(v).toFixed(d) : '—';

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
          {[['ERA', fv(p.era)], ['WHIP', fv(p.whip)], ['REC', p.record || '—']].map(([l, v]) => (
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

Object.assign(window, { EdgeFinderTab, PitchingEdgeTab });
