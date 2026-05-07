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
  const { gameInfo, nbaEdgeData } = gameData;
  const [filter, setFilter] = React.useState('all');

  if (!nbaEdgeData) return <div style={emptyMsg}>NBA edge data loading or unavailable.</div>;
  const { players } = nbaEdgeData;
  if (!players?.length) return <div style={emptyMsg}>No players found.</div>;

  const displayed = filter === 'all' ? players : players.filter(p => p.side === filter);

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

function NbaPlayerColumn({ player, accent, align }) {
  if (!player) {
    return (
      <div style={{ flex: 1, padding: 12, opacity: 0.4, textAlign: align, fontFamily: 'Space Mono, monospace', fontSize: 10, color: 'var(--dim)', letterSpacing: '0.1em' }}>
        NO STARTER
      </div>
    );
  }
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: align === 'right' ? 'flex-end' : 'flex-start', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexDirection: align === 'right' ? 'row-reverse' : 'row' }}>
        <PlayerCard player={{ name: player.name, headshot: player.headshot, pos: player.pos }} size="sm" accent={accent} />
        <div style={{ textAlign: align }}>
          <div style={{ fontSize: 13, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700 }}>{player.name}</div>
          <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.08em' }}>
            {player.pos}{player.jersey && player.jersey !== '—' ? ` · #${player.jersey}` : ''}
          </div>
        </div>
      </div>
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

function NbaMatchupRow({ matchup, awayAbbr, homeAbbr, awayColor, homeColor }) {
  const [mode, setMode] = React.useState('season'); // 'season' | 'h2h' | 'l5'
  const a = matchup.away;
  const h = matchup.home;
  const aStats = a ? a[mode] : null;
  const hStats = h ? h[mode] : null;
  const aGames = a ? (mode === 'h2h' ? a.h2hCount : a[mode]?.games) : 0;
  const hGames = h ? (mode === 'h2h' ? h.h2hCount : h[mode]?.games) : 0;

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

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
        <NbaPlayerColumn player={a} accent={awayColor} align="left" />
        <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 11, color: 'var(--dim)', letterSpacing: '0.15em' }}>VS</div>
        <NbaPlayerColumn player={h} accent={homeColor} align="right" />
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
  const { gameInfo, nbaLineupData, injuries, awayRoster, homeRoster } = gameData || {};
  const [data, setData] = React.useState(nbaLineupData);
  const [refreshing, setRefreshing] = React.useState(false);
  const refreshingRef = React.useRef(false);

  // Sync external updates (e.g. when game changes)
  React.useEffect(() => { setData(nbaLineupData); }, [nbaLineupData]);

  const refresh = React.useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const fresh = await buildNbaLineupData(gameInfo, awayRoster, homeRoster, { refresh: true });
      if (fresh) setData(fresh);
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
    return <div style={emptyMsg}>Lineup data loading or unavailable.</div>;
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {data.matchups.map(m => (
          <NbaMatchupRow key={m.position} matchup={m}
            awayAbbr={gameInfo.awayAbbr} homeAbbr={gameInfo.homeAbbr}
            awayColor={awayColor} homeColor={homeColor} />
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { NbaEdgeFinderTab, NbaLineupTab });
