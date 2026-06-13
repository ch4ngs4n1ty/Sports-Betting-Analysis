/* ============================================================
   PLAYIQ — NBA TABS
   NBA-only game-detail tabs and chart helpers
   ============================================================ */

const NBA_STATS = [
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
];

const nbaStatColorFor = (v, sk) => {
  if (sk === 'pts') return v >= 30 ? 'var(--green)' : v >= 20 ? 'var(--gold)' : v >= 10 ? 'var(--cyan)' : 'var(--orange)';
  if (sk === 'reb') return v >= 12 ? 'var(--green)' : v >= 8 ? 'var(--gold)' : v >= 4 ? 'var(--cyan)' : 'var(--dim)';
  if (sk === 'ast') return v >= 10 ? 'var(--green)' : v >= 6 ? 'var(--gold)' : v >= 3 ? 'var(--cyan)' : 'var(--dim)';
  return 'var(--muted)';
};

function NbaEdgeFinderTab({ gameData }) {
  const { gameInfo, nbaEdgeData, nbaDefenseEdge } = gameData;
  const [filter, setFilter] = React.useState('all');
  const [modelStat, setModelStat] = React.useState('pts');
  const [modelLine, setModelLine] = React.useState(NBA_THRESHOLD_DEFAULT_LINE.pts);

  // Switching stat resets the line to that stat's default bucket.
  const selectStat = stat => { setModelStat(stat); setModelLine(NBA_THRESHOLD_DEFAULT_LINE[stat]); };

  if (!nbaEdgeData) {
    if (gameData?._loading?.nbaEdgeData !== false) return <TabLoader source="ESPN" label="Building player edge profiles..." rows={5} />;
    return <div style={emptyMsg}>No edge data available.</div>;
  }
  const { players } = nbaEdgeData;
  if (!players?.length) return <div style={emptyMsg}>No players found.</div>;

  const displayed = filter === 'all' ? players : players.filter(p => p.side === filter);

  // ── Projection model board: rank displayed players by P(stat ≥ line) ──
  // Plain computation (not memoized) so it stays below the early returns
  // without breaking the rules of hooks; it's cheap (≤16 players).
  const _modelTotal = nbaDefenseEdge?.total_rows || 150;
  const modelBoard = displayed
    .map(p => {
      const de = findNbaDefenseEdge(nbaDefenseEdge, p.name, p.side);
      const r = nbaThresholdProbability(p.proj, modelStat, modelLine, de, _modelTotal);
      return r ? { p, r } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.r.prob - a.r.prob);

  const ModelRow = ({ entry, idx }) => {
    const { p, r } = entry;
    const c = nbaProbColor(r.prob);
    const pct = Math.round(r.prob * 100);
    const confColor = r.conf === 'HIGH' ? '#00ff88' : r.conf === 'MED' ? '#ffd060' : 'var(--dim)';
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 10px', borderRadius: 3,
        background: idx % 2 ? 'transparent' : 'rgba(255,255,255,0.02)', flexWrap: 'wrap' }}>
        <span style={{ width: 20, textAlign: 'center', fontSize: 14, fontFamily: 'Orbitron, monospace', fontWeight: 900,
          color: idx === 0 ? '#00ff88' : idx <= 2 ? 'var(--cyan)' : 'var(--dim)' }}>{idx + 1}</span>
        <img src={p.headshot} alt={p.name} style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', border: `1px solid ${p.teamColor}55` }}
          onError={e => e.target.style.display = 'none'} />
        <div style={{ flex: 1, minWidth: 150 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700 }}>{p.name}</span>
            <span style={{ fontSize: 8, padding: '1px 6px', border: `1px solid ${p.teamColor}66`, color: p.teamColor, fontFamily: 'Space Mono, monospace', borderRadius: 2, letterSpacing: '0.08em' }}>{p.teamAbbr} {p.pos}</span>
            {p.isStarter && <span style={{ fontSize: 8, color: 'var(--green)', fontFamily: 'Orbitron, monospace', fontWeight: 700, letterSpacing: '0.12em' }}>★</span>}
          </div>
          <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', marginTop: 2 }}>
            proj <span style={{ color: 'var(--text)', fontWeight: 700 }}>{r.proj.toFixed(1)}</span>
            {' · '}{r.hasMatchup && r.defRank != null
              ? <span style={{ color: nbaDefenseRankColor(r.defRank) === 'red' ? '#ff8a55' : nbaDefenseRankColor(r.defRank) === 'green' ? '#5ff5a5' : '#ffd060' }}>vs #{r.defRank}/{r.total} D</span>
              : <span style={{ color: 'var(--dim)' }}>no matchup adj</span>}
            {' · '}<span style={{ color: confColor }}>{r.conf}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 160, flex: 1 }}>
          <div style={{ flex: 1, height: 7, background: 'rgba(255,255,255,0.05)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: c, boxShadow: `0 0 8px ${c}88`, borderRadius: 4,
              transition: 'width 0.6s cubic-bezier(0.16,1,0.3,1)' }} />
          </div>
          <span style={{ fontSize: 18, fontFamily: 'Orbitron, monospace', fontWeight: 900, color: c, width: 50, textAlign: 'right' }}>{pct}%</span>
        </div>
      </div>
    );
  };

  const NbaPlayerCard = ({ p }) => {
    const [open, setOpen] = React.useState(false);
    const hasH2H = (p.h2h || []).length > 0;
    const hasL5 = (p.l5 || []).length > 0;

    return (
      <HudCard style={{ padding: '18px 20px' }} accent={p.teamColor}>
        <div onClick={() => setOpen(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', cursor: 'pointer', userSelect: 'none' }}>
          <PlayerCard player={{ name: p.name, headshot: p.headshot, pos: p.pos }} size="md" accent={p.teamColor} />
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700 }}>{p.name}</span>
              <span style={{ fontSize: 9, padding: '2px 7px', border: `1px solid ${p.teamColor}66`, color: p.teamColor, fontFamily: 'Space Mono, monospace', borderRadius: 2, letterSpacing: '0.08em' }}>{p.teamAbbr}</span>
              <span style={{ fontSize: 9, padding: '2px 7px', border: `1px solid ${p.teamColor}44`, color: p.teamColor, fontFamily: 'Space Mono, monospace', borderRadius: 2 }}>{p.pos}</span>
              {p.jersey && p.jersey !== '—' && <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace' }}>#{p.jersey}</span>}
              {p.isStarter && (
                <span style={{ fontSize: 9, padding: '2px 7px', background: 'rgba(0,255,136,0.12)', border: '1px solid rgba(0,255,136,0.35)', color: 'var(--green)', fontFamily: 'Orbitron, monospace', fontWeight: 700, borderRadius: 2, letterSpacing: '0.15em' }}>★ STARTER</span>
              )}
              <HotBadge tier={p.hotTier} />
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
                <GameLogChart games={p.h2h} stats={NBA_STATS} defaultStat="pts" emptyLabel={`NO GAMES VS ${p.oppAbbr} THIS SEASON`} accent={p.teamColor} colorFor={nbaStatColorFor} />
              ) : (
                <div style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', padding: '16px 0', letterSpacing: '0.1em' }}>
                  NO GAMES VS {p.oppAbbr} THIS SEASON
                </div>
              )}
            </div>

            <div style={{ paddingTop: 18, marginTop: 18, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', color: p.teamColor, letterSpacing: '0.22em', marginBottom: 10 }}>
                LAST 5 GAMES (SEASON)
              </div>
              {hasL5 ? (
                <GameLogChart games={p.l5} stats={NBA_STATS} defaultStat="pts" emptyLabel="NO RECENT GAMES" accent={p.teamColor} colorFor={nbaStatColorFor} />
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

      {/* ── PROJECTION MODEL BOARD ── */}
      <HudCard style={{ padding: '16px 18px', marginBottom: 22 }} accent="#00ff88">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{ fontSize: 12, fontFamily: 'Orbitron, monospace', fontWeight: 900, color: '#00ff88', letterSpacing: '0.14em' }}>
            ◆ PROJECTION MODEL
          </span>
          <span style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', letterSpacing: '0.1em' }}>
            LIKELIHOOD TO HIT THRESHOLD · ranked
          </span>
          {!nbaDefenseEdge && (
            <span style={{ marginLeft: 'auto', fontSize: 9, fontFamily: 'Space Mono, monospace', color: 'var(--dim)' }}>
              matchup adj loading…
            </span>
          )}
        </div>

        {/* Stat + line controls */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 5 }}>
            {['pts', 'reb', 'ast', 'pra'].map(s => (
              <button key={s} onClick={() => selectStat(s)}
                style={{ padding: '5px 13px', background: modelStat === s ? 'rgba(0,255,136,0.12)' : 'transparent',
                  border: `1px solid ${modelStat === s ? 'rgba(0,255,136,0.4)' : 'rgba(255,255,255,0.08)'}`,
                  color: modelStat === s ? '#00ff88' : 'var(--muted)', fontFamily: 'Orbitron, monospace', fontWeight: 700,
                  fontSize: 10, cursor: 'pointer', borderRadius: 2, letterSpacing: '0.1em' }}>{NBA_STAT_LABELS[s]}</button>
            ))}
          </div>
          <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.08)' }} />
          <div style={{ display: 'flex', gap: 5 }}>
            {NBA_THRESHOLD_BUCKETS[modelStat].map(line => (
              <button key={line} onClick={() => setModelLine(line)}
                style={{ padding: '5px 12px', background: modelLine === line ? 'rgba(0,212,255,0.12)' : 'transparent',
                  border: `1px solid ${modelLine === line ? 'rgba(0,212,255,0.4)' : 'rgba(255,255,255,0.08)'}`,
                  color: modelLine === line ? 'var(--cyan)' : 'var(--dim)', fontFamily: 'Space Mono, monospace',
                  fontSize: 10, cursor: 'pointer', borderRadius: 2, letterSpacing: '0.06em' }}>{line}+</button>
            ))}
          </div>
          <span style={{ marginLeft: 'auto', fontSize: 13, fontFamily: 'Orbitron, monospace', fontWeight: 700, color: 'var(--text)', letterSpacing: '0.08em' }}>
            {modelLine}+ {NBA_STAT_LABELS[modelStat]}
          </span>
        </div>

        {/* Ranked rows */}
        {modelBoard.length ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {modelBoard.slice(0, 10).map((entry, i) => <ModelRow key={entry.p.id || i} entry={entry} idx={i} />)}
          </div>
        ) : (
          <div style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', padding: '12px 0' }}>
            No players with game-log data yet.
          </div>
        )}

        <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', marginTop: 12, lineHeight: 1.6, letterSpacing: '0.04em' }}>
          Normal model fit to each player's game log, mean shifted by last-5 form and opponent defense-vs-position rank.
          Confidence reflects sample size + role stability. Estimates only — not a betting guarantee.
        </div>
      </HudCard>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {displayed.map((p, i) => <NbaPlayerCard key={p.id || i} p={p} />)}
      </div>
    </div>
  );
}

