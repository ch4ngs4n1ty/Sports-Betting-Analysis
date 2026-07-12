/* ============================================================
   PLAYIQ — HOME SCREEN
   Sport selection
   ============================================================ */

function HomeScreen({ onSelectSport }) {
  // Wake up the Render backend in the background while the user picks a sport.
  // No-op locally; ~1 ping while sleeping is enough to start the cold start.
  React.useEffect(() => { prewarmBackend(); }, []);

  const sports = [
    { key: 'mlb', label: 'MLB', full: 'Major League Baseball', active: true, season: 'Spring 2026' },
    { key: 'nba', label: 'NBA', full: 'National Basketball Association', active: true, season: 'Season 2025-26' },
    { key: 'wnba', label: 'WNBA', full: "Women's National Basketball Association", active: true, season: 'Season 2026' },
    { key: 'nhl', label: 'NHL', full: 'National Hockey League', active: true, season: 'Season 2025-26' },
    { key: 'ncaamb', label: 'NCAAB', full: 'College Basketball', active: false, season: 'Off-season' },
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
              <div style={{ fontFamily: 'Orbitron, monospace', fontSize: sp.key === 'mlb' ? 56 : 42, fontWeight: 900, color: sp.active ? 'var(--text)' : 'var(--dim)', lineHeight: 1, letterSpacing: '0.04em' }}>{sp.label}</div>
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

Object.assign(window, { HomeScreen });
