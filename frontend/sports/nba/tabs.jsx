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
  if (sk === 'reb') return v >= 12 ? 'var(--green)' : v >= 8 ? 'var(--gold)' : v >= 4 ? 'var(--cyan)' : 'var(--muted)';
  if (sk === 'ast') return v >= 10 ? 'var(--green)' : v >= 6 ? 'var(--gold)' : v >= 3 ? 'var(--cyan)' : 'var(--muted)';
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
    const confColor = r.conf === 'HIGH' ? '#00ff88' : r.conf === 'MED' ? '#ffd060' : 'var(--muted)';
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 10px', borderRadius: 3,
        background: idx % 2 ? 'transparent' : 'rgba(255,255,255,0.02)', flexWrap: 'wrap' }}>
        <span style={{ width: 20, textAlign: 'center', fontSize: 14, fontFamily: 'Orbitron, monospace', fontWeight: 900,
          color: idx === 0 ? '#00ff88' : idx <= 2 ? 'var(--cyan)' : 'var(--muted)' }}>{idx + 1}</span>
        <img src={p.headshot} alt={p.name} style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', border: `1px solid ${p.teamColor}55` }}
          onError={e => e.target.style.display = 'none'} />
        <div style={{ flex: 1, minWidth: 150 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700 }}>{p.name}</span>
            <span style={{ fontSize: 9.5, padding: '1px 6px', border: `1px solid ${p.teamColor}66`, color: p.teamColor, fontFamily: 'Space Mono, monospace', borderRadius: 2, letterSpacing: '0.08em' }}>{p.teamAbbr} {p.pos}</span>
            {p.isStarter && <span style={{ fontSize: 9.5, color: 'var(--green)', fontFamily: 'Orbitron, monospace', fontWeight: 700, letterSpacing: '0.12em' }}>★</span>}
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', marginTop: 2 }}>
            proj <span style={{ color: 'var(--text)', fontWeight: 700 }}>{r.proj.toFixed(1)}</span>
            {' · '}{r.hasMatchup && r.defRank != null
              ? <span style={{ color: nbaDefenseRankColor(r.defRank) === 'red' ? '#ff8a55' : nbaDefenseRankColor(r.defRank) === 'green' ? '#5ff5a5' : '#ffd060' }}>vs #{r.defRank}/{r.total} D</span>
              : <span style={{ color: 'var(--muted)' }}>no matchup adj</span>}
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
              <span style={{ fontSize: 10, padding: '2px 7px', border: `1px solid ${p.teamColor}66`, color: p.teamColor, fontFamily: 'Space Mono, monospace', borderRadius: 2, letterSpacing: '0.08em' }}>{p.teamAbbr}</span>
              <span style={{ fontSize: 10, padding: '2px 7px', border: `1px solid ${p.teamColor}44`, color: p.teamColor, fontFamily: 'Space Mono, monospace', borderRadius: 2 }}>{p.pos}</span>
              {p.jersey && p.jersey !== '—' && <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace' }}>#{p.jersey}</span>}
              {p.isStarter && (
                <span style={{ fontSize: 10, padding: '2px 7px', background: 'rgba(0,255,136,0.12)', border: '1px solid rgba(0,255,136,0.35)', color: 'var(--green)', fontFamily: 'Orbitron, monospace', fontWeight: 700, borderRadius: 2, letterSpacing: '0.15em' }}>★ STARTER</span>
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
                <div style={{ fontSize: 9.5, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.16em', marginBottom: 2 }}>{l}</div>
                <div style={{ fontSize: 18, fontFamily: 'Orbitron, monospace', fontWeight: 700, color: p.teamColor }}>{v.toFixed(1)}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 10, borderLeft: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.15em' }}>
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
                <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: p.teamColor, letterSpacing: '0.22em' }}>
                  HEAD-TO-HEAD vs {p.oppAbbr}
                </span>
                <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace' }}>
                  {hasH2H ? `${p.h2h.length}G · last: ${p.h2h[0].date}` : 'NO GAMES'}
                </span>
              </div>
              {hasH2H ? (
                <GameLogChart games={p.h2h} stats={NBA_STATS} defaultStat="pts" emptyLabel={`NO GAMES VS ${p.oppAbbr} THIS SEASON`} accent={p.teamColor} colorFor={nbaStatColorFor} />
              ) : (
                <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', padding: '16px 0', letterSpacing: '0.1em' }}>
                  NO GAMES VS {p.oppAbbr} THIS SEASON
                </div>
              )}
            </div>

            <div style={{ paddingTop: 18, marginTop: 18, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: p.teamColor, letterSpacing: '0.22em', marginBottom: 10 }}>
                LAST 5 GAMES (SEASON)
              </div>
              {hasL5 ? (
                <GameLogChart games={p.l5} stats={NBA_STATS} defaultStat="pts" emptyLabel="NO RECENT GAMES" accent={p.teamColor} colorFor={nbaStatColorFor} />
              ) : (
                <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', padding: '16px 0', letterSpacing: '0.1em' }}>
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
                color: filter === v ? 'var(--cyan)' : 'var(--muted)', fontFamily: 'Space Mono, monospace',
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
          <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', letterSpacing: '0.1em' }}>
            LIKELIHOOD TO HIT THRESHOLD · ranked
          </span>
          {!nbaDefenseEdge && (
            <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)' }}>
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
                  color: modelLine === line ? 'var(--cyan)' : 'var(--muted)', fontFamily: 'Space Mono, monospace',
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
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', padding: '12px 0' }}>
            No players with game-log data yet.
          </div>
        )}

        <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', marginTop: 12, lineHeight: 1.6, letterSpacing: '0.04em' }}>
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
      <span style={{ fontSize: 10, fontFamily: 'Orbitron, monospace', color: 'var(--muted)', letterSpacing: '0.18em' }}>
        DEFENSE VS POSITION
      </span>
      {items.map(it => {
        const c = NBA_DEF_COLORS[it.tier];
        return (
          <div key={it.tier} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: c.bg, border: `1px solid ${c.border}` }} />
            <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: c.text, letterSpacing: '0.05em' }}>
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
      <div style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', letterSpacing: '0.08em', textAlign: align }}>
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
        <span style={{ fontSize: 10, fontFamily: 'Orbitron, monospace', fontWeight: 700, color: c.text, letterSpacing: '0.15em' }}>
          vs {edge.opponent} {edge.position} · #{edge.rank}/150
        </span>
      </div>
      <div style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: c.text, letterSpacing: '0.08em' }}>
        {edge.points_allowed_per_48.toFixed(1)} pts/48 allowed · {c.label}
      </div>
    </div>
  );
}