/* ============================================================
   NBA LINEUP TAB
   Side-by-side starter matchups (PG/SG/SF/PF/C) with season vs
   H2H averages for MIN/PTS/REB/AST/STL/BLK/FG%/3P%/FT%.
   ============================================================ */

const NBA_LINEUP_STATS = [
  { key: 'min', label: 'MIN', fmt: v => v.toFixed(1) },
  { key: 'pts', label: 'PTS', fmt: v => v.toFixed(1) },
  { key: 'reb', label: 'REB', fmt: v => v.toFixed(1) },
  { key: 'ast', label: 'AST', fmt: v => v.toFixed(1) },
  { key: 'stl', label: 'STL', fmt: v => v.toFixed(1) },
  { key: 'blk', label: 'BLK', fmt: v => v.toFixed(1) },
  { key: 'to',  label: 'TO',  fmt: v => v.toFixed(1), lowerIsBetter: true },
  { key: 'fgPct', label: 'FG%', fmt: v => `${(v * 100).toFixed(1)}%` },
  { key: 'tpPct', label: '3P%', fmt: v => `${(v * 100).toFixed(1)}%` },
  { key: 'ftPct', label: 'FT%', fmt: v => `${(v * 100).toFixed(1)}%` },
];

function _nbaPickEdge(awayVal, homeVal, lowerIsBetter) {
  if (awayVal == null || homeVal == null) return 'tie';
  const diff = awayVal - homeVal;
  if (Math.abs(diff) < 0.05) return 'tie';
  const awayBetter = lowerIsBetter ? diff < 0 : diff > 0;
  return awayBetter ? 'away' : 'home';
}

