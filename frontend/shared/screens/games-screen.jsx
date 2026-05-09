/* ============================================================
   PLAYIQ — GAMES SCREEN
   Multi-sport schedule view
   ============================================================ */

function GamesScreen({ onSelectGame, onBack }) {
  const [games, setGames] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [date, setDate] = React.useState(new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }));
  const [filter, setFilter] = React.useState('all');

  React.useEffect(() => {
    // Mirror prewarm here in case the user lands on Games via deep link.
    prewarmBackend();
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

      {!loading && sports.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 20, overflowX: 'auto', paddingBottom: 4 }}>
          {sports.map(s => (
            <button key={s} onClick={() => setFilter(s)}
              style={{ padding: '6px 14px', background: filter===s ? 'rgba(0,212,255,0.1)' : 'transparent',
                border: `1px solid ${filter===s ? 'rgba(0,212,255,0.3)' : 'rgba(255,255,255,0.06)'}`,
                color: filter===s ? 'var(--cyan)' : 'var(--muted)', fontFamily: 'Space Mono, monospace',
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
                          <img src={g.awayLogo} alt={g.awayAbbr} style={{ width: 28, height: 28, objectFit: 'contain' }} onError={e => e.target.style.display='none'} />
                          <div>
                            <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{g.awayAbbr}</div>
                            {showScore && <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 22, fontWeight: 900, color: g.awayScore > g.homeScore ? 'var(--green)' : 'var(--text)', lineHeight: 1 }}>{g.awayScore}</div>}
                          </div>
                        </div>
                        <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 13, color: 'var(--dim)', fontWeight: 700, textAlign: 'center' }}>
                          {showScore ? '—' : 'VS'}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', flexDirection: 'row-reverse' }}>
                          <img src={g.homeLogo} alt={g.homeAbbr} style={{ width: 28, height: 28, objectFit: 'contain' }} onError={e => e.target.style.display='none'} />
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

const backBtnStyle = {
  background: 'transparent',
  border: '1px solid rgba(0,212,255,0.2)',
  color: 'var(--cyan)',
  fontFamily: 'Space Mono, monospace',
  fontSize: 10,
  letterSpacing: '0.12em',
  padding: '7px 14px',
  cursor: 'pointer',
  borderRadius: 2,
  flexShrink: 0,
};

Object.assign(window, { GamesScreen, backBtnStyle });