function NbaPlayerColumn({ player, accent, align, defenseEdge, showDefense = true }) {
  if (!player) {
    return (
      <div style={{ flex: 1, padding: 12, opacity: 0.4, textAlign: align, fontFamily: 'Space Mono, monospace', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.1em' }}>
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
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.08em' }}>
            {player.pos}{player.jersey && player.jersey !== '—' ? ` · #${player.jersey}` : ''}
          </div>
        </div>
      </div>
      {showDefense && <NbaDefenseChip edge={defenseEdge} align={align} />}
    </div>
  );
}

function NbaStatRow({ label, awayVal, homeVal, fmt, lowerIsBetter, awayColor, homeColor }) {
  const winner = _nbaPickEdge(awayVal, homeVal, lowerIsBetter);
  const colA = winner === 'away' ? awayColor : winner === 'home' ? 'var(--muted)' : 'var(--muted)';
  const colH = winner === 'home' ? homeColor : winner === 'away' ? 'var(--muted)' : 'var(--muted)';
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
      <div style={{ textAlign: 'center', fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', letterSpacing: '0.18em' }}>{label}</div>
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

function NbaMatchupRow({ matchup, awayAbbr, homeAbbr, awayColor, homeColor, defenseEdge, showDefense = true }) {
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
          <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.15em' }}>
            POSITION MATCHUP
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[['season', 'SEASON'], ['l5', 'L5'], ['h2h', `H2H`]].map(([v, l]) => (
            <button key={v} onClick={() => setMode(v)}
              style={{ padding: '3px 10px', background: mode === v ? 'rgba(0,212,255,0.1)' : 'transparent',
                border: `1px solid ${mode === v ? 'rgba(0,212,255,0.3)' : 'rgba(255,255,255,0.06)'}`,
                color: mode === v ? 'var(--cyan)' : 'var(--muted)', fontFamily: 'Space Mono, monospace',
                fontSize: 10, cursor: 'pointer', borderRadius: 2, letterSpacing: '0.1em' }}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 12 }}>
        <NbaPlayerColumn player={a} accent={awayColor} align="left" defenseEdge={awayDefense} showDefense={showDefense} />
        <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.15em', paddingTop: 14 }}>VS</div>
        <NbaPlayerColumn player={h} accent={homeColor} align="right" defenseEdge={homeDefense} showDefense={showDefense} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', letterSpacing: '0.1em', marginBottom: 8, padding: '6px 0', borderTop: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <span>{awayAbbr} · {aGames || 0} GAMES{mode === 'h2h' ? ` VS ${homeAbbr}` : ''}</span>
        <span style={{ color: 'var(--muted)' }}>
          {mode === 'season' ? 'SEASON AVERAGES' : mode === 'l5' ? 'LAST 5 AVERAGES' : `HEAD-TO-HEAD AVERAGES`}
        </span>
        <span>{homeAbbr} · {hGames || 0} GAMES{mode === 'h2h' ? ` VS ${awayAbbr}` : ''}</span>
      </div>

      {(!aStats || !aStats.games) && (!hStats || !hStats.games) ? (
        <div style={{ textAlign: 'center', padding: '20px 0', fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.1em' }}>
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
              <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.08em' }}>
                {injury.pos}
              </span>
            )}
            <span style={{ fontSize: 10, fontFamily: 'Orbitron, monospace', fontWeight: 700, color, letterSpacing: '0.18em',
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
              <div style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', letterSpacing: '0.08em' }}>
                <span style={{ color: 'var(--muted)' }}>EST. RETURN ·</span>{' '}
                <span style={{ color: 'var(--cyan)' }}>{injury.returnDate}</span>
              </div>
            )}
            {injury.reportedDate && (
              <div style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', letterSpacing: '0.08em' }}>
                <span style={{ color: 'var(--muted)' }}>REPORTED ·</span>{' '}
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
        <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.1em' }}>
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
        <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', padding: '12px 0', letterSpacing: '0.1em' }}>
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
      <span style={{ fontSize: 10, fontFamily: 'Orbitron, monospace', fontWeight: 700, color: 'var(--cyan)', letterSpacing: '0.18em' }}>
        SOURCE · {sourceLabel}
      </span>
      <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', letterSpacing: '0.1em' }}>·</span>
      <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: awayColor, fontWeight: 700 }}>{awayAbbr}</span>
        <span style={{ color: _statusColor(awayStatus), letterSpacing: '0.1em', textTransform: 'uppercase' }}>{awayStatus}</span>
      </span>
      <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: homeColor, fontWeight: 700 }}>{homeAbbr}</span>
        <span style={{ color: _statusColor(homeStatus), letterSpacing: '0.1em', textTransform: 'uppercase' }}>{homeStatus}</span>
      </span>
      <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', letterSpacing: '0.1em', marginLeft: 'auto' }}>
        UPDATED · {_formatLineupTimestamp(data?.fetchedAt)}
      </span>
      <button onClick={onRefresh} disabled={refreshing}
        style={{ padding: '4px 12px', background: refreshing ? 'transparent' : 'rgba(0,212,255,0.08)',
          border: `1px solid ${refreshing ? 'rgba(255,255,255,0.06)' : 'rgba(0,212,255,0.25)'}`,
          color: refreshing ? 'var(--muted)' : 'var(--cyan)', fontFamily: 'Space Mono, monospace',
          fontSize: 10, cursor: refreshing ? 'default' : 'pointer', borderRadius: 2, letterSpacing: '0.12em' }}>
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

  // WNBA reuses this tab. It has no Rotowire feed and no defense-vs-position
  // table (both NBA-only backends), so dispatch the builder and skip defense.
  const isWnba = gameInfo?.sportKey === 'wnba';

  const refresh = React.useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      // Pull lineups + positional defense in parallel — both keyed on starters,
      // so a roster change must update both signals together.
      const [freshLineup, freshDefense] = await Promise.all([
        isWnba
          ? buildWnbaLineupData(gameInfo, awayRoster, homeRoster, { refresh: true })
          : buildNbaLineupData(gameInfo, awayRoster, homeRoster, { refresh: true }),
        isWnba
          ? Promise.resolve(null)
          : fetchNbaPositionalDefenseEdge(gameInfo, { refresh: true }),
      ]);
      if (freshLineup) setData(freshLineup);
      if (freshDefense) setDefenseEdge(freshDefense);
    } catch (e) {
      console.warn('Lineup refresh failed:', e);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [gameInfo, awayRoster, homeRoster, isWnba]);

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

      {!isWnba && <NbaDefenseLegend />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {data.matchups.map(m => (
          <NbaMatchupRow key={m.position} matchup={m}
            awayAbbr={gameInfo.awayAbbr} homeAbbr={gameInfo.homeAbbr}
            awayColor={awayColor} homeColor={homeColor}
            defenseEdge={defenseEdge} showDefense={!isWnba} />
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
      <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em', marginTop: 2 }}>
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
    fontFamily: 'Space Mono, monospace', fontSize: 10, letterSpacing: '0.18em',
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
                color: scope === v ? 'var(--cyan)' : 'var(--muted)', fontFamily: 'Space Mono, monospace',
                fontSize: 10, cursor: 'pointer', borderRadius: 2, letterSpacing: '0.1em' }}>
              {l}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.1em', marginLeft: 'auto' }}>
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

      <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.08em', marginTop: 10 }}>
        EACH CELL: VALUE OVER LEAGUE RANK · #1/150 = STRONGEST DEFENSE FOR THAT STAT · {sorted.length} ROWS
      </div>
    </div>
  );
}

/* ============================================================
   WNBA LINEUP — COURT VIEW
   Same idea as the MLB field tab: put every starter on the floor
   at the spot she plays, so "who is on the court" is one glance
   instead of a list to read. The floor is a CSS-perspective plane
   (rotateX) — no WebGL — and each card is counter-rotated by the
   same angle so names stay flat to the camera and crisp.

   Both fives are on screen at once (away in the far half, home in
   the near half) because this data arrives as POSITION MATCHUPS —
   showing the pairing is the whole point, and it's the one thing
   the MLB field can't do.
   ============================================================ */

// The court is drawn in a 100x100 viewBox: sidelines at x 8..92 (50 ft
// across) and baselines at y 6..94 (94 ft long). Those two axes therefore
// carry DIFFERENT units-per-foot — the length is deliberately squeezed so
// that after the rotateX the floor reads like a broadcast baseline camera.
// Consequence: every circle must be drawn as a pre-compensated ellipse
// (rx from WCT_X, ry from WCT_Y). Same trick as the MLB diamond.
const WCT = { x0: 8, x1: 92, y0: 6, y1: 94, cx: 50 };
const WCT_X = (WCT.x1 - WCT.x0) / 50;   // viewBox units per foot, across
const WCT_Y = (WCT.y1 - WCT.y0) / 94;   // viewBox units per foot, along
const wctX = ft => WCT.cx + ft * WCT_X;             // feet from center line
const wctY = (ft, end) => end === 'near'            // feet from that baseline
  ? WCT.y1 - ft * WCT_Y
  : WCT.y0 + ft * WCT_Y;

// WNBA three-point line: a 22'1.75" arc off the rim with straight corner
// segments, FIBA-style. The straights meet the arc 7.35 ft up the floor.
const WCT_3PT_CORNER = 22.05, WCT_3PT_R = 22.15, WCT_3PT_BREAK = 7.35;

// Half-court sets, given as (feet from the center line, feet from own
// baseline) so the shape stays readable as basketball rather than as pixel
// coordinates. `prefer` is the group fallback chain for that spot and `fill`
// the order the spots get resolved in — interior first, because those are the
// spots that read wrong if the wrong body ends up there.
const WCT_SLOTS = [
  { key: 'g1', group: 'G', label: 'POINT', ft: [0, 34],   prefer: ['G', 'F', 'C'], fill: 3 },
  { key: 'g2', group: 'G', label: 'WING',  ft: [-21, 26], prefer: ['G', 'F', 'C'], fill: 4 },
  { key: 'f1', group: 'F', label: 'WING',  ft: [21, 26],  prefer: ['F', 'G', 'C'], fill: 5 },
  { key: 'f2', group: 'F', label: 'POST',  ft: [-10, 14], prefer: ['F', 'C', 'G'], fill: 2 },
  { key: 'c1', group: 'C', label: 'RIM',   ft: [8, 7],    prefer: ['C', 'F', 'G'], fill: 1 },
];

// Away is point-reflected into the far half so the two fives face each other.
function wctSpot(slot, side) {
  const [fx, fy] = slot.ft;
  const end = side === 'home' ? 'near' : 'far';
  return { x: wctX(side === 'home' ? fx : -fx), y: wctY(fy, end) };
}

// Kept gentle on purpose: enough depth cue to sort near from far, not so
// much that the away five becomes unreadable.
const wctDepth = y => 0.86 + 0.24 * (y / 100);
const wctLast = n => String(n || '').trim().split(/\s+/).slice(-1)[0] || '—';
const wctGroup = p => {
  const fromSlot = String(p?.slotLabel || '')[0]?.toUpperCase();
  if (fromSlot === 'G' || fromSlot === 'F' || fromSlot === 'C') return fromSlot;
  const p2 = String(p?.pos || '').toUpperCase();
  if (p2.startsWith('C')) return 'C';
  if (p2 === 'F' || p2 === 'SF' || p2 === 'PF' || p2 === 'FORWARD') return 'F';
  return 'G';
};

// Resolve SLOTS against players rather than players against slots. WNBA
// position data is coarse (G/F/C) and small-ball fives are common — Dallas
// starts three guards and no center — so filling the rim spot with "whoever
// is left over" strands a guard under the basket. Walking the spots in `fill`
// order and letting each take the best body available instead puts the two
// biggest players inside and the extra guard out on the wing, which is what
// the lineup actually looks like. Within a preference tier the most-played
// player wins, so the primary ball-handler gets POINT.
function wctAssignSlots(players) {
  const pool = players.slice().sort((a, b) => (b.season?.min || 0) - (a.season?.min || 0));
  const taken = new Set();
  const chosen = {};
  for (const slot of WCT_SLOTS.slice().sort((a, b) => a.fill - b.fill)) {
    let pick = null;
    for (const group of slot.prefer) {
      pick = pool.find(p => !taken.has(p) && wctGroup(p) === group);
      if (pick) break;
    }
    if (pick) taken.add(pick);
    chosen[slot.key] = pick || null;
  }
  return WCT_SLOTS.map(slot => ({ slot, player: chosen[slot.key] }));
}

const WCT_TILTS = [['BROADCAST', 56], ['ANGLED', 34], ['OVERHEAD', 6]];

// One end of the floor: paint, free-throw circle, restricted arc, rim,
// backboard and the three-point line. Mirrored for the far end.
function WnbaCourtEnd({ end, accent }) {
  const y = ft => wctY(ft, end);
  const sweep = end === 'near' ? 1 : 0;      // which way each arc bulges inward
  const line = 'rgba(233,242,252,0.30)';
  const rimY = y(5.25);
  return (
    <g fill="none" stroke={line} strokeWidth="0.45">
      {/* paint — 16 ft wide, 19 ft deep */}
      <rect x={wctX(-8)} y={Math.min(y(0), y(19))} width={16 * WCT_X} height={19 * WCT_Y}
        fill="rgba(0,0,0,0.16)" stroke={line} strokeWidth="0.45" />
      <ellipse cx={WCT.cx} cy={y(19)} rx={6 * WCT_X} ry={6 * WCT_Y} />
      {/* restricted area + rim + backboard */}
      <path d={`M ${wctX(-4)},${rimY} A ${4 * WCT_X} ${4 * WCT_Y} 0 0 ${sweep} ${wctX(4)},${rimY}`} />
      <ellipse cx={WCT.cx} cy={rimY} rx={0.75 * WCT_X} ry={0.75 * WCT_Y} stroke="#ff6b35" strokeWidth="0.6" />
      <path d={`M ${wctX(-3)},${y(4)} L ${wctX(3)},${y(4)}`} stroke="rgba(233,242,252,0.5)" strokeWidth="0.7" />
      {/* three-point line */}
      <path d={`M ${wctX(-WCT_3PT_CORNER)},${y(0)}
                L ${wctX(-WCT_3PT_CORNER)},${y(WCT_3PT_BREAK)}
                A ${WCT_3PT_R * WCT_X} ${WCT_3PT_R * WCT_Y} 0 0 ${sweep} ${wctX(WCT_3PT_CORNER)},${y(WCT_3PT_BREAK)}
                L ${wctX(WCT_3PT_CORNER)},${y(0)}`}
        stroke={accent} strokeWidth="0.5" opacity="0.75" />
    </g>
  );
}

function WnbaCourtCard({ entry, side, accent, tilt, selId, onSelect, idx }) {
  const { slot, player } = entry;
  const spot = wctSpot(slot, side);
  const isSel = player && String(player.id) === String(selId);
  const dim = selId && !isSel;
  const depth = wctDepth(spot.y);
  const size = player ? 46 : 28;
  return (
    <div style={{ position: 'absolute', left: `${spot.x}%`, top: `${spot.y}%`, width: 0, height: 0,
      transformStyle: 'preserve-3d', zIndex: isSel ? 40 : Math.round(spot.y) }}>
      {/* contact shadow stays flat on the hardwood — this is what sells the depth */}
      <div style={{ position: 'absolute', left: -24 * depth, top: -5, width: 48 * depth, height: 12 * depth,
        borderRadius: '50%', background: 'rgba(0,0,0,0.5)', filter: 'blur(4px)', pointerEvents: 'none',
        opacity: dim ? 0.3 : 1, transition: 'opacity 0.25s' }} />
      <div
        onClick={() => player && onSelect(isSel ? null : String(player.id))}
        title={player ? `${player.name} · ${player.slotLabel || slot.group} · ${slot.label}` : `${slot.group} — not set`}
        style={{
          position: 'absolute', bottom: 0, left: 0,
          transform: `translateX(-50%) rotateX(-${tilt}deg) scale(${depth * (isSel ? 1.16 : 1)})`,
          transformOrigin: 'center bottom',
          transition: 'transform 0.3s cubic-bezier(0.16,1,0.3,1), opacity 0.25s',
          opacity: dim ? 0.4 : 1,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          cursor: player ? 'pointer' : 'default', userSelect: 'none',
          animation: `fadeUp 0.45s ease ${idx * 55}ms backwards`,
        }}>
        {player ? (
          <>
            <div style={{ position: 'relative' }}>
              {/* halo pool for separation against the floor */}
              <div style={{ position: 'absolute', inset: -5, borderRadius: '50%',
                background: `radial-gradient(circle, ${accent}33 0%, transparent 70%)`, pointerEvents: 'none' }} />
              <div style={{ position: 'relative', width: size, height: size, borderRadius: '50%', overflow: 'hidden',
                border: `2.5px solid ${isSel ? accent : accent + 'aa'}`,
                background: 'linear-gradient(180deg, #16223a 0%, #0d1524 100%)',
                boxShadow: isSel ? `0 0 22px ${accent}, 0 6px 14px rgba(0,0,0,0.6)` : `0 0 10px ${accent}55, 0 5px 12px rgba(0,0,0,0.55)` }}>
                {player.headshot && (
                  <img src={player.headshot} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={e => { e.target.style.display = 'none'; }} />
                )}
              </div>
              {player.jersey && player.jersey !== '—' && (
                <div style={{ position: 'absolute', top: -3, left: -7, minWidth: 18, height: 18, padding: '0 3px', borderRadius: 9,
                  background: 'var(--bg)', border: `1.5px solid ${accent}`, color: accent,
                  fontFamily: 'Orbitron, monospace', fontSize: 9.5, fontWeight: 900, lineHeight: '15px',
                  textAlign: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.5)' }}>{player.jersey}</div>
              )}
            </div>
            {/* name plate — the primary "who is that" signal */}
            <div style={{ padding: '2px 7px', borderRadius: 3, background: 'rgba(5,8,15,0.94)',
              border: `1px solid ${accent}66`, whiteSpace: 'nowrap', backdropFilter: 'blur(2px)',
              boxShadow: '0 3px 8px rgba(0,0,0,0.45)' }}>
              <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700, letterSpacing: '0.02em' }}>
                {wctLast(player.name)}
              </span>
              <span style={{ fontSize: 9.5, fontFamily: 'Orbitron, monospace', color: accent, marginLeft: 5, letterSpacing: '0.08em' }}>
                {player.slotLabel || slot.group}
              </span>
            </div>
          </>
        ) : (
          <>
            <div style={{ width: size, height: size, borderRadius: '50%', border: '1.5px dashed rgba(255,255,255,0.22)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(5,8,15,0.35)' }}>
              <span style={{ fontSize: 9.5, fontFamily: 'Orbitron, monospace', color: 'var(--muted)', letterSpacing: '0.1em' }}>{slot.group}</span>
            </div>
            <span style={{ fontSize: 9.5, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', letterSpacing: '0.1em' }}>—</span>
          </>
        )}
      </div>
    </div>
  );
}

// Season / L5 / vs-opponent averages for the tapped player.
function WnbaSplitRow({ label, agg, accent }) {
  const cell = (v, digits = 1) => (v == null ? '—' : Number(v).toFixed(digits));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <span style={{ width: 74, fontSize: 9.5, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', letterSpacing: '0.12em' }}>
        {label}
      </span>
      {[['MIN', agg?.min], ['PTS', agg?.pts], ['REB', agg?.reb], ['AST', agg?.ast]].map(([k, v]) => (
        <span key={k} style={{ fontSize: 9.5, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', letterSpacing: '0.08em' }}>
          {k}{' '}
          <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 12, fontWeight: 700, color: agg ? accent : 'var(--muted)' }}>
            {cell(v)}
          </span>
        </span>
      ))}
      <span style={{ fontSize: 9.5, fontFamily: 'Space Mono, monospace', color: 'var(--muted)' }}>
        {agg?.games ? `${agg.games} G` : 'no games'}
      </span>
    </div>
  );
}

function WnbaCourtLineupTab({ gameData }) {
  const { gameInfo, nbaLineupData, injuries, awayRoster, homeRoster } = gameData || {};
  const [data, setData] = React.useState(nbaLineupData);
  const [tilt, setTilt] = React.useState(56);
  const [focus, setFocus] = React.useState('both');   // 'both' | 'away' | 'home'
  const [selId, setSelId] = React.useState(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const refreshingRef = React.useRef(false);

  React.useEffect(() => { setData(nbaLineupData); }, [nbaLineupData]);

  const refresh = React.useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const fresh = await buildWnbaLineupData(gameInfo, awayRoster, homeRoster, { refresh: true });
      if (fresh) setData(fresh);
    } catch (e) {
      console.warn('WNBA lineup refresh failed:', e);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [gameInfo, awayRoster, homeRoster]);

  // ESPN only publishes real starters once the game tips, so poll harder
  // while the five is still projected.
  React.useEffect(() => {
    const s = data?.lineupStatus;
    const allConfirmed = s?.away === 'confirmed' && s?.home === 'confirmed';
    const id = setInterval(refresh, allConfirmed ? 5 * 60 * 1000 : 60 * 1000);
    return () => clearInterval(id);
  }, [data?.lineupStatus?.away, data?.lineupStatus?.home, refresh]);

  if (!data) {
    if (gameData?._loading?.nbaLineupData !== false) return <TabLoader source="ESPN" label="Setting the floor..." rows={3} />;
    return <div style={emptyMsg}>Lineup data unavailable.</div>;
  }

  const AWAY = '#00d4ff', HOME = '#ffd060';

  // The builder hands us position matchups; the court needs them re-split
  // per side, and the pairing kept so a tap can show the direct opponent.
  const fives = { away: [], home: [] };
  const opponentOf = new Map();
  for (const m of data.matchups || []) {
    if (m.away) fives.away.push({ ...m.away, slotLabel: m.position });
    if (m.home) fives.home.push({ ...m.home, slotLabel: m.position });
    if (m.away && m.home) {
      opponentOf.set(String(m.away.id), { player: m.home, side: 'home', position: m.position });
      opponentOf.set(String(m.home.id), { player: m.away, side: 'away', position: m.position });
    }
  }
  const placed = { away: wctAssignSlots(fives.away), home: wctAssignSlots(fives.home) };

  const selected = [...fives.away, ...fives.home].find(p => String(p.id) === String(selId)) || null;
  const selSide = selected && fives.away.some(p => String(p.id) === String(selected.id)) ? 'away' : 'home';
  const selAccent = selSide === 'away' ? AWAY : HOME;
  const versus = selected ? opponentOf.get(String(selected.id)) : null;

  const isLive = gameInfo.statusState === 'in';
  const statusPill = (side, abbr, color) => {
    const confirmed = data.lineupStatus?.[side] === 'confirmed';
    return (
      <span key={side} style={{ fontSize: 9.5, padding: '3px 9px', borderRadius: 2, fontFamily: 'Space Mono, monospace',
        letterSpacing: '0.1em', color: confirmed ? '#00ff88' : color,
        background: confirmed ? 'rgba(0,255,136,0.1)' : `${color}1a`,
        border: `1px solid ${confirmed ? 'rgba(0,255,136,0.35)' : color + '59'}` }}>
        {abbr} {confirmed ? '✓ CONFIRMED' : '◐ PROJECTED'}
      </span>
    );
  };

  const anyProjected = data.lineupStatus?.away !== 'confirmed' || data.lineupStatus?.home !== 'confirmed';
  // Wrapper aspect tracks the tilt so the floor never gets clipped when the
  // camera swings overhead, and never leaves a slab of dead space when flat.
  const wrapRatio = (0.9 * Math.cos(tilt * Math.PI / 180) + 0.15).toFixed(3);

  return (
    <div style={{ padding: '20px 0' }}>
      <NbaInjuryReport injuries={injuries}
        awayAbbr={gameInfo.awayAbbr} homeAbbr={gameInfo.homeAbbr}
        awayColor={AWAY} homeColor={HOME} />

      <SectionHeader label="LINEUPS — COURT VIEW"
        sub="Both fives placed where they play · tap a player for her splits and direct matchup" />

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {[['both', 'BOTH', 'var(--cyan)'], ['away', gameInfo.awayAbbr, AWAY], ['home', gameInfo.homeAbbr, HOME]].map(([v, l, c]) => (
            <button key={v} onClick={() => { setFocus(v); setSelId(null); }}
              style={{ padding: '6px 14px', background: focus === v ? `${c}1f` : 'transparent',
                border: `1px solid ${focus === v ? c + '73' : 'rgba(255,255,255,0.08)'}`,
                color: focus === v ? c : 'var(--muted)',
                fontFamily: 'Orbitron, monospace', fontWeight: 700, fontSize: 11, cursor: 'pointer',
                borderRadius: 2, letterSpacing: '0.1em' }}>{l}</button>
          ))}
        </div>
        {isLive && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 9.5, padding: '3px 9px', borderRadius: 2,
            fontFamily: 'Space Mono, monospace', letterSpacing: '0.12em', color: '#00ff88',
            background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.4)' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#00ff88',
              boxShadow: '0 0 6px #00ff88', animation: 'livePulse 1.6s ease-in-out infinite' }} />
            ON THE COURT NOW
          </span>
        )}
        {statusPill('away', gameInfo.awayAbbr, AWAY)}
        {statusPill('home', gameInfo.homeAbbr, HOME)}
        <button onClick={refresh} disabled={refreshing}
          style={{ padding: '3px 10px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
            color: refreshing ? 'var(--muted)' : 'var(--cyan)', fontFamily: 'Space Mono, monospace',
            fontSize: 9.5, cursor: refreshing ? 'default' : 'pointer', borderRadius: 2, letterSpacing: '0.1em' }}>
          {refreshing ? '· SYNCING' : '↻ REFRESH'}
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 9.5, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.14em' }}>CAMERA</span>
          {WCT_TILTS.map(([l, deg]) => (
            <button key={l} onClick={() => setTilt(deg)}
              style={{ padding: '4px 9px', background: tilt === deg ? 'rgba(0,212,255,0.1)' : 'transparent',
                border: `1px solid ${tilt === deg ? 'rgba(0,212,255,0.35)' : 'rgba(255,255,255,0.07)'}`,
                color: tilt === deg ? 'var(--cyan)' : 'var(--muted)', fontFamily: 'Space Mono, monospace',
                fontSize: 9.5, cursor: 'pointer', borderRadius: 2, letterSpacing: '0.08em' }}>{l}</button>
          ))}
        </div>
      </div>

      {anyProjected && (
        <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', marginBottom: 10, lineHeight: 1.6 }}>
          The WNBA has no pre-game starter feed, so a projected five is the top five by season minutes. It flips to
          confirmed automatically once ESPN's box score opens at tip-off.
        </div>
      )}

      {/* ── The floor ── */}
      <div style={{ maxWidth: 780, margin: '0 auto 18px', perspective: '1200px', perspectiveOrigin: '50% 42%',
        position: 'relative', aspectRatio: `1 / ${wrapRatio}`,
        transition: 'aspect-ratio 0.5s cubic-bezier(0.16,1,0.3,1)' }}>
        <div style={{ position: 'absolute', left: 0, top: '50%', width: '100%', aspectRatio: '1 / 1',
          transform: `translateY(-50%) rotateX(${tilt}deg)`, transformOrigin: 'center center',
          transformStyle: 'preserve-3d', transition: 'transform 0.5s cubic-bezier(0.16,1,0.3,1)' }}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
            <defs>
              <linearGradient id="piqWood" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#5a3d21" /><stop offset="50%" stopColor="#6b4a28" /><stop offset="100%" stopColor="#432d18" />
              </linearGradient>
              <radialGradient id="piqArena" cx="50%" cy="12%" r="82%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.10" />
                <stop offset="45%" stopColor="#ffffff" stopOpacity="0.025" />
                <stop offset="100%" stopColor="#000000" stopOpacity="0.44" />
              </radialGradient>
              <clipPath id="piqCourt">
                <rect x={WCT.x0} y={WCT.y0} width={WCT.x1 - WCT.x0} height={WCT.y1 - WCT.y0} />
              </clipPath>
            </defs>

            {/* arena floor surrounding the court */}
            <rect x="0" y="0" width="100" height="100" fill="#080d14" />
            <rect x="2" y="1" width="96" height="98" fill="#0c1520" />

            {/* hardwood + planks */}
            <rect x={WCT.x0} y={WCT.y0} width={WCT.x1 - WCT.x0} height={WCT.y1 - WCT.y0} fill="url(#piqWood)" />
            <g clipPath="url(#piqCourt)">
              {Array.from({ length: 28 }, (_, i) => (
                <rect key={i} x={WCT.x0 + i * 3} y={WCT.y0} width="1.5" height={WCT.y1 - WCT.y0}
                  fill="#ffffff" opacity={i % 2 ? 0.028 : 0} />
              ))}
              {/* each team owns a half — the fastest read of who is where */}
              <rect x={WCT.x0} y={WCT.y0} width={WCT.x1 - WCT.x0} height={50 - WCT.y0} fill={AWAY} opacity="0.07" />
              <rect x={WCT.x0} y="50" width={WCT.x1 - WCT.x0} height={WCT.y1 - 50} fill={HOME} opacity="0.07" />
              {/* team marks painted on the floor */}
              {gameInfo.awayLogo && <image href={gameInfo.awayLogo} x="40" y="20" width="20" height="20" opacity="0.13" preserveAspectRatio="xMidYMid meet" />}
              {gameInfo.homeLogo && <image href={gameInfo.homeLogo} x="40" y="61" width="20" height="20" opacity="0.13" preserveAspectRatio="xMidYMid meet" />}
            </g>

            {/* markings */}
            <rect x={WCT.x0} y={WCT.y0} width={WCT.x1 - WCT.x0} height={WCT.y1 - WCT.y0}
              fill="none" stroke="rgba(233,242,252,0.42)" strokeWidth="0.6" />
            <path d={`M ${WCT.x0},50 L ${WCT.x1},50`} stroke="rgba(233,242,252,0.35)" strokeWidth="0.5" />
            <ellipse cx={WCT.cx} cy="50" rx={6 * WCT_X} ry={6 * WCT_Y}
              fill="none" stroke="rgba(233,242,252,0.35)" strokeWidth="0.5" />
            <WnbaCourtEnd end="far" accent={AWAY} />
            <WnbaCourtEnd end="near" accent={HOME} />

            {/* arena lighting + vignette */}
            <rect x="0" y="0" width="100" height="100" fill="url(#piqArena)" />
          </svg>

          {['away', 'home'].map(side => {
            const lit = focus === 'both' || focus === side;
            return (
              // A dimmed team is background context, so it stops taking clicks —
              // otherwise you can select a player you can barely see.
              <div key={side} style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d',
                opacity: lit ? 1 : 0.28, pointerEvents: lit ? 'auto' : 'none',
                transition: 'opacity 0.3s' }}>
                {placed[side].map((entry, i) => (
                  <WnbaCourtCard key={`${side}-${entry.slot.key}`} entry={entry} side={side}
                    accent={side === 'away' ? AWAY : HOME} tilt={tilt}
                    selId={lit ? selId : null}
                    onSelect={setSelId} idx={i + (side === 'away' ? 0 : 5)} />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Tapped player — her splits, plus who she lines up against */}
      {selected && (
        <HudCard style={{ padding: '12px 16px', marginBottom: 16 }} accent={selAccent}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700 }}>{selected.name}</span>
            <span style={{ fontSize: 9.5, padding: '2px 7px', border: `1px solid ${selAccent}66`, color: selAccent, fontFamily: 'Space Mono, monospace', borderRadius: 2 }}>
              {selected.slotLabel}{selected.jersey && selected.jersey !== '—' ? ` · #${selected.jersey}` : ''}
            </span>
            {versus && (
              <span style={{ marginLeft: 'auto', fontSize: 9.5, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', letterSpacing: '0.08em' }}>
                MATCHED ON{' '}
                <span style={{ color: versus.side === 'away' ? AWAY : HOME, fontWeight: 700 }}>{versus.player.name}</span>
                {versus.player.season?.pts != null && ` · ${versus.player.season.pts.toFixed(1)} PPG`}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <WnbaSplitRow label="SEASON" agg={selected.season} accent={selAccent} />
            <WnbaSplitRow label="LAST 5" agg={selected.l5} accent={selAccent} />
            <WnbaSplitRow label={`vs ${selSide === 'away' ? gameInfo.homeAbbr : gameInfo.awayAbbr}`} agg={selected.h2h} accent={selAccent} />
          </div>
        </HudCard>
      )}

      {/* The floor shows position, not pairing — so keep the matchup list */}
      <div style={{ fontSize: 9.5, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.18em', marginBottom: 8 }}>
        POSITION MATCHUPS
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(data.matchups || []).map(m => {
          const hot = [m.away, m.home].some(p => p && String(p.id) === String(selId));
          return (
            <div key={m.position}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 2,
                background: hot ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${hot ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)'}` }}>
              <span onClick={() => m.away && setSelId(String(m.away.id))}
                style={{ fontFamily: 'Space Mono, monospace', fontSize: 10, color: AWAY, cursor: m.away ? 'pointer' : 'default' }}>
                {m.away ? wctLast(m.away.name) : '—'}
              </span>
              <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 9.5, fontWeight: 900, color: 'var(--muted)', letterSpacing: '0.1em' }}>
                {m.position}
              </span>
              <span onClick={() => m.home && setSelId(String(m.home.id))}
                style={{ fontFamily: 'Space Mono, monospace', fontSize: 10, color: HOME, cursor: m.home ? 'pointer' : 'default' }}>
                {m.home ? wctLast(m.home.name) : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, { NbaEdgeFinderTab, NbaLineupTab, NbaDefenseVsPositionTab, WnbaCourtLineupTab });