// Top 50 / Mid 50 / Bottom 50 color tokens for the defense chip
const NBA_DEF_COLORS = {
  green:  { bg: 'rgba(0,255,136,0.10)',  border: 'rgba(0,255,136,0.45)',  text: '#5ff5a5', label: 'TOP 50 · STRONG' },
  yellow: { bg: 'rgba(255,208,96,0.10)', border: 'rgba(255,208,96,0.40)', text: '#ffd060', label: 'MID 50 · AVG' },
  red:    { bg: 'rgba(255,107,53,0.12)', border: 'rgba(255,107,53,0.45)', text: '#ff8a55', label: 'BOTTOM 50 · WEAK' },
};

function NbaDefenseLegend() {
  const items = [
    { tier: 'green', label: 'TOP 50 · Strong defense (rank 1-50) · downgrade target' },
    { tier: 'yellow', label: 'MID 50 · Average defense (rank 51-100) · neutral matchup' },
    { tier: 'red', label: 'BOTTOM 50 · Weak defense (rank 101-150) · upgrade target' },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', marginBottom: 12,
      background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 4, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 9, fontFamily: 'Orbitron, monospace', color: 'var(--dim)', letterSpacing: '0.18em' }}>
        DEFENSE VS POSITION
      </span>
      {items.map(it => {
        const c = NBA_DEF_COLORS[it.tier];
        return (
          <div key={it.tier} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: c.bg, border: `1px solid ${c.border}` }} />
            <span style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', color: c.text, letterSpacing: '0.05em' }}>
              {it.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function NbaDefenseChip({ edge, align }) {
  if (!edge || edge.rank == null || edge.points_allowed_per_48 == null) {
    return (
      <div style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', color: 'var(--dim)', letterSpacing: '0.08em', textAlign: align }}>
        NO DEFENSE DATA
      </div>
    );
  }
  const tier = nbaDefenseRankColor(edge.rank);
  const c = NBA_DEF_COLORS[tier] || NBA_DEF_COLORS.yellow;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align === 'right' ? 'flex-end' : 'flex-start', gap: 3 }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px',
        background: c.bg, border: `1px solid ${c.border}`, borderRadius: 2 }}>
        <span style={{ fontSize: 9, fontFamily: 'Orbitron, monospace', fontWeight: 700, color: c.text, letterSpacing: '0.15em' }}>
          vs {edge.opponent} {edge.position} · #{edge.rank}/150
        </span>
      </div>
      <div style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', color: c.text, letterSpacing: '0.08em' }}>
        {edge.points_allowed_per_48.toFixed(1)} pts/48 allowed · {c.label}
      </div>
    </div>
  );
}

