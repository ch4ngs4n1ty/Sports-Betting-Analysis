/* ============================================================
   PLAYIQ — GAME DETAIL SCREEN
   Shared detail shell that plugs in sport-specific tabs
   ============================================================ */

const TABS_MLB = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'h2h', label: 'HEAD-TO-HEAD' },
  { id: 'form', label: 'LAST 5' },
  { id: 'roster', label: 'ROSTERS' },
  { id: 'edges', label: 'EDGE FINDER' },
  { id: 'pitching', label: 'PITCHING' },
  { id: 'ai', label: '◆ AI PLAYS' },
];

const TABS_NBA = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'h2h', label: 'HEAD-TO-HEAD' },
  { id: 'form', label: 'LAST 5' },
  { id: 'roster', label: 'ROSTERS' },
  { id: 'lineups', label: 'LINEUPS' },
  { id: 'def-vs-pos', label: 'DEFENSE vs POSITION' },
  { id: 'edges', label: 'EDGE FINDER' },
  { id: 'ai', label: '◆ AI PLAYS' },
];

const TABS_OTHER = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'h2h', label: 'HEAD-TO-HEAD' },
  { id: 'form', label: 'LAST 5' },
  { id: 'roster', label: 'ROSTERS' },
  { id: 'ai', label: '◆ AI PLAYS' },
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
      setLoading(true);
      setStepIdx(0);

      // ── Phase 1 (core data) ─────────────────────────────────────────────
      // Block on the small fetches that the Overview / H2H / Last 5 / Rosters
      // tabs need. As soon as these resolve, render the page so the user can
      // start exploring while heavier extras load in the background.
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

        if (cancelled) return;

        // Render the page now — user can read Overview while extras load
        const initLoading = game.sportKey === 'mlb'
          ? { mlbEdgeData: true, pitchingData: true }
          : game.sportKey === 'nba'
          ? { nbaEdgeData: true, nbaLineupData: true, nbaDefenseEdge: true, nbaDefenseTable: true }
          : {};
        const baseData = { gameInfo: game, awayForm, homeForm, injuries, awayRoster, homeRoster, h2h, _loading: initLoading };
        setGameData(baseData);
        setLoading(false);
        setStepIdx(4);

        // ── Phase 2 (heavy extras, runs in background) ────────────────────
        // _loading flags let tabs show animated skeletons instead of static
        // "unavailable" text while their slice of data is still in-flight.
        if (game.sportKey === 'mlb') {
          (async () => {
            try {
              const starterData = await fetchMlbStarters(game);
              const bvpData = await fetchGameBvp(game, starterData.lineups, starterData.pitchers);
              const mlbEdgeData = await buildMlbEdgeData(game, bvpData);
              if (cancelled) return;
              setGameData(prev => prev && { ...prev,
                mlbEdgeData,
                pitchingData: { pitchers: starterData.pitchers },
                _loading: { ...prev._loading, mlbEdgeData: false, pitchingData: false },
              });
            } catch (e) {
              console.error('MLB extras failed', e);
              if (!cancelled) setGameData(prev => prev && { ...prev, _loading: { ...prev._loading, mlbEdgeData: false, pitchingData: false } });
            }
          })();
        } else if (game.sportKey === 'nba') {
          // Three independent extras — fire them in parallel, but commit each
          // to gameData as it lands so individual tabs unlock independently.
          buildNbaEdgeData(game).then(nbaEdgeData => {
            if (!cancelled) setGameData(prev => prev && { ...prev, nbaEdgeData, _loading: { ...prev._loading, nbaEdgeData: false } });
          }).catch(() => {
            if (!cancelled) setGameData(prev => prev && { ...prev, _loading: { ...prev._loading, nbaEdgeData: false } });
          });
          buildNbaLineupData(game, awayRoster, homeRoster).then(nbaLineupData => {
            if (!cancelled) setGameData(prev => prev && { ...prev, nbaLineupData, _loading: { ...prev._loading, nbaLineupData: false } });
          }).catch(() => {
            if (!cancelled) setGameData(prev => prev && { ...prev, _loading: { ...prev._loading, nbaLineupData: false } });
          });
          fetchNbaPositionalDefenseEdge(game).then(nbaDefenseEdge => {
            if (!cancelled) setGameData(prev => prev && { ...prev, nbaDefenseEdge, _loading: { ...prev._loading, nbaDefenseEdge: false } });
          }).catch(() => {
            if (!cancelled) setGameData(prev => prev && { ...prev, _loading: { ...prev._loading, nbaDefenseEdge: false } });
          });
          fetchNbaDefenseVsPositionTable().then(nbaDefenseTable => {
            if (!cancelled) setGameData(prev => prev && { ...prev, nbaDefenseTable, _loading: { ...prev._loading, nbaDefenseTable: false } });
          }).catch(() => {
            if (!cancelled) setGameData(prev => prev && { ...prev, _loading: { ...prev._loading, nbaDefenseTable: false } });
          });
        }
        // Phase 2 step indicator hides when load() returns; any tab waiting
        // on extras still shows its own subtle "loading" message.
        setStepIdx(5);
      } catch (e) {
        console.error(e);
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [game.eventId]);

  // Phase 1 (blocking) → Phase 2 (background extras). The loader hides after
  // step 3 once core data is ready; extras unlock individual tabs as they land.
  const steps = ['LOADING GAME', 'TEAM STATS', 'FORM + PLAYERS', 'HEAD-TO-HEAD'];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px 40px' }}>
      <div style={{ padding: '20px 0 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <button onClick={onBack} style={backBtnStyle}>← GAMES</button>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
              <img src={game.awayLogo} alt={game.awayAbbr} style={{ width: 32, height: 32, objectFit: 'contain' }} onError={e => e.target.style.display='none'} />
              <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 'clamp(16px,2.5vw,26px)', fontWeight: 700, color: 'var(--text)', letterSpacing: '0.04em' }}>{game.awayAbbr}</span>
              <span style={{ fontFamily: 'Space Mono, monospace', fontSize: 14, color: 'var(--dim)' }}>@</span>
              <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 'clamp(16px,2.5vw,26px)', fontWeight: 700, color: 'var(--text)', letterSpacing: '0.04em' }}>{game.homeAbbr}</span>
              <img src={game.homeLogo} alt={game.homeAbbr} style={{ width: 32, height: 32, objectFit: 'contain' }} onError={e => e.target.style.display='none'} />
              <StatusBadge status={game.statusState==='in' ? 'In Progress' : game.statusState==='post' ? 'Final' : 'Scheduled'} />
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
          <div style={{ display: 'flex', gap: 0, overflowX: 'auto', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 0 }}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ padding: '14px 18px', background: 'transparent', border: 'none', borderBottom: `2px solid ${tab===t.id ? 'var(--cyan)' : 'transparent'}`,
                  color: tab===t.id ? 'var(--cyan)' : 'var(--muted)', fontFamily: 'Space Mono, monospace',
                  fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap', letterSpacing: '0.1em',
                  transition: 'all 0.2s', marginBottom: -1 }}>
                {t.label}
              </button>
            ))}
          </div>

          <div style={{ minHeight: 400 }}>
            {tab === 'overview' && <OverviewTab gameData={gameData} />}
            {tab === 'h2h' && <H2HTab gameData={gameData} />}
            {tab === 'form' && <FormTab gameData={gameData} />}
            {tab === 'roster' && <RosterTab gameData={gameData} />}
            {tab === 'lineups' && <NbaLineupTab gameData={gameData} />}
            {tab === 'def-vs-pos' && <NbaDefenseVsPositionTab gameData={gameData} />}
            {tab === 'edges' && (game.sportKey === 'nba' ? <NbaEdgeFinderTab gameData={gameData} /> : <EdgeFinderTab gameData={gameData} />)}
            {tab === 'pitching' && <PitchingEdgeTab gameData={gameData} />}
            {tab === 'ai' && <AIPlaysTab gameData={gameData} />}
          </div>
        </>
      )}
    </div>
  );
}

Object.assign(window, { GameDetailScreen });
