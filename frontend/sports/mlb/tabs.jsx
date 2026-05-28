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

/* ── HIGH CONTACT TAB ────────────────────────────────────
   Visualizes the hit-risk report from /api/mlb/high-contact: a 0–100 risk
   score per starting pitcher, weighted breakdown of 6 sub-signals (pitcher
   traffic, pitch-type weakness, opp-vs-hand, lineup strength, weather,
   BvP), current-vs-prev pitcher numbers, Savant arsenal table, opposing
   team-vs-hand splits, bullpen, weather, and a verified-data row. */
function HighContactTab({ gameData }) {
  const { gameInfo, highContactData } = gameData;
  if (!highContactData) {
    if (gameData?._loading?.highContactData !== false) return <TabLoader source="MLB Stats + Savant" label="Computing hit-risk..." rows={2} />;
    return <div style={emptyMsg}>High-contact report unavailable.</div>;
  }

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
    score == null ? 'var(--dim)' :
    score >= 65   ? '#ff6b35' :
    score >= 40   ? '#ffd060' :
                    '#00ff88';

  const angleFor = side => {
    if (side?.riskScore == null) return 'INSUFFICIENT DATA — wait for confirmed lineup + arsenal.';
    if (side.riskScore >= 65) return `LEAN HITTERS — over team total / first-5 over / opposing batter hits ${side.opponent || ''}.`;
    if (side.riskScore >= 40) return 'MIXED — single-batter props only, fade NRFI / look at HR props.';
    return 'LEAN PITCHER — under team total / pitcher K props / under hits-allowed.';
  };

  const PitcherRiskCard = ({ side, color, abbr }) => {
    if (!side?.pitcher) {
      return (
        <HudCard style={{ padding: 18, textAlign: 'center' }} accent="var(--dim)">
          <div style={{ color: 'var(--dim)', fontFamily: 'Space Mono, monospace', fontSize: 10 }}>SP NOT ANNOUNCED</div>
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
            <div style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', color, letterSpacing: '0.18em', marginBottom: 4 }}>
              {abbr}{side.pitcher.throws ? ` · ${side.pitcher.throws}HP` : ''}
            </div>
            <div style={{ fontFamily: 'Space Mono, monospace', fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {side.pitcher.name}
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace' }}>vs {side.opponent || '—'}</div>
          </div>
          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <RiskGauge score={score} color={rc} />
            <div style={{ fontSize: 9, color: rc, fontFamily: 'Space Mono, monospace', fontWeight: 700, letterSpacing: '0.18em', marginTop: 4 }}>
              {side.riskLevel || '—'} RISK
            </div>
          </div>
        </div>

        <div style={{ paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.04)', marginBottom: 12 }}>
          <div style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.18em', marginBottom: 8 }}>BREAKDOWN</div>
          {SUB_ORDER.map(key => {
            const raw = subs[key];
            const w = weights[key] || 0;
            const present = raw != null;
            const subColor = present ? riskColor(raw) : 'var(--dim)';
            return (
              <div key={key} style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <span style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.1em' }}>
                    {SUB_LABELS[key]} <span style={{ color: 'var(--dim)' }}>· {Math.round(w * 100)}%</span>
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
          <div style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.18em', marginBottom: 8 }}>PITCHER · CURRENT vs PREV</div>
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
                <div style={{ fontSize: 8, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.1em', marginBottom: 3 }}>{l}</div>
                <div style={{ fontSize: 13, fontFamily: 'Orbitron, monospace', color, fontWeight: 700, lineHeight: 1 }}>{fmt(c)}</div>
                <div style={{ fontSize: 8, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', marginTop: 3 }}>prev: {fmt(p)}</div>
              </div>
            ))}
          </div>
        </div>

        {side.arsenal?.length > 0 && (
          <div style={{ paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.04)', marginBottom: 12 }}>
            <div style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.18em', marginBottom: 8 }}>
              ARSENAL · TOP {Math.min(side.arsenal.length, 5)} PITCHES
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {side.arsenal.slice(0, 5).map((p, i) => {
                const xw = p.xwoba;
                const xwColor = xw == null ? 'var(--dim)' :
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
                    <div style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', textAlign: 'right' }}>
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
            <div style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.18em', marginBottom: 8 }}>
              {side.opponent ? side.opponent.toUpperCase() : 'OPP'} vs {side.pitcher.throws === 'L' ? 'LHP' : 'RHP'}
            </div>
            {(() => {
              const sp = side.pitcher.throws === 'L' ? side.oppHandSplits.vsL : side.oppHandSplits.vsR;
              if (!sp) return <div style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'Space Mono, monospace' }}>NO SPLIT DATA</div>;
              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                  {[['AVG', sp.avg], ['OBP', sp.obp], ['SLG', sp.slg], ['OPS', sp.ops]].map(([l, v]) => (
                    <div key={l} style={{ padding: '6px 4px', textAlign: 'center', background: 'var(--surface)', borderRadius: 3 }}>
                      <div style={{ fontSize: 8, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.1em', marginBottom: 2 }}>{l}</div>
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
              <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.15em' }}>BULLPEN</span>
              <span style={{ fontSize: 11, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700 }}>
                {side.bullpen.era != null ? side.bullpen.era.toFixed(2) : '—'} ERA
              </span>
              <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)' }}>
                {side.bullpen.whip != null ? side.bullpen.whip.toFixed(2) : '—'} WHIP
              </span>
            </div>
          ) : (
            <span style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'Space Mono, monospace' }}>BULLPEN —</span>
          )}
          {side.weather && <WeatherPill weather={side.weather} />}
        </div>

        <div style={{ padding: '10px 12px', background: `${rc}10`, border: `1px solid ${rc}33`, borderRadius: 3 }}>
          <div style={{ fontSize: 8, color: rc, fontFamily: 'Space Mono, monospace', letterSpacing: '0.2em', marginBottom: 4 }}>ANGLE</div>
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
              <span key={key} style={{ fontSize: 8, padding: '2px 6px', borderRadius: 2, fontFamily: 'Space Mono, monospace', letterSpacing: '0.1em',
                color: ok ? '#00ff88' : 'var(--dim)',
                background: ok ? 'rgba(0,255,136,0.08)' : 'transparent',
                border: `1px solid ${ok ? 'rgba(0,255,136,0.25)' : 'rgba(255,255,255,0.05)'}` }}>
                {ok ? '✓' : '○'} {lbl}
              </span>
            );
          })}
        </div>
      </HudCard>
    );
  };

  return (
    <div style={{ padding: '20px 0' }}>
      <SectionHeader
        label="HIGH-CONTACT PITCHING"
        sub="Weighted hit-risk score · WHIP + arsenal xwOBA + opp-vs-hand + lineup BvP + weather"
      />
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

Object.assign(window, { EdgeFinderTab, PitchingEdgeTab, HighContactTab });