function NbaPlayerColumn({ player, accent, align, defenseEdge }) {
  if (!player) {
    return (
      <div style={{ flex: 1, padding: 12, opacity: 0.4, textAlign: align, fontFamily: 'Space Mono, monospace', fontSize: 10, color: 'var(--dim)', letterSpacing: '0.1em' }}>
        NO STARTER
      </div>
    );
  }
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: align === 'right' ? 'flex-end' : 'flex-start', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexDirection: align === 'right' ? 'row-reverse' : 'row' }}>
        <PlayerCard player={{ name: player.name, headshot: player.headshot, pos: player.pos }} size="sm" accent={accent} />
        <div style={{ textAlign: align }}>
          <div style={{ fontSize: 13, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700 }}>{player.name}</div>
          <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.08em' }}>
            {player.pos}{player.jersey && player.jersey !== '—' ? ` · #${player.jersey}` : ''}
          </div>
        </div>
      </div>
      <NbaDefenseChip edge={defenseEdge} align={align} />
    </div>
  );
}

function NbaStatRow({ label, awayVal, homeVal, fmt, lowerIsBetter, awayColor, homeColor }) {
  const winner = _nbaPickEdge(awayVal, homeVal, lowerIsBetter);
  const colA = winner === 'away' ? awayColor : winner === 'home' ? 'var(--dim)' : 'var(--muted)';
  const colH = winner === 'home' ? homeColor : winner === 'away' ? 'var(--dim)' : 'var(--muted)';
  // Bar widths normalized: bigger value gets full bar, smaller is proportional.
  const max = Math.max(awayVal || 0, homeVal || 0, 0.001);
  const wA = ((awayVal || 0) / max) * 100;
  const wH = ((homeVal || 0) / max) * 100;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 1fr', alignItems: 'center', gap: 12, padding: '6px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
        <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 1, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${wA}%`, background: colA, opacity: winner === 'away' ? 0.85 : 0.35 }} />
        </div>
        <span style={{ fontSize: 13, fontFamily: 'Space Mono, monospace', fontWeight: 700, color: colA, minWidth: 56, textAlign: 'right' }}>
          {awayVal == null ? '—' : fmt(awayVal)}
        </span>
      </div>
      <div style={{ textAlign: 'center', fontSize: 9, fontFamily: 'Space Mono, monospace', color: 'var(--dim)', letterSpacing: '0.18em' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontFamily: 'Space Mono, monospace', fontWeight: 700, color: colH, minWidth: 56 }}>
          {homeVal == null ? '—' : fmt(homeVal)}
        </span>
        <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 1, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${wH}%`, background: colH, opacity: winner === 'home' ? 0.85 : 0.35 }} />
        </div>
      </div>
    </div>
  );
}

function NbaMatchupRow({ matchup, awayAbbr, homeAbbr, awayColor, homeColor, defenseEdge }) {
  const [mode, setMode] = React.useState('season'); // 'season' | 'h2h' | 'l5'
  const a = matchup.away;
  const h = matchup.home;
  const aStats = a ? a[mode] : null;
  const hStats = h ? h[mode] : null;
  const aGames = a ? (mode === 'h2h' ? a.h2hCount : a[mode]?.games) : 0;
  const hGames = h ? (mode === 'h2h' ? h.h2hCount : h[mode]?.games) : 0;

  // Defense matchup lookup: away player faces home defense, vice versa
  const awayDefense = a ? findNbaDefenseEdge(defenseEdge, a.name, 'away') : null;
  const homeDefense = h ? findNbaDefenseEdge(defenseEdge, h.name, 'home') : null;

  return (
    <HudCard style={{ padding: 18 }} accent={'var(--cyan)'}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, fontFamily: 'Orbitron, monospace', fontWeight: 700, color: 'var(--cyan)', letterSpacing: '0.18em', padding: '4px 10px', border: '1px solid rgba(0,212,255,0.3)', borderRadius: 2 }}>
            {matchup.position}
          </span>
          <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.15em' }}>
            POSITION MATCHUP
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[['season', 'SEASON'], ['l5', 'L5'], ['h2h', `H2H`]].map(([v, l]) => (
            <button key={v} onClick={() => setMode(v)}
              style={{ padding: '3px 10px', background: mode === v ? 'rgba(0,212,255,0.1)' : 'transparent',
                border: `1px solid ${mode === v ? 'rgba(0,212,255,0.3)' : 'rgba(255,255,255,0.06)'}`,
                color: mode === v ? 'var(--cyan)' : 'var(--dim)', fontFamily: 'Space Mono, monospace',
                fontSize: 9, cursor: 'pointer', borderRadius: 2, letterSpacing: '0.1em' }}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 12 }}>
        <NbaPlayerColumn player={a} accent={awayColor} align="left" defenseEdge={awayDefense} />
        <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 11, color: 'var(--dim)', letterSpacing: '0.15em', paddingTop: 14 }}>VS</div>
        <NbaPlayerColumn player={h} accent={homeColor} align="right" defenseEdge={homeDefense} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', letterSpacing: '0.1em', marginBottom: 8, padding: '6px 0', borderTop: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <span>{awayAbbr} · {aGames || 0} GAMES{mode === 'h2h' ? ` VS ${homeAbbr}` : ''}</span>
        <span style={{ color: 'var(--dim)' }}>
          {mode === 'season' ? 'SEASON AVERAGES' : mode === 'l5' ? 'LAST 5 AVERAGES' : `HEAD-TO-HEAD AVERAGES`}
        </span>
        <span>{homeAbbr} · {hGames || 0} GAMES{mode === 'h2h' ? ` VS ${awayAbbr}` : ''}</span>
      </div>

      {(!aStats || !aStats.games) && (!hStats || !hStats.games) ? (
        <div style={{ textAlign: 'center', padding: '20px 0', fontSize: 10, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.1em' }}>
          {mode === 'h2h' ? 'NO HEAD-TO-HEAD GAMES THIS SEASON' : 'NO GAMES PLAYED'}
        </div>
      ) : (
        <div>
          {NBA_LINEUP_STATS.map(s => (
            <NbaStatRow key={s.key} label={s.label}
              awayVal={aStats?.[s.key] ?? null}
              homeVal={hStats?.[s.key] ?? null}
              fmt={s.fmt} lowerIsBetter={s.lowerIsBetter}
              awayColor={awayColor} homeColor={homeColor} />
          ))}
        </div>
      )}
    </HudCard>
  );
}

/* ============================================================
   NBA INJURY REPORT
   Sits above the position matchups. Shows player face cards
   tagged Out / Doubtful / Questionable / Day-to-Day with the
   ESPN injury comment and estimated return date.
   ============================================================ */

function _normalizeInjuryStatus(status) {
  const s = String(status || '').toLowerCase().trim();
  if (s === 'out' || s.includes('out for season') || s.includes('injured reserve') || s.includes('suspended')) return 'OUT';
  if (s === 'doubtful' || s.includes('doubt')) return 'DOUBTFUL';
  if (s === 'questionable' || s.includes('quest')) return 'QUESTIONABLE';
  if (s === 'day-to-day' || s.includes('day to day') || s === 'probable') return 'DAY-TO-DAY';
  return (status || 'UNKNOWN').toString().toUpperCase();
}

function _injurySeverity(normalized) {
  const order = { 'OUT': 0, 'DOUBTFUL': 1, 'QUESTIONABLE': 2, 'DAY-TO-DAY': 3 };
  return order[normalized] ?? 4;
}

function _injuryColor(normalized) {
  if (normalized === 'OUT') return 'var(--orange)';
  if (normalized === 'DOUBTFUL') return '#ff9558';
  if (normalized === 'QUESTIONABLE') return 'var(--gold)';
  if (normalized === 'DAY-TO-DAY') return 'var(--cyan)';
  return 'var(--muted)';
}

function NbaInjuryCard({ injury, accent }) {
  const norm = _normalizeInjuryStatus(injury.status);
  const color = _injuryColor(norm);

  // Prefer the long comment for context; fall back to short.
  const comment = injury.longComment || injury.shortComment || injury.detail || '';
  const bodyPart = injury.location || injury.type || injury.detail || injury.desc || '';

  return (
    <HudCard style={{ padding: 14 }} accent={accent}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <PlayerCard player={{ name: injury.name, headshot: injury.headshot, pos: injury.pos }} size="sm" accent={accent} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700 }}>
              {injury.name}
            </span>
            {injury.pos && (
              <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.08em' }}>
                {injury.pos}
              </span>
            )}
            <span style={{ fontSize: 9, fontFamily: 'Orbitron, monospace', fontWeight: 700, color, letterSpacing: '0.18em',
              padding: '3px 8px', border: `1px solid ${color}55`, background: `${color}14`, borderRadius: 2 }}>
              {norm}
            </span>
          </div>

          {bodyPart && (
            <div style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', letterSpacing: '0.05em', marginBottom: 4, textTransform: 'uppercase' }}>
              {bodyPart}
            </div>
          )}

          {comment && (
            <div style={{ fontSize: 11, fontFamily: 'Space Mono, monospace', color: 'var(--text)', lineHeight: 1.5, marginBottom: 6 }}>
              {comment}
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {injury.returnDate && (
              <div style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', color: 'var(--dim)', letterSpacing: '0.08em' }}>
                <span style={{ color: 'var(--dim)' }}>EST. RETURN ·</span>{' '}
                <span style={{ color: 'var(--cyan)' }}>{injury.returnDate}</span>
              </div>
            )}
            {injury.reportedDate && (
              <div style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', color: 'var(--dim)', letterSpacing: '0.08em' }}>
                <span style={{ color: 'var(--dim)' }}>REPORTED ·</span>{' '}
                <span style={{ color: 'var(--muted)' }}>{injury.reportedDate}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </HudCard>
  );
}

function NbaInjuryReport({ injuries, awayAbbr, homeAbbr, awayColor, homeColor }) {
  const sortBySeverity = list => (list || [])
    .slice()
    .sort((a, b) => _injurySeverity(_normalizeInjuryStatus(a.status)) - _injurySeverity(_normalizeInjuryStatus(b.status)));

  const away = sortBySeverity(injuries?.away);
  const home = sortBySeverity(injuries?.home);

  if (!away.length && !home.length) {
    return (
      <div style={{ marginBottom: 24 }}>
        <SectionHeader label="INJURY REPORT" sub="No injuries reported for either team" />
      </div>
    );
  }

  const TeamColumn = ({ list, abbr, color }) => (
    <div style={{ flex: 1, minWidth: 280 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontFamily: 'Orbitron, monospace', fontWeight: 700, color, letterSpacing: '0.18em' }}>{abbr}</span>
        <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.1em' }}>
          {list.length} {list.length === 1 ? 'PLAYER' : 'PLAYERS'}
        </span>
      </div>
      {list.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.map((inj, i) => (
            <NbaInjuryCard key={inj.athleteId || `${inj.name}-${i}`} injury={inj} accent={color} />
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', padding: '12px 0', letterSpacing: '0.1em' }}>
          NO INJURIES REPORTED
        </div>
      )}
    </div>
  );

  return (
    <div style={{ marginBottom: 24 }}>
      <SectionHeader label="INJURY REPORT"
        sub={`Status, body part, ESPN comment, and estimated return · ${away.length + home.length} total`} />
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <TeamColumn list={away} abbr={awayAbbr} color={awayColor} />
        <TeamColumn list={home} abbr={homeAbbr} color={homeColor} />
      </div>
    </div>
  );
}

function _formatLineupTimestamp(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 30 * 1000) return 'just now';
  if (diff < 60 * 1000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m ago`;
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function _statusColor(status) {
  if (status === 'confirmed') return 'var(--green)';
  if (status === 'expected') return 'var(--cyan)';
  if (status === 'projected') return 'var(--gold)';
  return 'var(--muted)';
}

function NbaLineupStatusBanner({ data, awayAbbr, homeAbbr, awayColor, homeColor, onRefresh, refreshing }) {
  // Forces a re-render once per second so the "Last updated" stamp stays fresh
  const [, tick] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => {
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, []);

  const status = data?.lineupStatus || {};
  const awayStatus = status.away || (data?.source === 'rotowire' ? 'unknown' : '—');
  const homeStatus = status.home || (data?.source === 'rotowire' ? 'unknown' : '—');
  const sourceLabel = data?.source === 'rotowire' ? 'ROTOWIRE'
    : data?.source === 'espn-boxscore' ? 'ESPN BOXSCORE'
    : 'MINUTES HEURISTIC';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
      background: 'rgba(0,212,255,0.04)', border: '1px solid rgba(0,212,255,0.12)',
      borderRadius: 4, marginBottom: 14, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 9, fontFamily: 'Orbitron, monospace', fontWeight: 700, color: 'var(--cyan)', letterSpacing: '0.18em' }}>
        SOURCE · {sourceLabel}
      </span>
      <span style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', color: 'var(--dim)', letterSpacing: '0.1em' }}>·</span>
      <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: awayColor, fontWeight: 700 }}>{awayAbbr}</span>
        <span style={{ color: _statusColor(awayStatus), letterSpacing: '0.1em', textTransform: 'uppercase' }}>{awayStatus}</span>
      </span>
      <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: homeColor, fontWeight: 700 }}>{homeAbbr}</span>
        <span style={{ color: _statusColor(homeStatus), letterSpacing: '0.1em', textTransform: 'uppercase' }}>{homeStatus}</span>
      </span>
      <span style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', color: 'var(--dim)', letterSpacing: '0.1em', marginLeft: 'auto' }}>
        UPDATED · {_formatLineupTimestamp(data?.fetchedAt)}
      </span>
      <button onClick={onRefresh} disabled={refreshing}
        style={{ padding: '4px 12px', background: refreshing ? 'transparent' : 'rgba(0,212,255,0.08)',
          border: `1px solid ${refreshing ? 'rgba(255,255,255,0.06)' : 'rgba(0,212,255,0.25)'}`,
          color: refreshing ? 'var(--dim)' : 'var(--cyan)', fontFamily: 'Space Mono, monospace',
          fontSize: 9, cursor: refreshing ? 'default' : 'pointer', borderRadius: 2, letterSpacing: '0.12em' }}>
        {refreshing ? 'REFRESHING…' : '↻ REFRESH'}
      </button>
    </div>
  );
}

function NbaLineupTab({ gameData }) {
  const { gameInfo, nbaLineupData, nbaDefenseEdge, injuries, awayRoster, homeRoster } = gameData || {};
  const [data, setData] = React.useState(nbaLineupData);
  const [defenseEdge, setDefenseEdge] = React.useState(nbaDefenseEdge);
  const [refreshing, setRefreshing] = React.useState(false);
  const refreshingRef = React.useRef(false);

  // Sync external updates (e.g. when game changes)
  React.useEffect(() => { setData(nbaLineupData); }, [nbaLineupData]);
  React.useEffect(() => { setDefenseEdge(nbaDefenseEdge); }, [nbaDefenseEdge]);

  const refresh = React.useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      // Pull lineups + positional defense in parallel — both keyed on starters,
      // so a roster change must update both signals together.
      const [freshLineup, freshDefense] = await Promise.all([
        buildNbaLineupData(gameInfo, awayRoster, homeRoster, { refresh: true }),
        fetchNbaPositionalDefenseEdge(gameInfo, { refresh: true }),
      ]);
      if (freshLineup) setData(freshLineup);
      if (freshDefense) setDefenseEdge(freshDefense);
    } catch (e) {
      console.warn('NBA lineup refresh failed:', e);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [gameInfo, awayRoster, homeRoster]);

  // Auto-poll: every 60s when lineups are unconfirmed, every 5min once confirmed.
  // Stops when this tab unmounts.
  React.useEffect(() => {
    const status = data?.lineupStatus;
    const allConfirmed = status?.away === 'confirmed' && status?.home === 'confirmed';
    const intervalMs = allConfirmed ? 5 * 60 * 1000 : 60 * 1000;
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [data?.lineupStatus?.away, data?.lineupStatus?.home, refresh]);

  if (!data) {
    if (gameData?._loading?.nbaLineupData !== false) return <TabLoader source="Rotowire" label="Confirming starting lineups..." rows={5} />;
    return <div style={emptyMsg}>Lineup data unavailable.</div>;
  }

  const awayColor = '#00d4ff';
  const homeColor = '#ffd060';

  return (
    <div style={{ padding: '20px 0' }}>
      <NbaInjuryReport injuries={injuries}
        awayAbbr={gameInfo.awayAbbr} homeAbbr={gameInfo.homeAbbr}
        awayColor={awayColor} homeColor={homeColor} />

      <SectionHeader label="STARTING LINEUPS · POSITION MATCHUPS"
        sub={`${gameInfo.awayAbbr} vs ${gameInfo.homeAbbr} · season / L5 / head-to-head averages · auto-refreshes`} />

      <NbaLineupStatusBanner data={data}
        awayAbbr={gameInfo.awayAbbr} homeAbbr={gameInfo.homeAbbr}
        awayColor={awayColor} homeColor={homeColor}
        onRefresh={refresh} refreshing={refreshing} />

      <NbaDefenseLegend />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {data.matchups.map(m => (
          <NbaMatchupRow key={m.position} matchup={m}
            awayAbbr={gameInfo.awayAbbr} homeAbbr={gameInfo.homeAbbr}
            awayColor={awayColor} homeColor={homeColor}
            defenseEdge={defenseEdge} />
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   NBA DEFENSE VS POSITION TAB
   Sortable table of how each team defends each position across
   PTS / FG% / FT% / 3PM / REB / AST / STL / BLK / TO. Cells are
   colored Top 50 (green) / Mid 50 (yellow) / Bottom 50 (red)
   based on the rank of that stat (lower allowed = stronger D).
   ============================================================ */

const NBA_DVP_COLUMNS = [
  { key: 'pts',      label: 'PTS',  valKey: 'points_allowed_per_48', fmt: v => v?.toFixed(1) ?? '—' },
  { key: 'fg_pct',   label: 'FG%',  valKey: 'fg_pct',                fmt: v => v != null ? (v * 100).toFixed(1) : '—' },
  { key: 'ft_pct',   label: 'FT%',  valKey: 'ft_pct',                fmt: v => v != null ? (v * 100).toFixed(1) : '—' },
  { key: 'three_pm', label: '3PM',  valKey: 'three_pm_per_48',       fmt: v => v?.toFixed(1) ?? '—' },
  { key: 'reb',      label: 'REB',  valKey: 'reb_per_48',            fmt: v => v?.toFixed(1) ?? '—' },
  { key: 'ast',      label: 'AST',  valKey: 'ast_per_48',            fmt: v => v?.toFixed(1) ?? '—' },
  { key: 'stl',      label: 'STL',  valKey: 'stl_per_48',            fmt: v => v?.toFixed(1) ?? '—' },
  { key: 'blk',      label: 'BLK',  valKey: 'blk_per_48',            fmt: v => v?.toFixed(1) ?? '—' },
  { key: 'to',       label: 'TO',   valKey: 'to_per_48',             fmt: v => v?.toFixed(1) ?? '—' },
];

function _dvpCellColor(rank) {
  const tier = nbaDefenseRankColor(rank);
  return NBA_DEF_COLORS[tier] || null;
}

function NbaDefenseStatCell({ value, rank, fmt }) {
  const c = _dvpCellColor(rank);
  const display = fmt(value);
  return (
    <td style={{
      padding: '8px 10px',
      background: c ? c.bg : 'transparent',
      borderLeft: c ? `2px solid ${c.border}` : '2px solid transparent',
      textAlign: 'center',
      fontFamily: 'Space Mono, monospace',
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: c ? c.text : 'var(--text)' }}>{display}</div>
      <div style={{ fontSize: 9, color: 'var(--dim)', letterSpacing: '0.06em', marginTop: 2 }}>
        #{rank ?? '—'}
      </div>
    </td>
  );
}

function NbaDefenseVsPositionTab({ gameData }) {
  const { gameInfo, nbaDefenseTable } = gameData || {};
  const [scope, setScope] = React.useState('matchup'); // 'matchup' | 'all'
  const [sortKey, setSortKey] = React.useState('pts');
  const [sortDir, setSortDir] = React.useState('asc'); // 'asc' = stronger D first

  if (!nbaDefenseTable) {
    if (gameData?._loading?.nbaDefenseTable !== false) return <TabLoader source="NBA" label="Loading 150 team-position rankings..." rows={4} />;
    return <div style={emptyMsg}>Defense vs Position data unavailable.</div>;
  }

  // Filter rows depending on scope
  const matchupTeams = new Set([gameInfo.awayAbbr, gameInfo.homeAbbr].map(s => String(s || '').toUpperCase()));
  // Backend uses canonical NBA abbrs (NYK, GSW, etc.) so map ESPN short forms
  const ESPN_TO_CANON = { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS', PHX: 'PHO' };
  const canonAway = ESPN_TO_CANON[gameInfo.awayAbbr] || gameInfo.awayAbbr;
  const canonHome = ESPN_TO_CANON[gameInfo.homeAbbr] || gameInfo.homeAbbr;
  const matchupCanon = new Set([canonAway, canonHome]);

  const baseRows = nbaDefenseTable.rows || [];
  const visible = scope === 'matchup'
    ? baseRows.filter(r => matchupCanon.has(r.defensive_team))
    : baseRows;

  // Sort
  const sortCol = NBA_DVP_COLUMNS.find(c => c.key === sortKey);
  const sorted = visible.slice().sort((a, b) => {
    if (sortKey === 'team') {
      const cmp = (a.defensive_team || '').localeCompare(b.defensive_team || '');
      return sortDir === 'asc' ? cmp : -cmp;
    }
    if (sortKey === 'position') {
      const order = { PG: 0, SG: 1, SF: 2, PF: 3, C: 4 };
      const cmp = (order[a.position] ?? 99) - (order[b.position] ?? 99);
      return sortDir === 'asc' ? cmp : -cmp;
    }
    const av = a[sortCol.valKey] ?? 0;
    const bv = b[sortCol.valKey] ?? 0;
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  const onSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const sortIndicator = (key) => sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const headerCellStyle = {
    padding: '8px 10px', textAlign: 'center', cursor: 'pointer',
    fontFamily: 'Space Mono, monospace', fontSize: 9, letterSpacing: '0.18em',
    color: 'var(--cyan)', borderBottom: '1px solid rgba(0,212,255,0.18)',
    userSelect: 'none', whiteSpace: 'nowrap',
  };

  return (
    <div style={{ padding: '20px 0' }}>
      <SectionHeader label="DEFENSE vs POSITION"
        sub={`${nbaDefenseTable.season || ''} season · ${nbaDefenseTable.games_in_aggregate ?? 0} games sampled · per-48 (or %) allowed to opposing position`} />

      {/* Scope toggle + legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {[
            ['matchup', `${gameInfo.awayAbbr} & ${gameInfo.homeAbbr}`],
            ['all', 'ALL 30 TEAMS'],
          ].map(([v, l]) => (
            <button key={v} onClick={() => setScope(v)}
              style={{ padding: '4px 12px', background: scope === v ? 'rgba(0,212,255,0.1)' : 'transparent',
                border: `1px solid ${scope === v ? 'rgba(0,212,255,0.3)' : 'rgba(255,255,255,0.06)'}`,
                color: scope === v ? 'var(--cyan)' : 'var(--dim)', fontFamily: 'Space Mono, monospace',
                fontSize: 10, cursor: 'pointer', borderRadius: 2, letterSpacing: '0.1em' }}>
              {l}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.1em', marginLeft: 'auto' }}>
          CLICK ANY HEADER TO SORT
        </span>
      </div>

      <NbaDefenseLegend />

      {/* Table */}
      <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 4 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'Space Mono, monospace' }}>
          <thead>
            <tr style={{ background: 'rgba(0,212,255,0.04)' }}>
              <th style={headerCellStyle} onClick={() => onSort('position')}>POSITION{sortIndicator('position')}</th>
              <th style={headerCellStyle} onClick={() => onSort('team')}>TEAM{sortIndicator('team')}</th>
              {NBA_DVP_COLUMNS.map(col => (
                <th key={col.key} style={headerCellStyle} onClick={() => onSort(col.key)}>
                  {col.label}{sortIndicator(col.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const teamColor = r.defensive_team === canonAway ? '#00d4ff'
                : r.defensive_team === canonHome ? '#ffd060'
                : 'var(--text)';
              return (
                <tr key={`${r.defensive_team}-${r.position}`}
                  style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
                  <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700, fontSize: 11, color: 'var(--text)', letterSpacing: '0.1em' }}>
                    {r.position}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700, fontSize: 11, color: teamColor, letterSpacing: '0.1em' }}>
                    {r.defensive_team}
                  </td>
                  {NBA_DVP_COLUMNS.map(col => (
                    <NbaDefenseStatCell key={col.key}
                      value={r[col.valKey]}
                      rank={r.ranks?.[col.key]}
                      fmt={col.fmt} />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.08em', marginTop: 10 }}>
        EACH CELL: VALUE OVER LEAGUE RANK · #1/150 = STRONGEST DEFENSE FOR THAT STAT · {sorted.length} ROWS
      </div>
    </div>
  );
}

Object.assign(window, { NbaEdgeFinderTab, NbaLineupTab, NbaDefenseVsPositionTab });
