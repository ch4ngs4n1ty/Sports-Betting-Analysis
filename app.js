/* ═══════════════════════════════════════════════════════════
   PLAYIQ — app.js
   Deep Game Analysis Engine
═══════════════════════════════════════════════════════════

   TABLE OF CONTENTS
   ─────────────────
   1. STATE & CONFIG .............. line ~15
   2. INIT & DASHBOARD ........... line ~40
   3. ANALYSIS ENTRY POINT ....... line ~234
   4. ESPN FETCH LAYER (all sports) line ~320
      - espn() helper
      - getSeasonYear()        ← NFL/NCAAFB-specific season logic
      - fetchTeamForm()
      - enrichFormWithPlayerStats()
      - fetchTeamStats()
   5. NBA-SPECIFIC FETCHERS ...... line ~484
      - fetchPlayerPropData()  ← NBA stat labels (PTS/REB/AST/FGA/MIN)
      - fetchInjuries()
      - fetchH2H()
   6. PLAYER MODAL ............... line ~670
      - fetchPlayerLastGames()
      - openPlayerModal()
      - renderPlayerModalChart()
   7. NBA-ONLY: RESEARCH TAB ..... line ~864
      - fetchNBAStat()         ← NBA.com API (CORS-blocked, 1s timeout)
      - fetchPlayerResearchData() ← NBA season strings, NBA.com advanced stats
      - renderResearchTab()    ← hardcoded PTS/FGA/MIN references
   8. ROSTER FETCH ............... line ~1118
   9. RENDER FUNCTIONS ........... line ~1156
      - renderOverview()
      - renderRoster()
      - renderForm() + charts
      - renderH2H() + charts
      - renderProps() (Props Scout)
  10. AI PLAYS (Claude API) ...... line ~1861
      - buildGameContext()
      - generateAIPlays()
      - renderAIPlays()
      - discussUserPlay()
  11. UTILITIES .................. line ~2102
      - switchTab()
      - chartOpts()

   SPORT-SPECIFIC CODE INDEX
   ─────────────────────────
   Sport configs live in /sports/*.js (nba.js, mlb.js, nhl.js, ncaab.js).
   Those define statCategories and propsStats per sport via window.SportConfig.

   NBA-ONLY code in this file:
     • fetchPlayerPropData()     — hardcoded PTS/REB/AST/FGA/MIN
     • fetchNBAStat()            — NBA.com stats API
     • fetchPlayerResearchData() — NBA.com advanced stats, NBA season format
     • renderResearchTab()       — PTS/FGA/MIN splits, verdicts

   NFL/NCAAFB-ONLY code:
     • getSeasonYear()           — fall-start season logic (month < 8)

   Everything else is sport-agnostic, driven by SportConfig.

═══════════════════════════════════════════════════════════ */
/* global Chart */

/* ── 1. STATE ──────────────────────────────────────────── */
const S = {
  apiKey: localStorage.getItem('piq_key') || '',
  gameData: null,   // full fetched game context
  allGames: [],     // flat list of gameInfo objects from dashboard
  charts: {},       // chart instances
};

/* ── TEAM LOGO URL ──────────────────────────────────────── */
function teamLogoUrl(league, abbr, teamId) {
  const proLeagues = ['nba', 'nfl', 'mlb', 'nhl'];
  if (proLeagues.includes(league)) {
    return `https://a.espncdn.com/i/teamlogos/${league}/500-dark/${abbr.toLowerCase()}.png`;
  }
  return `https://a.espncdn.com/i/teamlogos/ncaa/500/${teamId}.png`;
}

/* ── ESPN SPORT MAP ─────��───────────────────────────────── */
const SPORTS = [
  { key: 'nba',    sport: 'basketball', league: 'nba',                     label: 'NBA' },
  { key: 'mlb',    sport: 'baseball',   league: 'mlb',                     label: 'MLB' },
  { key: 'nhl',    sport: 'hockey',     league: 'nhl',                     label: 'NHL' },
  { key: 'ncaamb', sport: 'basketball', league: 'mens-college-basketball',  label: 'NCAAB' },
];

/* ── SERVICE WORKER (PWA) ─────────���─────────────────────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

/* ── INIT ───────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  if (S.apiKey) document.getElementById('apiKey').value = S.apiKey;

  // Restore last game if the page reloaded mid-session
  const saved = sessionStorage.getItem('piq_game');
  if (saved) {
    try {
      const gameInfo = JSON.parse(saved);
      loadDashboard(); // load in background so dashboard is ready if user goes back
      startAnalysis(gameInfo);
      return;
    } catch { sessionStorage.removeItem('piq_game'); }
  }

  loadDashboard();
});

/* ── API KEY ────────────────────────────────────────────── */
function saveKey() {
  S.apiKey = document.getElementById('apiKey').value.trim();
  localStorage.setItem('piq_key', S.apiKey);
  const el = document.getElementById('keySaved');
  el.textContent = '✓ saved';
  setTimeout(() => el.textContent = '', 2000);
}

/* ── DASHBOARD ──────────────────────────────────────────── */
async function loadDashboard() {
  const dateEl = document.getElementById('dashboardDate');
  const nowET = new Date();
  dateEl.textContent = nowET.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' });

  const content = document.getElementById('dashboardContent');
  content.innerHTML = `<div class="dashboard-loading"><div class="loader-spinner"></div><span>Loading today's games...</span></div>`;

  S.allGames = [];

  const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replace(/-/g, '');

  const results = await Promise.all(
    SPORTS.map(sp =>
      espn(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/scoreboard?dates=${todayET}`)
        .then(data => ({ sp, events: data?.events || [] }))
    )
  );

  // Use the actual date from ESPN's events instead of local clock
  const firstEvent = results.flatMap(r => r.events)[0];
  if (firstEvent?.date) {
    const espnDate = new Date(firstEvent.date);
    dateEl.textContent = espnDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York' });
  }

  renderDashboard(results);
}

function renderDashboard(results) {
  const content = document.getElementById('dashboardContent');

  const sections = results
    .filter(r => r.events.length > 0)
    .map(({ sp, events }) => {
      const cards = events.map(ev => {
        const comp = ev.competitions?.[0];
        if (!comp) return null;
        const home = comp.competitors?.find(c => c.homeAway === 'home');
        const away = comp.competitors?.find(c => c.homeAway === 'away');
        if (!home || !away) return null;

        const odds = comp.odds?.[0];
        const idx = S.allGames.length;

        const gameInfo = {
          sportKey: sp.key,
          sportLabel: sp.label,
          sport: sp.sport,
          league: sp.league,
          eventId: ev.id,
          awayFull: away.team.displayName,
          awayAbbr: away.team.abbreviation,
          awayTeamId: away.team.id,
          awayScore: away.score,
          homeFull: home.team.displayName,
          homeAbbr: home.team.abbreviation,
          homeTeamId: home.team.id,
          homeScore: home.score,
          statusText: ev.status?.type?.description || 'Scheduled',
          statusState: ev.status?.type?.state,
          statusDetail: ev.status?.type?.shortDetail || '',
          date: ev.date,
          venue: comp.venue?.fullName,
          spread: odds?.details,
          overUnder: odds?.overUnder,
          awayMoneyline: odds?.awayTeamOdds?.moneyLine,
          homeMoneyline: odds?.homeTeamOdds?.moneyLine,
          awayLogo: teamLogoUrl(sp.league, away.team.abbreviation, away.team.id),
          homeLogo: teamLogoUrl(sp.league, home.team.abbreviation, home.team.id),
        };

        S.allGames.push(gameInfo);
        return renderGameCard(gameInfo, idx);
      }).filter(Boolean);

      if (!cards.length) return '';

      return `
        <div class="sport-section">
          <div class="sport-section-header">
            <span class="sport-section-label">${sp.label}</span>
            <span class="sport-game-count">${cards.length} game${cards.length !== 1 ? 's' : ''}</span>
          </div>
          <div class="games-grid">${cards.join('')}</div>
        </div>`;
    }).filter(Boolean);

  if (!sections.length) {
    content.innerHTML = `<div class="dashboard-empty">No games scheduled today across any sport.</div>`;
    return;
  }

  content.innerHTML = sections.join('');
}

function renderGameCard(g, idx) {
  const isLive  = g.statusState === 'in';
  const isFinal = g.statusState === 'post';

  const parseScore = (s) => {
    const v = parseInt(s?.displayValue ?? s ?? '');
    return isNaN(v) ? '' : v;
  };
  const awayScore = parseScore(g.awayScore);
  const homeScore = parseScore(g.homeScore);

  const statusBadge = isLive
    ? `<span class="card-status live">● LIVE</span><span class="card-clock">${g.statusDetail}</span>`
    : isFinal
    ? `<span class="card-status final">FINAL</span>`
    : `<span class="card-status pre">${new Date(g.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>`;

  const showScore = isLive || isFinal;
  const awayLeading = isLive && awayScore !== '' && homeScore !== '' && awayScore > homeScore;
  const homeLeading = isLive && awayScore !== '' && homeScore !== '' && homeScore > awayScore;

  const oddsBits = [];
  if (g.spread) oddsBits.push(g.spread);
  if (g.overUnder) oddsBits.push(`O/U ${g.overUnder}`);

  return `
    <div class="game-card" onclick="analyzeGame(${idx})">
      <div class="card-top">${statusBadge}</div>
      <div class="card-teams">
        <div class="card-team">
          ${g.awayLogo ? `<img class="card-logo" src="${g.awayLogo}" alt="${g.awayAbbr}" onerror="this.style.display='none'">` : ''}
          <span class="card-abbr ${awayLeading ? 'leading' : ''}">${g.awayAbbr}</span>
          <span class="card-name">${g.awayFull}</span>
        </div>
        ${showScore ? `<div class="card-scores">
          <span class="${awayLeading ? 'score-lead' : 'score-val'}">${awayScore}</span>
          <span class="score-dash">—</span>
          <span class="${homeLeading ? 'score-lead' : 'score-val'}">${homeScore}</span>
        </div>` : `<div class="card-vs">VS</div>`}
        <div class="card-team right">
          ${g.homeLogo ? `<img class="card-logo" src="${g.homeLogo}" alt="${g.homeAbbr}" onerror="this.style.display='none'">` : ''}
          <span class="card-abbr ${homeLeading ? 'leading' : ''}">${g.homeAbbr}</span>
          <span class="card-name">${g.homeFull}</span>
        </div>
      </div>
      ${oddsBits.length ? `<div class="card-odds">${oddsBits.map(o => `<span class="card-odds-pill">${o}</span>`).join('')}</div>` : ''}
      <div class="card-footer">
        <span class="card-venue">${g.venue || ''}</span>
        <span class="card-cta">ANALYZE →</span>
      </div>
    </div>`;
}

/* ── RESET ──────────────────────────────────────────────── */
function resetToDashboard() {
  sessionStorage.removeItem('piq_game');
  document.getElementById('dashboardSection').classList.remove('hidden');
  document.getElementById('analysisPanel').classList.add('hidden');
  Object.values(S.charts).forEach(c => { try { c.destroy(); } catch(e){} });
  S.charts = {};
}

/* ─────────────────────────────────────────────────────────
   MAIN ENTRY: analyzeGame
───────────────────────────────────────────────────────── */
function analyzeGame(idx) {
  const gameInfo = S.allGames[idx];
  if (!gameInfo) return;
  startAnalysis(gameInfo);
}

async function startAnalysis(gameInfo) {
  sessionStorage.setItem('piq_game', JSON.stringify(gameInfo));

  // Hide dashboard, show analysis panel
  document.getElementById('dashboardSection').classList.add('hidden');
  document.getElementById('analysisPanel').classList.remove('hidden');
  document.getElementById('tabBar').classList.add('hidden');
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));

  const loader = document.getElementById('fullLoader');
  loader.classList.remove('hidden');

  document.getElementById('userPlayResult').classList.add('hidden');
  document.getElementById('aiPlaysList').innerHTML = '';

  try {
    // Step 1 — Game header
    setStep(0);
    document.getElementById('gameSport').textContent = gameInfo.sportLabel;
    document.getElementById('gameTitle').innerHTML =
      `${gameInfo.awayLogo ? `<img class="header-logo" src="${gameInfo.awayLogo}" alt="${gameInfo.awayAbbr}" onerror="this.style.display='none'">` : ''}
      ${gameInfo.awayAbbr}
      <span style="color:var(--text3);font-size:0.6em;margin:0 8px">VS</span>
      ${gameInfo.homeAbbr}
      ${gameInfo.homeLogo ? `<img class="header-logo" src="${gameInfo.homeLogo}" alt="${gameInfo.homeAbbr}" onerror="this.style.display='none'">` : ''}`;
    document.getElementById('gameMeta').textContent =
      `${gameInfo.awayFull} vs ${gameInfo.homeFull} · ${gameInfo.venue || ''} · ${gameInfo.statusText}`;
    renderOddsStrip(gameInfo);

    // Step 2 — Injuries
    setStep(1);
    const injuries = await fetchInjuries(gameInfo);

    // Step 3 — Last 10 games + player stats
    setStep(2);
    const [awayFormRaw, homeFormRaw] = await Promise.all([
      fetchTeamForm(gameInfo.sportKey, gameInfo.awayTeamId),
      fetchTeamForm(gameInfo.sportKey, gameInfo.homeTeamId),
    ]);
    const [awayForm, homeForm] = await Promise.all([
      enrichFormWithPlayerStats(gameInfo.sportKey, gameInfo.awayTeamId, awayFormRaw),
      enrichFormWithPlayerStats(gameInfo.sportKey, gameInfo.homeTeamId, homeFormRaw),
    ]);

    // Step 4 — H2H
    setStep(3);
    const h2hResult = await fetchH2H(gameInfo);
    const h2h = h2hResult.games;
    const h2hSummaries = h2hResult.summaries;

    // Step 5 — Rosters
    setStep(4);
    const [awayRoster, homeRoster] = await Promise.all([
      fetchRoster(gameInfo.sportKey, gameInfo.awayTeamId),
      fetchRoster(gameInfo.sportKey, gameInfo.homeTeamId),
    ]);

    S.gameData = { gameInfo, injuries, awayForm, homeForm, h2h, h2hSummaries, awayRoster, homeRoster };

    renderOverview(S.gameData);
    renderRoster(S.gameData);
    renderForm(S.gameData);
    renderH2H(S.gameData);
    renderProps(S.gameData);

    // NBA-only: fetch and render starting lineups with H2H stats
    const lineupsTab = document.getElementById('tabLineups');
    if (gameInfo.sportKey === 'nba') {
      lineupsTab.style.display = '';
      let [awayLineup, homeLineup] = await Promise.all([
        fetchLineups(gameInfo.sportKey, gameInfo.awayTeamId),
        fetchLineups(gameInfo.sportKey, gameInfo.homeTeamId),
      ]);
      // Enrich with per-player H2H stats — only games where BOTH players in a matchup played
      if (h2hSummaries?.length) {
        const enriched = enrichLineupsWithH2HStats(awayLineup, homeLineup, h2hSummaries);
        awayLineup = enriched.away;
        homeLineup = enriched.home;
      }
      // Fallback to season stats if no H2H data exists
      const hasH2HStats = awayLineup.some(p => p.stats) || homeLineup.some(p => p.stats);
      if (!hasH2HStats) {
        [awayLineup, homeLineup] = await Promise.all([
          enrichLineupsWithStats(awayLineup),
          enrichLineupsWithStats(homeLineup),
        ]);
        S.gameData.lineupStatsType = 'season';
      } else {
        S.gameData.lineupStatsType = 'h2h';
      }
      S.gameData.awayLineup = awayLineup;
      S.gameData.homeLineup = homeLineup;
      renderLineups(S.gameData);
    } else {
      lineupsTab.style.display = 'none';
    }

    setStep(5);
    loader.classList.add('hidden');
    document.getElementById('tabBar').classList.remove('hidden');
    switchTab('overview');

    generateAIPlays(S.gameData);

  } catch (err) {
    loader.classList.add('hidden');
    resetToDashboard();
    document.getElementById('errorMessage').textContent = err.message;
    document.getElementById('errorHint').textContent = 'An unexpected error occurred. Please try again.';
    document.getElementById('errorBanner').classList.remove('hidden');
  }
}

function setStep(idx) {
  document.querySelectorAll('.step').forEach((el, i) => {
    el.classList.remove('active', 'done');
    if (i < idx) el.classList.add('done');
    if (i === idx) el.classList.add('active');
  });
}

/* ═══════════════════════════════════════════════════════════
   4. ESPN FETCH LAYER (ALL SPORTS)
   All functions here are sport-agnostic unless noted.
═══════════════════════════════════════════════════════════ */
async function espn(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/* ── ODDS STRIP ─────────────────────────────────────────── */
function renderOddsStrip(g) {
  const el = document.getElementById('gameOddsStrip');
  const pills = [];
  if (g.spread) pills.push({ label: 'Spread', val: g.spread });
  if (g.overUnder) pills.push({ label: 'Over/Under', val: g.overUnder });
  if (g.awayMoneyline) pills.push({ label: `${g.awayAbbr} ML`, val: g.awayMoneyline > 0 ? `+${g.awayMoneyline}` : g.awayMoneyline });
  if (g.homeMoneyline) pills.push({ label: `${g.homeAbbr} ML`, val: g.homeMoneyline > 0 ? `+${g.homeMoneyline}` : g.homeMoneyline });
  if (g.date) pills.push({ label: 'Tip-off', val: new Date(g.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) });

  el.innerHTML = pills.map(p => `
    <div class="odds-pill">
      <span class="op-label">${p.label}</span>
      <span class="op-val">${p.val}</span>
    </div>`).join('');
}

/* ── SEASON YEAR HELPER ─────────────────────────────────── */
/* SPORT-SPECIFIC: NFL/NCAAFB use fall-start season logic   */
function getSeasonYear(sportKey) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  // ▸ NFL / NCAAFB: season starts in fall, so before August → last year
  if (sportKey === 'nfl' || sportKey === 'ncaafb') {
    return month < 8 ? year - 1 : year;
  }
  // ▸ NBA / NHL / NCAAB / MLB: current calendar year
  return year;
}

/* ── TEAM FORM (last 5) ─────────────────────────────────── */
async function fetchTeamForm(sportKey, teamId) {
  const sp = SPORTS.find(s => s.key === sportKey);
  if (!sp) return [];
  const season = getSeasonYear(sportKey);
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/teams/${teamId}/schedule?season=${season}`;
  const data = await espn(url);
  if (!data?.events) return [];

  const completed = data.events.filter(e => e.competitions?.[0]?.status?.type?.completed);
  const last10 = completed.slice(-10);

  return last10.map(ev => {
    const comp = ev.competitions[0];
    const isHome = comp.competitors?.find(c => c.homeAway === 'home')?.team?.id === teamId;
    const mine = comp.competitors?.find(c => c.team?.id === teamId);
    const opp  = comp.competitors?.find(c => c.team?.id !== teamId);
    const parseScore = (s) => parseInt(s?.displayValue ?? s ?? 0) || 0;
    const myScore = parseScore(mine?.score);
    const oppScore = parseScore(opp?.score);
    const result = mine?.winner === true ? 'W' : mine?.winner === false ? 'L' : myScore > oppScore ? 'W' : myScore < oppScore ? 'L' : 'T';
    return {
      eventId: ev.id,
      result,
      opponent: opp?.team?.abbreviation || '?',
      myScore,
      oppScore,
      home: isHome,
      date: new Date(ev.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    };
  });
}

/* ── PLAYER STATS PER GAME ──────────────────────────────── */
async function enrichFormWithPlayerStats(sportKey, teamId, formGames) {
  const sp = SPORTS.find(s => s.key === sportKey);
  if (!sp) return formGames;

  const summaries = await Promise.all(
    formGames.map(g => g.eventId
      ? espn(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/summary?event=${g.eventId}`)
      : Promise.resolve(null)
    )
  );

  return formGames.map((g, i) => {
    const summary = summaries[i];
    if (!summary) return { ...g, player: null };

    const teamPlayers = summary.boxscore?.players?.find(p => String(p.team?.id) === String(teamId));
    if (!teamPlayers) return { ...g, player: null };

    const statsGroup = teamPlayers.statistics?.[0];
    if (!statsGroup) return { ...g, player: null };

    const labels = statsGroup.labels || [];
    const cats = window.SportConfig?.[sportKey]?.statCategories || [];
    const indices = cats.map(c => labels.indexOf(c.espnBoxLabel));
    if (!cats.length || indices[0] === -1) return { ...g, player: null };

    const athletes = statsGroup.athletes || [];
    const findLeader = (idx) => {
      if (idx === -1) return null;
      let best = null, max = -1;
      for (const athlete of athletes) {
        const val = parseInt(athlete.stats?.[idx] || 0);
        if (val > max) {
          max = val;
          const a = athlete.athlete || {};
          const headshotFallback = a.id
            ? `https://a.espncdn.com/i/headshots/${sp.league}/players/full/${a.id}.png`
            : null;
          best = {
            name: a.shortName || a.displayName || '?',
            value: val,
            headshot: a.headshot?.href || headshotFallback,
          };
        }
      }
      return best;
    };

    const player = {};
    cats.forEach((c, i) => { player[c.key] = findLeader(indices[i]); });
    return { ...g, player };
  });
}

/* ── TEAM RANKED STATS (ESPN Core API) ─────────────────── */
async function fetchTeamStats(sportKey, teamId) {
  const sp = SPORTS.find(s => s.key === sportKey);
  if (!sp) return null;

  // Try site API first (CORS-safe), fall back to core API
  const siteData = await espn(
    `https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/teams/${teamId}/statistics`
  );
  if (siteData?.results?.stats?.categories) {
    const result = {};
    for (const cat of siteData.results.stats.categories) {
      for (const stat of cat.stats || []) {
        result[stat.name] = { value: stat.value, rank: stat.rank ?? null };
      }
    }
    return Object.keys(result).length ? result : null;
  }

  // Fallback: core API for ranked stats
  const season = getSeasonYear(sportKey);
  const data = await espn(
    `https://sports.core.api.espn.com/v2/sports/${sp.sport}/leagues/${sp.league}/seasons/${season}/types/2/teams/${teamId}/statistics`
  );
  if (!data?.splits?.categories) return null;

  const result = {};
  for (const cat of data.splits.categories) {
    for (const stat of cat.stats || []) {
      result[stat.name] = { value: stat.value, rank: stat.rank ?? null };
    }
  }
  return Object.keys(result).length ? result : null;
}

/* ═══════════════════════════════════════════════════════════
   5. NBA-SPECIFIC FETCHERS
   These functions use hardcoded NBA stat labels (PTS, REB,
   AST, FGA, MIN). To support other sports, refactor to use
   SportConfig stat categories instead.
═══════════════════════════════════════════════════════════ */
/* ── PLAYER PROP DATA (NBA: MIN, PTS, FGA, REB, AST) ──── */
async function fetchPlayerPropData(sportKey, teamId, athleteId) {
  const sp = SPORTS.find(s => s.key === sportKey);
  if (!sp) return [];
  const season = getSeasonYear(sportKey);
  const schedData = await espn(
    `https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/teams/${teamId}/schedule?season=${season}`
  );
  if (!schedData?.events) return [];

  const completed = schedData.events
    .filter(e => e.competitions?.[0]?.status?.type?.completed)
    .slice(-10);

  const summaries = await Promise.all(
    completed.map(e =>
      espn(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/summary?event=${e.id}`)
    )
  );

  return completed.map((ev, i) => {
    const comp = ev.competitions[0];
    const teamC = comp.competitors.find(c => c.team?.id === teamId);
    const oppC  = comp.competitors.find(c => c.team?.id !== teamId);
    const parseScore = s => parseInt(s?.displayValue ?? s ?? 0) || 0;
    const myScore  = parseScore(teamC?.score);
    const oppScore = parseScore(oppC?.score);
    const result   = teamC?.winner ? 'W' : oppC?.winner ? 'L' : myScore > oppScore ? 'W' : 'L';
    const isHome   = teamC?.homeAway === 'home';
    const opponent = oppC?.team?.abbreviation || '?';
    const date     = new Date(ev.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    let pts = null, reb = null, ast = null, min = null, fga = null, didNotPlay = false, dnpReason = '';

    const summary = summaries[i];
    if (summary?.boxscore?.players) {
      outer: for (const teamData of summary.boxscore.players) {
        for (const grp of teamData.statistics || []) {
          const labels = grp.labels || [];
          const ath = grp.athletes?.find(a => a.athlete?.id === athleteId);
          if (!ath) continue;
          if (ath.didNotPlay || !ath.stats?.length || ath.stats?.[0] === 'DNP') {
            didNotPlay = true;
            dnpReason  = ath.reason || 'DNP';
          } else {
            const idx = (name) => labels.indexOf(name);
            const val = (name) => { const i = idx(name); return i > -1 ? parseInt(ath.stats[i]) || 0 : 0; };
            pts = val('PTS'); reb = val('REB'); ast = val('AST');
            fga = val('FGA') || (() => { const fg = ath.stats[idx('FG')] || ''; return parseInt(fg.split('-')[1]) || 0; })();
            min = ath.stats[idx('MIN')] || '0';
          }
          break outer;
        }
      }
    }

    return { date, opponent, isHome, result, myScore, oppScore, pts, reb, ast, min, fga, didNotPlay, dnpReason };
  });
}

/* ── INJURIES ───────────────────────────────────────────── */
async function fetchInjuries(gameInfo) {
  const sp = SPORTS.find(s => s.key === gameInfo.sportKey);
  if (!sp) return { away: [], home: [] };

  const data = await espn(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/injuries`);
  if (!data?.injuries) return { away: [], home: [] };

  // ESPN structure: data.injuries = [ { id: teamId, displayName: "Team Name", injuries: [...] } ]
  const filter = (teamId) => {
    const teamInj = data.injuries.find(t => String(t.id) === String(teamId));
    return (teamInj?.injuries || []).map(i => {
      // Extract athlete ID from links URL if not directly available
      const athleteId = i.athlete?.id
        || i.athlete?.links?.[0]?.href?.match(/\/id\/(\d+)\//)?.[1]
        || null;

      // shortComment has the specific injury note, longComment has context/return info
      const shortComment = i.shortComment || '';
      const longComment = i.longComment || '';

      // Extract injury type from shortComment (e.g. "Okongwu (finger) won't play...")
      const injuryMatch = shortComment.match(/\(([^)]+)\)/);
      const injuryType = injuryMatch ? injuryMatch[1] : '';

      // Build estimated return string from longComment
      const estReturn = longComment || '';

      // Format injury report date
      const rawDate = i.date || '';
      const reportDate = rawDate ? new Date(rawDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

      return {
        name: i.athlete?.displayName || '—',
        status: i.status || 'Unknown',
        desc: injuryType || shortComment.slice(0, 80) || '—',
        pos: i.athlete?.position?.abbreviation || '',
        shortComment,
        estReturn,
        reportDate,
        athleteId,
        headshotUrl: athleteId
          ? `https://a.espncdn.com/i/headshots/${sp.league}/players/full/${athleteId}.png`
          : null,
      };
    });
  };

  return {
    away: filter(gameInfo.awayTeamId),
    home: filter(gameInfo.homeTeamId),
  };
}

/* ── H2H ────────────────────────────────────────────────── */
async function fetchH2H(gameInfo) {
  const sp = SPORTS.find(s => s.key === gameInfo.sportKey);
  if (!sp) return [];

  // Fetch last 3 seasons to get a richer matchup history
  const baseSeason = getSeasonYear(gameInfo.sportKey);
  const seasons = [baseSeason, baseSeason - 1, baseSeason - 2];

  const allEvents = (await Promise.all(
    seasons.map(season =>
      espn(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/teams/${gameInfo.awayTeamId}/schedule?season=${season}`)
        .then(d => d?.events || [])
    )
  )).flat();

  const h2h = allEvents
    .filter(ev => {
      const comp = ev.competitions?.[0];
      if (!comp?.status?.type?.completed) return false;
      return comp.competitors?.some(c => c.team?.id === gameInfo.homeTeamId);
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);

  // Fetch game summaries in parallel for top performers
  const summaries = await Promise.all(
    h2h.map(ev =>
      espn(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/summary?event=${ev.id}`)
    )
  );

  const games = h2h.map((ev, i) => {
    const comp = ev.competitions[0];
    const awayC = comp.competitors.find(c => c.homeAway === 'away');
    const homeC = comp.competitors.find(c => c.homeAway === 'home');
    const parseScore = (s) => parseInt(s?.displayValue ?? s ?? 0) || 0;
    const awayScore = parseScore(awayC?.score);
    const homeScore = parseScore(homeC?.score);
    // Extract per-category leaders by team abbreviation (not by historical home/away position)
    const leaders = summaries[i]?.leaders || [];
    const getTeamLeaders = (teamAbbr) => {
      const teamLeaders = leaders.find(l => l.team?.abbreviation === teamAbbr);
      if (!teamLeaders) return null;
      const getCatLeader = (catName) => {
        const cat = teamLeaders.leaders?.find(c => c.name === catName);
        const top = cat?.leaders?.[0];
        return top
          ? { name: top.athlete?.shortName || top.athlete?.displayName || '?', value: parseInt(top.displayValue) || 0, athleteId: top.athlete?.id, headshot: top.athlete?.headshot?.href }
          : null;
      };
      const cats = window.SportConfig?.[gameInfo.sportKey]?.statCategories || [];
      const result = {};
      cats.forEach(c => { result[c.key] = getCatLeader(c.espnLeaderCat); });
      return result;
    };

    // Always look up by the current game's away/home abbreviation — fixes historical home/away flip
    const winnerAbbr = awayC?.winner === true ? awayC?.team?.abbreviation
      : homeC?.winner === true ? homeC?.team?.abbreviation
      : awayScore > homeScore ? awayC?.team?.abbreviation : homeC?.team?.abbreviation;

    return {
      eventId: ev.id,
      date: new Date(ev.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      awayTeam: awayC?.team?.abbreviation || '?',
      homeTeam: homeC?.team?.abbreviation || '?',
      awayScore, homeScore,
      winner: awayC?.winner === true ? 'away' : homeC?.winner === true ? 'home' : awayScore > homeScore ? 'away' : 'home',
      winnerAbbr,
      awayLeader: getTeamLeaders(gameInfo.awayAbbr),
      homeLeader: getTeamLeaders(gameInfo.homeAbbr),
    };
  });

  // Return both structured games and raw summaries (for boxscore extraction in lineups)
  return { games, summaries };
}

/* ═══════════════════════════════════════════════════════════
   6. PLAYER MODAL (ALL SPORTS)
   Modal that opens when you click a player name.
   Uses SportConfig for stat categories (sport-agnostic).
═══════════════════════════════════════════════════════════ */
async function fetchPlayerLastGames(sportKey, teamId, athleteId) {
  const sp = SPORTS.find(s => s.key === sportKey);
  if (!sp) return [];
  const season = getSeasonYear(sportKey);
  const schedData = await espn(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/teams/${teamId}/schedule?season=${season}`);
  if (!schedData?.events) return [];

  const completed = schedData.events
    .filter(e => e.competitions?.[0]?.status?.type?.completed)
    .slice(-5);

  const summaries = await Promise.all(
    completed.map(e => espn(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/summary?event=${e.id}`))
  );

  return completed.map((ev, i) => {
    const comp = ev.competitions[0];
    const teamC = comp.competitors.find(c => c.team?.id === teamId);
    const oppC  = comp.competitors.find(c => c.team?.id !== teamId);
    const parseScore = s => parseInt(s?.displayValue ?? s ?? 0) || 0;
    const myScore  = parseScore(teamC?.score);
    const oppScore = parseScore(oppC?.score);
    const result   = teamC?.winner ? 'W' : oppC?.winner ? 'L' : myScore > oppScore ? 'W' : 'L';

    const cats = window.SportConfig?.[sportKey]?.statCategories || [];
    const statVals = {};
    cats.forEach(c => { statVals[c.key] = 0; });
    let min = null, fga = 0;
    let didNotPlay = false, dnpReason = '';

    const summary = summaries[i];
    if (summary?.boxscore?.players) {
      let playerFound = false;
      outer: for (const td of summary.boxscore.players) {
        for (const grp of td.statistics || []) {
          const lbls = grp.labels || [];
          const ath = grp.athletes?.find(a => a.athlete?.id === athleteId);
          if (ath) {
            playerFound = true;
            const isDnp = ath.didNotPlay || !ath.stats?.length || ath.stats?.[0] === 'DNP' || ath.stats?.[0] === '0:00';
            if (isDnp) {
              didNotPlay = true;
              dnpReason = ath.reason || 'DNP';
            } else {
              cats.forEach(c => {
                const idx = lbls.indexOf(c.espnBoxLabel);
                statVals[c.key] = idx > -1 ? (parseInt(ath.stats?.[idx] || 0) || 0) : 0;
              });
              const minIdx = lbls.indexOf('MIN'), fgaIdx = lbls.indexOf('FGA');
              min = minIdx > -1 ? (parseFloat(ath.stats?.[minIdx]) || null) : null;
              fga = fgaIdx > -1 ? (parseInt(ath.stats?.[fgaIdx]) || 0) : 0;
            }
            break outer;
          }
        }
      }
      if (!playerFound) { didNotPlay = true; dnpReason = 'INACTIVE'; }
    }

    const dateObj = new Date(ev.date);
    return {
      opponent: oppC?.team?.abbreviation || '?',
      oppTeamId: oppC?.team?.id,
      isHome: teamC?.homeAway === 'home',
      result, myScore, oppScore, min, fga, ...statVals, didNotPlay, dnpReason,
      date: dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      dateObj,
    };
  });
}

async function openPlayerModal(el) {
  const athleteId = el.dataset.athleteId;
  const teamId    = el.dataset.teamId;
  const name      = el.dataset.name;

  S.playerModal = { athleteId, teamId, name, games: null, research: null, researchPromise: null };
  // Reset to Stats tab
  document.getElementById('pmTabStats').classList.add('active');
  document.getElementById('pmTabResearch').classList.remove('active');
  document.getElementById('playerModalStatsView').classList.remove('hidden');
  document.getElementById('playerModalResearchView').classList.add('hidden');
  document.getElementById('playerModalResearchContent').innerHTML = '';
  document.getElementById('playerModalName').textContent = name;
  const hsEl = document.getElementById('playerModalHeadshot');
  hsEl.src = el.dataset.headshot || '';
  hsEl.style.display = el.dataset.headshot ? 'block' : 'none';
  document.getElementById('playerModalLoading').classList.remove('hidden');
  document.getElementById('playerModalChart').classList.add('hidden');
  document.getElementById('playerModal').classList.remove('hidden');
  const modalCats = window.SportConfig?.[S.gameData.gameInfo.sportKey]?.statCategories || [];
  document.getElementById('playerModalStatBtns').innerHTML = modalCats.map((c, i) =>
    `<button class="stat-btn${i === 0 ? ' active' : ''}" onclick="switchPlayerModalStat('${c.key}', this)">${c.label}</button>`
  ).join('');

  const { sportKey } = S.gameData.gameInfo;

  const games = await fetchPlayerLastGames(sportKey, teamId, athleteId);
  S.playerModal.games = games;
  document.getElementById('playerModalLoading').classList.add('hidden');
  document.getElementById('playerModalChart').classList.remove('hidden');
  const defaultModalStat = window.SportConfig?.[sportKey]?.statCategories?.[0]?.key || 'pts';
  renderPlayerModalChart(defaultModalStat);

  // Prefetch research in background — reuses already-fetched games, only NBA.com call remaining
  S.playerModal.researchPromise = fetchPlayerResearchData(sportKey, teamId, games)
    .then(d => { S.playerModal.research = d; return d; })
    .catch(() => null);
}

function renderPlayerModalChart(stat) {
  const { games } = S.playerModal;
  if (!games?.length) return;
  const ctx = document.getElementById('playerModalChart');
  if (S.charts.playerModal) S.charts.playerModal.destroy();

  const labels = games.map(g => {
    const label = `${g.isHome ? 'vs' : '@'}${g.opponent}`;
    return g.didNotPlay ? `${label}\nDNP` : label;
  });
  const values = games.map(g => g.didNotPlay ? 0 : (g[stat] || 0));
  const colors = games.map(g =>
    g.didNotPlay ? 'rgba(120,120,160,0.28)' :
    g.result === 'W' ? 'rgba(35,209,139,0.82)' : 'rgba(255,61,90,0.82)'
  );
  const playedValues = games.filter(g => !g.didNotPlay).map(g => g[stat] || 0);
  const avg = playedValues.length ? playedValues.reduce((s, v) => s + v, 0) / playedValues.length : 0;

  S.charts.playerModal = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { data: values, backgroundColor: colors, borderRadius: 5, borderSkipped: false, minBarLength: 6 },
        { type: 'line', data: new Array(values.length).fill(parseFloat(avg.toFixed(1))),
          borderColor: 'rgba(255,255,255,0.22)', borderWidth: 1.5, borderDash: [5,4],
          pointRadius: 0, fill: false, tension: 0 },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => { const g = games[items[0].dataIndex]; return `${g.isHome?'vs':'@'}${g.opponent}  ${g.date}`; },
            label: item => { const g = games[item.dataIndex]; return g.didNotPlay ? `DNP — ${g.dnpReason}` : `${item.raw} ${stat.toUpperCase()}  (${g.result}  ${g.myScore}-${g.oppScore})`; },
          },
          backgroundColor: 'rgba(13,13,18,0.95)', borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1, titleColor: '#f0f0fa', bodyColor: '#b8bce8', padding: 10,
        },
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#b8bce8', font: { family: "'IBM Plex Mono'", size: 11 } } },
        y: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#b8bce8', font: { family: "'IBM Plex Mono'", size: 11 } }, beginAtZero: true },
      },
    },
  });
}

function switchPlayerModalStat(stat, btn) {
  document.querySelectorAll('#playerModal .stat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderPlayerModalChart(stat);
}

async function switchPlayerModalTab(tab, btn) {
  document.querySelectorAll('.pm-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('playerModalStatsView').classList.toggle('hidden', tab !== 'stats');
  document.getElementById('playerModalResearchView').classList.toggle('hidden', tab !== 'research');
  if (tab !== 'research') return;

  if (S.playerModal.research) {
    // Already done — instant
    renderResearchTab(S.playerModal.research, S.gameData.gameInfo, S.gameData.injuries);
  } else if (S.playerModal.researchPromise) {
    // Background fetch already running — await it, no duplicate request
    const el = document.getElementById('playerModalResearchContent');
    el.innerHTML = `<div class="inline-loader" style="padding:24px 0"><div class="mini-spin"></div> Almost ready…</div>`;
    const data = await S.playerModal.researchPromise;
    renderResearchTab(data, S.gameData.gameInfo, S.gameData.injuries);
  } else {
    loadPlayerResearch();
  }
}

function closePlayerModal(e) {
  if (e && e.target !== document.getElementById('playerModal')) return;
  document.getElementById('playerModal').classList.add('hidden');
  if (S.charts.playerModal) { S.charts.playerModal.destroy(); delete S.charts.playerModal; }
}

/* ═══════════════════════════════════════════════════════════
   7. NBA-ONLY: PLAYER RESEARCH TAB
   Everything below until "ROSTER" is NBA-specific:
   - fetchNBAStat() calls NBA.com API (CORS-blocked in browser)
   - fetchPlayerResearchData() uses NBA season format "2025-26"
   - renderResearchTab() hardcodes PTS, FGA, MIN splits & verdict
   To add research for other sports, create sport-specific
   versions of these functions.
═══════════════════════════════════════════════════════════ */
async function fetchNBAStat(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'x-nba-stats-origin': 'stats',
        'x-nba-stats-token': 'true',
        'Referer': 'https://www.nba.com/',
        'Origin': 'https://www.nba.com',
      },
    });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json();
  } catch { clearTimeout(t); return null; }
}

async function fetchPlayerResearchData(sportKey, teamId, games) {
  // games already fetched by fetchPlayerLastGames — no ESPN re-fetch needed
  const nbaSeasonStr = (() => {
    const yr = getSeasonYear(sportKey);
    return `${yr - 1}-${String(yr).slice(2)}`;
  })();

  // B2B check
  const yestET  = new Date(Date.now() - 864e5).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const lastGame = (games || []).filter(g => !g.didNotPlay).at(-1);
  const isB2B    = !!(lastGame?.dateObj?.toLocaleDateString('en-CA') === yestET);

  // NBA.com advanced stats (CORS-blocked → 1s timeout, then null)
  const nbaTeamAdv = await fetchNBAStat(
    `https://stats.nba.com/stats/leaguedashteamstats?MeasureType=Advanced&PerMode=PerGame&Season=${nbaSeasonStr}&SeasonType=Regular+Season&LeagueID=00`
  );

  const oppTeamId = lastGame?.oppTeamId || (S.gameData.gameInfo.awayTeamId === teamId
    ? S.gameData.gameInfo.homeTeamId : S.gameData.gameInfo.awayTeamId);
  let oppPace = null, oppDefRtg = null;
  if (nbaTeamAdv?.resultSets?.[0]) {
    const rs      = nbaTeamAdv.resultSets[0];
    const headers = rs.headers;
    const paceIdx = headers.indexOf('PACE');
    const defIdx  = headers.indexOf('DEF_RATING');
    const teamRow = rs.rowSet?.find(r => String(r[1]) === String(oppTeamId));
    if (teamRow) {
      oppPace   = paceIdx > -1 ? teamRow[paceIdx] : null;
      oppDefRtg = defIdx  > -1 ? teamRow[defIdx]  : null;
    }
  }

  return { games, isB2B, oppPace, oppDefRtg };
}

async function loadPlayerResearch() {
  const el = document.getElementById('playerModalResearchContent');
  el.innerHTML = `<div class="inline-loader" style="padding:24px 0"><div class="mini-spin"></div> Fetching research data…</div>`;

  try {
    const { athleteId, teamId } = S.playerModal;
    const { gameInfo, injuries } = S.gameData;
    const data = await fetchPlayerResearchData(gameInfo.sportKey, teamId, athleteId);
    S.playerModal.research = data;
    renderResearchTab(data, gameInfo, injuries);
  } catch (e) {
    document.getElementById('playerModalResearchContent').innerHTML =
      `<div style="color:var(--red);padding:20px;font-size:12px;font-family:var(--font-m)">Research error: ${e.message}</div>`;
  }
}

function renderResearchTab(data, gameInfo, injuries) {
  const el = document.getElementById('playerModalResearchContent');
  if (!data) { el.innerHTML = `<div class="rt-unavail">Could not load data.</div>`; return; }

  const { games, isB2B, oppPace, oppDefRtg } = data;
  const played = games.filter(g => !g.didNotPlay);
  const l5 = played.slice(-5), l10 = played.slice(-10);

  const avg = (arr, key) => arr.length ? +(arr.reduce((s, g) => s + (g[key] || 0), 0) / arr.length).toFixed(1) : null;
  const fmt = v => v != null ? v : '<span class="rt-na">N/A</span>';
  const fmtMin = v => v != null ? Math.round(v) + ' min' : '<span class="rt-na">N/A</span>';

  // 1 — MINUTES
  const l5min  = avg(l5,  'min');
  const l10min = avg(l10, 'min');
  const trend  = l5min != null && l10min != null
    ? (l5min > l10min + 1 ? '↑ Up'  : l5min < l10min - 1 ? '↓ Down' : '→ Stable')
    : null;
  const trendColor = trend?.includes('↑') ? 'var(--green)' : trend?.includes('↓') ? 'var(--red)' : 'var(--text2)';
  const homeMin = avg(l10.filter(g => g.isHome),  'min');
  const awayMin = avg(l10.filter(g => !g.isHome), 'min');

  // 2 — INJURY CONTEXT
  const isAway = gameInfo.awayTeamId === S.playerModal.teamId;
  const myTeamInj  = (isAway ? injuries?.away : injuries?.home) || [];
  const oppTeamInj = (isAway ? injuries?.home : injuries?.away) || [];
  const outPlayers = (list) => list.filter(i => /out|doubtful/i.test(i.status));
  const myOut  = outPlayers(myTeamInj);
  const oppOut = outPlayers(oppTeamInj);

  // 3 — OPPONENT DEFENSE
  const oppAbbr = isAway ? gameInfo.homeAbbr : gameInfo.awayAbbr;

  // 4 — SCORE MARGIN SPLITS
  const closeGames  = played.filter(g => Math.abs(g.myScore - g.oppScore) <= 9);
  const blowouts    = played.filter(g => Math.abs(g.myScore - g.oppScore) >= 10);
  const avgArr      = (arr, key) => arr.length ? +(arr.reduce((s, g) => s + (g[key] || 0), 0) / arr.length).toFixed(1) : null;
  const closeAvgMin = avgArr(closeGames, 'min');
  const closeAvgPts = avgArr(closeGames, 'pts');
  const blowAvgMin  = avgArr(blowouts, 'min');
  const blowAvgPts  = avgArr(blowouts, 'pts');
  const closeHits   = l10pts != null ? closeGames.filter(g => g.pts > l10pts).length : null;
  const blowHits    = l10pts != null ? blowouts.filter(g => g.pts > l10pts).length : null;

  let tonightScenario = null;
  if (gameInfo.spread) {
    const spreadNum = parseFloat(gameInfo.spread.replace(/[^\d.-]/g, ''));
    if (!isNaN(spreadNum)) tonightScenario = Math.abs(spreadNum) <= 6 ? 'close' : 'blowout';
  }

  let marginNote = '';
  if (closeAvgMin != null && blowAvgMin != null && Math.abs(closeAvgMin - blowAvgMin) >= 3) {
    const diff = closeAvgMin - blowAvgMin;
    marginNote = diff > 0
      ? `Plays ~${Math.abs(diff).toFixed(0)} more min in close games${tonightScenario === 'close' ? ' — tonight looks close (favorable)' : tonightScenario === 'blowout' ? ' — tonight may be a blowout (role risk)' : ''}.`
      : `Plays ~${Math.abs(diff).toFixed(0)} more min in blowouts${tonightScenario === 'blowout' ? ' — tonight looks like a blowout (favorable)' : tonightScenario === 'close' ? ' — tonight may be close (role risk)' : ''}.`;
  }

  const marginRow = (label, games, avgM, avgP, hits, highlight) => {
    if (!games.length) return `<div class="rt-row"><span class="rt-key">${label}</span><span class="rt-val rt-na">no data</span></div>`;
    const hStr = hits != null ? ` · ${hits}/${games.length} over avg` : '';
    return `<div class="rt-row${highlight ? ' rt-row-hl' : ''}">
      <span class="rt-key">${label} <span class="rt-sample">(${games.length}g)</span></span>
      <span class="rt-val">${avgM != null ? Math.round(avgM) + 'min' : 'N/A'} · ${avgP != null ? avgP + 'pts' : 'N/A'}${hStr}</span>
    </div>`;
  };

  // 6 — PACE & GAME TOTAL
  const ou = gameInfo.overUnder;

  // 5 — HIT RATE (vs own L10 avg)
  const l10pts = avg(l10, 'pts');
  const l5pts  = avg(l5,  'pts');
  const hitsOverL10avg = l5.filter(g => g.pts > (l10pts || 0)).length;
  const l10fgaMin = l10.length ? Math.min(...l10.map(g => g.fga)) : null;
  const l10fgaMax = l10.length ? Math.max(...l10.map(g => g.fga)) : null;
  const l10fgaAvg = avg(l10, 'fga');

  // 6 — VERDICT
  let overSignals = 0, underSignals = 0;
  if (trend?.includes('↑')) overSignals++;
  if (trend?.includes('↓')) underSignals++;
  if (l5pts != null && l10pts != null && l5pts > l10pts + 2) overSignals++;
  if (l5pts != null && l10pts != null && l5pts < l10pts - 2) underSignals++;
  if (isB2B) underSignals++;
  if (oppOut.length >= 2) overSignals++;
  if (myOut.length >= 1) underSignals++;

  const verdictLabel = overSignals > underSignals ? 'LEAN OVER'
    : underSignals > overSignals ? 'LEAN UNDER' : 'MIXED';
  const verdictColor = verdictLabel === 'LEAN OVER' ? 'var(--green)'
    : verdictLabel === 'LEAN UNDER' ? 'var(--red)' : 'var(--yellow)';

  const verdictReasons = [];
  if (trend?.includes('↑')) verdictReasons.push('minutes trending up');
  if (trend?.includes('↓')) verdictReasons.push('minutes trending down');
  if (l5pts != null && l10pts != null && l5pts > l10pts + 2) verdictReasons.push('scoring above season avg L5');
  if (l5pts != null && l10pts != null && l5pts < l10pts - 2) verdictReasons.push('scoring below season avg L5');
  if (isB2B) verdictReasons.push('back-to-back fatigue');
  if (oppOut.length >= 2) verdictReasons.push(`${oppOut.length} key ${oppAbbr} players out`);
  if (myOut.length >= 1) verdictReasons.push('own team rotation impact');
  const verdictReason = verdictReasons.length ? verdictReasons.join(', ') : 'signals are neutral';

  const injRow = (list, label, color) => {
    if (!list.length) return `<div class="rt-inj-none" style="color:${color}">${label} — none</div>`;
    return list.map(i => `
      <div class="rt-inj-row">
        <span class="inj-dot" style="background:${/out/i.test(i.status)?'var(--red)':'var(--orange)'}"></span>
        <span class="rt-inj-name" style="color:${color}">${i.name}</span>
        <span class="rt-inj-status">${i.status}</span>
      </div>`).join('');
  };

  el.innerHTML = `
    <div class="rt-wrap">

      <div class="rt-section">
        <div class="rt-section-title">Minutes</div>
        <div class="rt-rows">
          <div class="rt-row"><span class="rt-key">L5 Avg</span><span class="rt-val">${fmtMin(l5min)}</span></div>
          <div class="rt-row"><span class="rt-key">L10 Avg</span><span class="rt-val">${fmtMin(l10min)}</span></div>
          <div class="rt-row"><span class="rt-key">Trend</span><span class="rt-val" style="color:${trendColor}">${fmt(trend)}</span></div>
          <div class="rt-row"><span class="rt-key">Home Avg</span><span class="rt-val">${fmtMin(homeMin)}</span></div>
          <div class="rt-row"><span class="rt-key">Away Avg</span><span class="rt-val">${fmtMin(awayMin)}</span></div>
          <div class="rt-row"><span class="rt-key">Back-to-Back</span><span class="rt-val" style="color:${isB2B?'var(--orange)':'var(--green)'}">${isB2B ? '⚠ YES' : 'No'}</span></div>
        </div>
      </div>

      <div class="rt-section">
        <div class="rt-section-title">Injury Context</div>
        <div class="rt-inj-block">
          <div class="rt-inj-label">My Team (${isAway ? gameInfo.awayAbbr : gameInfo.homeAbbr})</div>
          ${injRow(myOut, '', 'var(--text)')}
        </div>
        <div class="rt-inj-block" style="margin-top:10px">
          <div class="rt-inj-label">Opponent (${oppAbbr})</div>
          ${injRow(oppOut, '', 'var(--text2)')}
        </div>
      </div>

      <div class="rt-section">
        <div class="rt-section-title">Opponent Defense</div>
        <div class="rt-rows">
          <div class="rt-row"><span class="rt-key">Opp Def Rating</span><span class="rt-val">${oppDefRtg != null ? oppDefRtg : '<span class="rt-na">unavailable</span>'}</span></div>
          <div class="rt-row"><span class="rt-key">vs ${oppAbbr} (ESPN)</span><span class="rt-val">${oppOut.length ? `${oppOut.length} key players out` : 'Full strength'}</span></div>
        </div>
      </div>

      <div class="rt-section">
        <div class="rt-section-title">Score Margin Splits</div>
        <div class="rt-rows">
          ${marginRow('Close (≤9 pts)', closeGames, closeAvgMin, closeAvgPts, closeHits, tonightScenario === 'close')}
          ${marginRow('Blowout (≥10 pts)', blowouts, blowAvgMin, blowAvgPts, blowHits, tonightScenario === 'blowout')}
        </div>
        ${marginNote ? `<div class="rt-margin-note">${marginNote}</div>` : ''}
      </div>

      <div class="rt-section">
        <div class="rt-section-title">Pace &amp; Game Total</div>
        <div class="rt-rows">
          <div class="rt-row"><span class="rt-key">Over/Under</span><span class="rt-val" style="color:var(--lime)">${ou || '<span class="rt-na">N/A</span>'}</span></div>
          <div class="rt-row"><span class="rt-key">Opp Pace</span><span class="rt-val">${oppPace != null ? oppPace : '<span class="rt-na">unavailable</span>'}</span></div>
          <div class="rt-row"><span class="rt-key">Tonight B2B</span><span class="rt-val" style="color:${isB2B?'var(--orange)':'var(--text2)'}">${isB2B ? 'Yes' : 'No'}</span></div>
        </div>
      </div>

      <div class="rt-section">
        <div class="rt-section-title">Hit Rate</div>
        <div class="rt-rows">
          <div class="rt-row"><span class="rt-key">PTS L5 Avg</span><span class="rt-val">${fmt(l5pts)}</span></div>
          <div class="rt-row"><span class="rt-key">PTS L10 Avg</span><span class="rt-val">${fmt(l10pts)}</span></div>
          <div class="rt-row"><span class="rt-key">Above L10 Avg (L5)</span><span class="rt-val">${hitsOverL10avg}/5 games</span></div>
          <div class="rt-row"><span class="rt-key">FGA Range (L10)</span><span class="rt-val">${l10fgaMin != null ? `${l10fgaMin}–${l10fgaMax} (avg ${l10fgaAvg})` : '<span class="rt-na">N/A</span>'}</span></div>
        </div>
      </div>

      <div class="rt-verdict">
        <div class="rt-verdict-label" style="color:${verdictColor}">${verdictLabel}</div>
        <div class="rt-verdict-reason">${verdictReason}</div>
      </div>

    </div>`;
}

/* ═══════════════════════════════════════════════════════════
   8. ROSTER FETCH (ALL SPORTS)
═══════════════════════════════════════════════════════════ */
async function fetchRoster(sportKey, teamId) {
  const sp = SPORTS.find(s => s.key === sportKey);
  if (!sp) return [];
  const data = await espn(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/teams/${teamId}/roster`);
  if (!data?.athletes) return [];

  // ESPN returns roster in position groups
  const players = [];
  (data.athletes || []).forEach(group => {
    (group.items || [group]).forEach(p => {
      if (p.fullName) {
        // ESPN status/injury status can be objects — always extract as string
        const rawInjStatus = p.injuries?.[0]?.status;
        const rawStatus = p.status;
        const extractStr = (v) => typeof v === 'string' ? v : (v?.description || v?.name || v?.type || v?.text || null);
        const injuryStatus = extractStr(rawInjStatus);
        const playerStatus = extractStr(rawStatus);
        const injuryDesc = p.injuries?.[0]?.type?.description || p.injuries?.[0]?.details?.type || '';

        players.push({
          id: p.id,
          name: p.displayName || p.fullName,
          fullName: p.fullName,
          displayName: p.displayName || p.fullName,
          pos: p.position?.abbreviation || '—',
          position: p.position?.abbreviation || '',
          jersey: p.jersey || '—',
          status: injuryStatus || playerStatus || 'Active',
          injuryDesc: injuryDesc,
          headshotUrl: p.headshot?.href || null,
        });
      }
    });
  });
  return players;
}

/* ═══════════════════════════════════════════════════════════
   8b. LINEUPS FETCH (NBA ONLY)
   Uses ESPN depthcharts endpoint — first player per position
   is the starter.
═══════════════════════════════════════════════════════════ */
async function fetchLineups(sportKey, teamId) {
  const sp = SPORTS.find(s => s.key === sportKey);
  if (!sp) return [];
  const data = await espn(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/teams/${teamId}/depthcharts`);

  // ESPN returns data.depthchart (not data.items)
  const charts = data?.depthchart || data?.items || [];
  if (!charts.length) return [];

  // NBA positions — ESPN uses lowercase keys
  const posOrder = ['pg', 'sg', 'sf', 'pf', 'c'];
  const posLabels = { pg: 'PG', sg: 'SG', sf: 'SF', pf: 'PF', c: 'C' };
  const starters = [];

  for (const chart of charts) {
    const positions = chart.positions || {};
    for (const posKey of posOrder) {
      const pos = positions[posKey];
      if (!pos?.athletes?.length) continue;
      // First athlete in the array = starter
      const a = pos.athletes[0];
      if (a.id && !starters.find(s => s.athleteId === a.id)) {
        starters.push({
          athleteId: a.id,
          name: a.displayName || 'Unknown',
          shortName: a.shortName || a.displayName?.split(' ').pop() || '?',
          pos: posLabels[posKey] || posKey.toUpperCase(),
          jersey: a.jersey || '—',
          headshotUrl: `https://a.espncdn.com/i/headshots/${sp.league}/players/full/${a.id}.png`,
        });
      }
    }
    if (starters.length >= 5) break;
  }

  return starters;
}

/* ── PLAYER SEASON STATS (NBA) ─────────────────────────── */
async function fetchPlayerSeasonStats(athleteId) {
  const data = await espn(
    `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${athleteId}/stats?region=us&lang=en&contentorigin=espn`
  );
  if (!data?.categories) return null;

  // Find the "averages" category
  const avgCat = data.categories.find(c => c.name === 'averages');
  if (!avgCat?.names?.length || !avgCat?.statistics?.length) return null;

  // Find the current season entry (highest year)
  const currentSeason = avgCat.statistics.reduce((best, entry) =>
    (!best || (entry.season?.year || 0) > (best.season?.year || 0)) ? entry : best
  , null);
  if (!currentSeason?.stats?.length) return null;

  // Map names[] to stats[] values
  const stats = {};
  avgCat.names.forEach((name, i) => {
    const raw = currentSeason.stats[i];
    // Some values are "4.5-10.7" (made-attempted) — parse first number as the value
    const val = parseFloat(raw);
    if (!isNaN(val)) stats[name] = val;
  });

  stats._gp = stats.gamesPlayed || 0;
  return Object.keys(stats).length > 1 ? stats : null;
}

async function enrichLineupsWithStats(lineup) {
  if (!lineup?.length) return lineup;
  const results = await Promise.all(
    lineup.map(p => fetchPlayerSeasonStats(p.athleteId))
  );
  return lineup.map((p, i) => ({ ...p, stats: results[i] }));
}

/* ── H2H PLAYER STATS (from boxscores) ────────────────────
   Extracts per-player stats from H2H game summaries.
   Only counts games where BOTH players in a position matchup
   actually played — so the GP count matches and it's a true
   head-to-head comparison.
   ────────────────────────────────────────────────────────── */
const H2H_STAT_MAP = {
  'MIN': 'avgMinutes', 'PTS': 'avgPoints', 'REB': 'avgRebounds',
  'AST': 'avgAssists', 'STL': 'avgSteals', 'BLK': 'avgBlocks',
  'TO': 'avgTurnovers', 'FG%': 'fieldGoalPct',
};
const H2H_LABELS = Object.keys(H2H_STAT_MAP);

// Check if a player actually played (not DNP) in a given summary
function playerPlayedInGame(summary, athleteId) {
  if (!summary?.boxscore?.players || !athleteId) return false;
  for (const teamData of summary.boxscore.players) {
    for (const grp of teamData.statistics || []) {
      const ath = grp.athletes?.find(a => a.athlete?.id == athleteId);
      if (!ath) continue;
      if (ath.didNotPlay || !ath.stats?.length || ath.stats?.[0] === 'DNP' || ath.stats?.[0] === '0:00') return false;
      return true;
    }
  }
  return false;
}

// Extract one player's stats from a single game summary
function extractPlayerGameStats(summary, athleteId) {
  if (!summary?.boxscore?.players || !athleteId) return null;
  for (const teamData of summary.boxscore.players) {
    for (const grp of teamData.statistics || []) {
      const lbls = grp.labels || [];
      const ath = grp.athletes?.find(a => a.athlete?.id == athleteId);
      if (!ath) continue;
      if (ath.didNotPlay || !ath.stats?.length || ath.stats?.[0] === 'DNP' || ath.stats?.[0] === '0:00') return null;
      const game = {};
      H2H_LABELS.forEach(lbl => {
        const idx = lbls.indexOf(lbl);
        if (idx > -1 && ath.stats[idx] != null) {
          const val = parseFloat(String(ath.stats[idx]));
          if (!isNaN(val)) game[H2H_STAT_MAP[lbl]] = val;
        }
      });
      return Object.keys(game).length > 0 ? game : null;
    }
  }
  return null;
}

// Average an array of per-game stat objects
function averageStats(gameStats) {
  if (!gameStats.length) return null;
  const avg = {};
  const allKeys = new Set(gameStats.flatMap(g => Object.keys(g)));
  allKeys.forEach(key => {
    const vals = gameStats.map(g => g[key]).filter(v => v != null);
    if (vals.length) avg[key] = vals.reduce((a, b) => a + b, 0) / vals.length;
  });
  avg._gp = gameStats.length;
  return avg;
}

// Enrich both lineups position-by-position using only shared H2H games
function enrichLineupsWithH2HStats(awayLineup, homeLineup, summaries) {
  if (!summaries?.length) return { away: awayLineup, home: homeLineup };
  const posOrder = ['PG', 'SG', 'SF', 'PF', 'C'];

  const enrichedAway = awayLineup.map(p => ({ ...p }));
  const enrichedHome = homeLineup.map(p => ({ ...p }));

  for (const pos of posOrder) {
    const awayP = enrichedAway.find(p => p.pos === pos);
    const homeP = enrichedHome.find(p => p.pos === pos);
    if (!awayP || !homeP) continue;

    // Find games where BOTH players actually played
    const sharedGames = summaries.filter(s =>
      playerPlayedInGame(s, awayP.athleteId) && playerPlayedInGame(s, homeP.athleteId)
    );

    if (!sharedGames.length) continue;

    // Extract stats from only those shared games
    const awayGameStats = sharedGames.map(s => extractPlayerGameStats(s, awayP.athleteId)).filter(Boolean);
    const homeGameStats = sharedGames.map(s => extractPlayerGameStats(s, homeP.athleteId)).filter(Boolean);

    awayP.stats = averageStats(awayGameStats);
    homeP.stats = averageStats(homeGameStats);
  }

  return { away: enrichedAway, home: enrichedHome };
}

/* ═══════════════════════════════════════════════════════════
   9. RENDER FUNCTIONS (ALL SPORTS)
   All renderers are sport-agnostic — they read SportConfig
   dynamically for stat categories, labels, and chart data.
═══════════════════════════════════════════════════════════ */

/* ── OVERVIEW ───────────────────────────────────────────── */
function renderOverview({ gameInfo, awayForm, homeForm }) {
  const awayW = awayForm.filter(g => g.result === 'W').length;
  const homeW = homeForm.filter(g => g.result === 'W').length;
  const awayStreak = getStreak(awayForm);
  const homeStreak = getStreak(homeForm);

  const teamCol = (team, abbr, logo, form, wins, streak) => `
    <div class="team-col">
      ${logo ? `<img class="overview-logo" src="${logo}" alt="${abbr}" onerror="this.style.display='none'">` : ''}
      <div class="team-name">${abbr}</div>
      <div class="team-record">${team}</div>
      <div class="team-stat-row">
        <div class="team-stat-item"><span class="tsi-label">Last ${form.length}</span><span class="tsi-val">${wins}-${form.length - wins}</span></div>
        <div class="team-stat-item"><span class="tsi-label">Streak</span><span class="tsi-val">${streak}</span></div>
        <div class="team-stat-item"><span class="tsi-label">Avg Score</span><span class="tsi-val">${avgScore(form)}</span></div>
        <div class="team-stat-item"><span class="tsi-label">Avg Allowed</span><span class="tsi-val">${avgAllowed(form)}</span></div>
        <div class="team-stat-item"><span class="tsi-label">Form</span><span class="tsi-val">${form.map(g => `<span style="color:${g.result==='W'?'var(--green)':'var(--red)'}">${g.result}</span>`).join(' ')}</span></div>
      </div>
    </div>`;

  document.getElementById('teamColAway').innerHTML = teamCol(gameInfo.awayFull, gameInfo.awayAbbr, gameInfo.awayLogo, awayForm, awayW, awayStreak);
  document.getElementById('teamColHome').innerHTML = teamCol(gameInfo.homeFull, gameInfo.homeAbbr, gameInfo.homeLogo, homeForm, homeW, homeStreak);

  // Charts
  document.getElementById('overviewCharts').innerHTML = `
    <div class="chart-box"><h4>Scoring (Last 5)</h4><canvas id="scoreChart" height="160"></canvas></div>
    <div class="chart-box"><h4>Win/Loss Trend</h4><canvas id="trendChart" height="160"></canvas></div>`;

  setTimeout(() => buildOverviewCharts(gameInfo, awayForm, homeForm), 50);
}

function getStreak(form) {
  if (!form.length) return '—';
  const last = form[form.length - 1]?.result;
  let count = 0;
  for (let i = form.length - 1; i >= 0; i--) {
    if (form[i].result === last) count++;
    else break;
  }
  return `${count}${last}`;
}

function avgScore(form) {
  if (!form.length) return '—';
  return (form.reduce((s, g) => s + g.myScore, 0) / form.length).toFixed(1);
}
function avgAllowed(form) {
  if (!form.length) return '—';
  return (form.reduce((s, g) => s + g.oppScore, 0) / form.length).toFixed(1);
}

function buildOverviewCharts(gameInfo, awayForm, homeForm) {
  const labels = ['G1','G2','G3','G4','G5'];
  const awayScores = awayForm.map(g => g.myScore);
  const homeScores = homeForm.map(g => g.myScore);

  const scoreCtx = document.getElementById('scoreChart');
  if (scoreCtx) {
    if (S.charts.score) S.charts.score.destroy();
    S.charts.score = new Chart(scoreCtx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: gameInfo.awayAbbr, data: awayScores, borderColor: '#4d8bff', backgroundColor: 'rgba(77,139,255,0.1)', tension: 0.4, fill: true, pointRadius: 4, pointBackgroundColor: '#4d8bff' },
          { label: gameInfo.homeAbbr, data: homeScores, borderColor: '#d4f53c', backgroundColor: 'rgba(212,245,60,0.1)', tension: 0.4, fill: true, pointRadius: 4, pointBackgroundColor: '#d4f53c' },
        ]
      },
      options: chartOpts(),
    });
  }

  // Win/loss as bar
  const trendCtx = document.getElementById('trendChart');
  if (trendCtx) {
    if (S.charts.trend) S.charts.trend.destroy();
    const awayWins = awayForm.map(g => g.result === 'W' ? 1 : -1);
    const homeWins = homeForm.map(g => g.result === 'W' ? 1 : -1);
    S.charts.trend = new Chart(trendCtx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: gameInfo.awayAbbr, data: awayWins, backgroundColor: awayWins.map(v => v > 0 ? 'rgba(77,139,255,0.6)' : 'rgba(255,61,90,0.4)'), borderRadius: 4 },
          { label: gameInfo.homeAbbr, data: homeWins, backgroundColor: homeWins.map(v => v > 0 ? 'rgba(212,245,60,0.6)' : 'rgba(255,61,90,0.4)'), borderRadius: 4 },
        ]
      },
      options: chartOpts(),
    });
  }
}

/* ── ROSTER ─────────────────────────────────────────────── */
function renderRoster({ gameInfo, awayRoster, homeRoster }) {
  const statusColor = (s) => {
    if (!s || /^active$/i.test(s)) return 'var(--green)';
    if (/out/i.test(s)) return 'var(--red)';
    if (/doubtful/i.test(s)) return 'var(--orange)';
    if (/questionable/i.test(s)) return 'var(--yellow)';
    if (/day.to.day/i.test(s)) return 'var(--yellow)';
    return 'var(--text3)';
  };
  const table = (roster) => `
    <table class="roster-table">
      <thead><tr><th>#</th><th>Player</th><th>Pos</th><th>Status</th></tr></thead>
      <tbody>${roster.map(p => {
        const sc = statusColor(p.status);
        const label = p.status || 'Active';
        return `
        <tr>
          <td style="color:var(--text3)">${p.jersey}</td>
          <td>${p.name}</td>
          <td><span class="player-pos">${p.pos}</span></td>
          <td style="color:${sc}">${label}</td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>`;

  document.getElementById('rosterGrid').innerHTML = `
    <div class="roster-team-block">
      <h3>${gameInfo.awayFull}</h3>
      ${awayRoster.length ? table(awayRoster) : '<p class="empty-msg">Roster not available</p>'}
    </div>
    <div class="roster-team-block">
      <h3>${gameInfo.homeFull}</h3>
      ${homeRoster.length ? table(homeRoster) : '<p class="empty-msg">Roster not available</p>'}
    </div>`;
}

/* ── FORM ───────────────────────────────────────────────── */
function renderForm({ gameInfo, awayForm, homeForm }) {
  const cats = window.SportConfig?.[gameInfo.sportKey]?.statCategories || [];
  const firstCat = cats[0];
  const hasPlayerData = (form) => form.some(g => g.player);

  const statBtns = (chartId) => cats.map((c, i) =>
    `<button class="stat-btn${i === 0 ? ' active' : ''}" onclick="switchFormStat('${chartId}', '${c.key}', this)">${c.label}</button>`
  ).join('');

  const formBlock = (teamName, form, chartId) => `
    <div class="form-team-block">
      <h3>${teamName}</h3>
      ${hasPlayerData(form) && cats.length ? `
      <div class="form-chart-section">
        <div class="form-chart-controls">
          <span class="form-chart-label">Player of the Game</span>
          <div class="stat-toggle">${statBtns(chartId)}</div>
        </div>
        <div class="bar-cards-wrapper" id="${chartId}-wrapper">
          <canvas id="${chartId}" height="150"></canvas>
        </div>
      </div>` : ''}
    </div>`;

  document.getElementById('formGrid').innerHTML = `
    <div class="form-team-toggle">
      <button class="form-team-btn active" onclick="switchFormTeam('away', this)">${gameInfo.awayFull}</button>
      <button class="form-team-btn" onclick="switchFormTeam('home', this)">${gameInfo.homeFull}</button>
    </div>
    <div id="formPanelAway">${formBlock(gameInfo.awayFull, awayForm, 'formChartAway')}</div>
    <div id="formPanelHome" style="display:none">${formBlock(gameInfo.homeFull, homeForm, 'formChartHome')}</div>
  `;

  const defaultStat = firstCat?.key || 'pts';
  setTimeout(() => {
    if (hasPlayerData(awayForm)) renderFormChart('formChartAway', awayForm, defaultStat);
  }, 50);
}

function switchFormTeam(side, btn) {
  btn.closest('.form-team-toggle').querySelectorAll('.form-team-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('formPanelAway').style.display = side === 'away' ? '' : 'none';
  document.getElementById('formPanelHome').style.display = side === 'home' ? '' : 'none';
  if (side === 'home') {
    const form = S.gameData.homeForm;
    const cats = window.SportConfig?.[S.gameData.gameInfo.sportKey]?.statCategories || [];
    const defaultStat = cats[0]?.key || 'pts';
    if (form.some(g => g.player)) requestAnimationFrame(() => renderFormChart('formChartHome', form, defaultStat));
  }
}

function renderFormChart(chartId, games, stat) {
  const ctx = document.getElementById(chartId);
  if (!ctx) return;
  if (S.charts[chartId]) S.charts[chartId].destroy();

  // Scale card height based on chart width
  const wrapperEl = document.getElementById(`${chartId}-wrapper`);
  const chartWidth = wrapperEl?.offsetWidth || 400;
  const barSlotW = games.length ? chartWidth / games.length : 62;
  const dynCardW = Math.min(62, Math.max(36, barSlotW - 4));
  const dynImgSize = Math.min(46, dynCardW - 12);
  const CARD_H = dynImgSize + 44;
  const LOGO_SIZE = 22;
  const values = games.map(g => g.player?.[stat]?.value ?? 0);
  const colors = games.map(g =>
    g.result === 'W' ? 'rgba(35,209,139,0.82)' : 'rgba(255,61,90,0.82)'
  );
  const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;

  // Preload opponent logos
  const sp = SPORTS.find(s => s.key === S.gameData?.gameInfo?.sportKey);
  const logoImgs = games.map(g => {
    const img = new Image();
    img.src = sp ? `https://a.espncdn.com/i/teamlogos/${sp.league}/500-dark/${g.opponent.toLowerCase()}.png` : '';
    img.onload = () => { if (S.charts[chartId]) S.charts[chartId].update('none'); };
    return img;
  });

  const xLogoPlugin = {
    id: 'xLogos',
    afterDraw(chart) {
      const { ctx: c, chartArea, scales } = chart;
      const xScale = scales.x;
      games.forEach((g, i) => {
        const x = xScale.getPixelForValue(i);
        const y = chartArea.bottom + 8;
        const img = logoImgs[i];
        if (img?.complete && img.naturalWidth > 0) {
          c.drawImage(img, Math.round(x - LOGO_SIZE / 2), Math.round(y), LOGO_SIZE, LOGO_SIZE);
        } else {
          // fallback: dim text
          c.save();
          c.fillStyle = '#555577';
          c.font = '9px IBM Plex Mono';
          c.textAlign = 'center';
          c.fillText(g.opponent, x, y + 14);
          c.restore();
        }
      });
    },
  };

  S.charts[chartId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: games.map(() => ''),
      datasets: [
        {
          data: values,
          backgroundColor: colors,
          borderRadius: 5,
          borderSkipped: false,
        },
        {
          type: 'line',
          data: new Array(values.length).fill(parseFloat(avg.toFixed(1))),
          borderColor: 'rgba(255,255,255,0.22)',
          borderWidth: 1.5,
          borderDash: [5, 4],
          pointRadius: 0,
          fill: false,
          tension: 0,
        },
      ],
    },
    options: {
      responsive: true,
      animation: { duration: 120, onComplete: () => positionBarCards(chartId, games, stat) },
      layout: { padding: { top: CARD_H + 8, bottom: 10 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const g = games[items[0].dataIndex];
              return `${g.home ? 'vs' : '@'}${g.opponent} — ${g.result} (${g.myScore}-${g.oppScore})`;
            },
            label: (item) => {
              const g = games[item.dataIndex];
              const leader = g.player?.[stat];
              if (!leader) return `${item.raw} ${stat.toUpperCase()}`;
              return `${leader.name} — ${leader.value} ${stat.toUpperCase()}`;
            },
          },
          backgroundColor: 'rgba(13,13,18,0.95)',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          titleColor: '#f0f0fa',
          bodyColor: '#b8bce8',
          padding: 10,
        },
      },
      scales: {
        x: {
          ticks: { color: 'transparent', font: { family: 'IBM Plex Mono', size: 10 } },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          ticks: { color: '#8888b0', font: { family: 'IBM Plex Mono', size: 10 }, stepSize: 5 },
          grid: { color: 'rgba(255,255,255,0.04)' },
          border: { display: false },
          beginAtZero: true,
        },
      },
    },
    plugins: [xLogoPlugin],
  });

}

function positionBarCards(chartId, games, stat) {
  const chart = S.charts[chartId];
  const wrapper = document.getElementById(`${chartId}-wrapper`);
  if (!chart || !wrapper) return;

  wrapper.querySelector('.bar-cards-overlay')?.remove();

  // Scale card size based on available width per bar
  const chartWidth = chart.chartArea?.width || wrapper.offsetWidth;
  const barSlotW = games.length ? chartWidth / games.length : 62;
  const CARD_W = Math.min(62, Math.max(36, barSlotW - 4));
  const imgSize = Math.min(46, CARD_W - 12);
  const CARD_H = imgSize + 44; // img + val + name + padding
  const GAP = 4;
  const overlay = document.createElement('div');
  overlay.className = 'bar-cards-overlay';

  const meta = chart.getDatasetMeta(0);
  games.forEach((g, i) => {
    const leader = g?.player?.[stat];
    const bar = meta.data[i];
    if (!bar || !leader || !isFinite(bar.x) || !isFinite(bar.y)) return;

    const card = document.createElement('div');
    card.className = 'form-potg-card';
    card.style.cssText = `position:absolute;left:${Math.round(bar.x - CARD_W / 2)}px;top:${Math.round(bar.y - CARD_H - GAP)}px;width:${CARD_W}px;`;

    const imgEl = leader.headshot ? (() => {
      const img = new Image();
      img.src = leader.headshot;
      img.alt = leader.name;
      img.style.cssText = `width:${imgSize}px;height:${imgSize}px`;
      img.onerror = function() { this.style.display = 'none'; this.nextElementSibling.style.display = 'flex'; };
      return img;
    })() : null;

    const avatar = document.createElement('div');
    avatar.className = 'form-potg-card-avatar';
    avatar.style.cssText = `width:${imgSize}px;height:${imgSize}px`;
    if (imgEl) avatar.style.display = 'none';

    const val = document.createElement('div');
    val.className = 'form-potg-card-val';
    val.style.fontSize = CARD_W < 50 ? '13px' : '16px';
    val.textContent = leader.value;

    const name = document.createElement('div');
    name.className = 'form-potg-card-name';
    name.style.fontSize = CARD_W < 50 ? '7px' : '8px';
    name.textContent = leader.name;

    if (imgEl) card.appendChild(imgEl);
    card.appendChild(avatar);
    card.appendChild(val);
    card.appendChild(name);
    overlay.appendChild(card);
  });

  wrapper.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.querySelectorAll('.form-potg-card').forEach(c => c.classList.add('potg-visible'));
  });
}

function switchFormStat(chartId, stat, btn) {
  btn.closest('.stat-toggle').querySelectorAll('.stat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const form = chartId === 'formChartAway' ? S.gameData.awayForm : S.gameData.homeForm;
  renderFormChart(chartId, form, stat);
}

/* ── H2H ────────────────────────────────────────────────── */
function renderH2H({ gameInfo, h2h }) {
  if (!h2h.length) {
    document.getElementById('h2hContent').innerHTML = `<p class="empty-msg">No head-to-head history found in the last 3 seasons.</p>`;
    return;
  }

  const awayWins = h2h.filter(g => g.winnerAbbr === gameInfo.awayAbbr).length;
  const homeWins = h2h.filter(g => g.winnerAbbr === gameInfo.homeAbbr).length;
  const hasLeaders = h2h.some(g => g.awayLeader || g.homeLeader);

  const leaderBlock = (leader, teamId) => {
    if (!leader) return '';
    const playerCard = (cat, statLabel) => {
      if (!cat) return '';
      const img = cat.headshot
        ? `<img class="h2h-player-headshot" src="${cat.headshot}" alt="${cat.name}" onerror="this.style.display='none'">`
        : `<div class="h2h-player-headshot h2h-player-headshot-empty"></div>`;
      const name = cat.athleteId
        ? `<strong class="player-link" data-athlete-id="${cat.athleteId}" data-team-id="${teamId}" data-name="${cat.name.replace(/"/g,'&quot;')}" data-headshot="${cat.headshot||''}" onclick="openPlayerModal(this)">${cat.name}</strong>`
        : `<strong class="h2h-player-name">${cat.name}</strong>`;
      return `
        <div class="h2h-player-card">
          ${img}
          ${name}
          <span class="h2h-player-stat">${cat.value} <span class="h2h-player-stat-label">${statLabel}</span></span>
        </div>`;
    };
    const cats = window.SportConfig?.[gameInfo.sportKey]?.statCategories || [];
    return `
      <div class="h2h-player-row">
        ${cats.map(c => playerCard(leader[c.key], c.label)).join('')}
      </div>`;
  };

  document.getElementById('h2hContent').innerHTML = `
    <div class="h2h-summary">
      <div class="h2h-stat-card">
        <span class="h2h-val" style="color:var(--blue)">${awayWins}</span>
        <span class="h2h-label">${gameInfo.awayAbbr} Wins</span>
      </div>
      <div class="h2h-stat-card">
        <span class="h2h-val" style="color:var(--orange)">${homeWins}</span>
        <span class="h2h-label">${gameInfo.homeAbbr} Wins</span>
      </div>
      <div class="h2h-stat-card">
        <span class="h2h-val" style="color:var(--text2)">${h2h.length}</span>
        <span class="h2h-label">Last ${h2h.length} Matchups</span>
      </div>
    </div>

    ${hasLeaders ? (() => {
      const cats = window.SportConfig?.[gameInfo.sportKey]?.statCategories || [];
      const h2hBtns = (chartId) => cats.map((c, i) =>
        `<button class="stat-btn${i === 0 ? ' active' : ''}" onclick="switchH2HStat('${chartId}', '${c.key}', this)">${c.label}</button>`
      ).join('');
      return `
    <div class="h2h-charts-row">
      <div class="form-chart-section">
        <div class="form-chart-controls">
          <span class="form-chart-label" style="color:var(--blue)">${gameInfo.awayAbbr} · Player of the Game</span>
          <div class="stat-toggle">${h2hBtns('h2hChartAway')}</div>
        </div>
        <canvas id="h2hChartAway" height="150"></canvas>
      </div>
      <div class="form-chart-section">
        <div class="form-chart-controls">
          <span class="form-chart-label" style="color:var(--orange)">${gameInfo.homeAbbr} · Player of the Game</span>
          <div class="stat-toggle">${h2hBtns('h2hChartHome')}</div>
        </div>
        <canvas id="h2hChartHome" height="150"></canvas>
      </div>
    </div>`;
    })() : ''}

    <div class="h2h-game-list">
      ${h2h.map(g => `
        <div class="h2h-game">
          <div class="h2h-game-header">
            <div class="h2h-teams">${g.awayTeam} @ ${g.homeTeam}</div>
            <div class="h2h-score">${g.awayScore}–${g.homeScore}</div>
            <span class="h2h-winner ${g.winner}">${g.winner === 'away' ? g.awayTeam : g.homeTeam} W</span>
            <span class="h2h-date">${g.date}</span>
          </div>
          ${(g.awayLeader || g.homeLeader) ? `
          <div class="h2h-leaders-grid">
            <div class="h2h-leader-team">
              <span class="h2h-leader-tag" style="color:var(--blue)">${g.awayTeam}</span>
              ${leaderBlock(g.awayLeader, gameInfo.awayTeamId)}
            </div>
            <div class="h2h-leader-team">
              <span class="h2h-leader-tag" style="color:var(--orange)">${g.homeTeam}</span>
              ${leaderBlock(g.homeLeader, gameInfo.homeTeamId)}
            </div>
          </div>` : ''}
        </div>`).join('')}
    </div>`;

  if (hasLeaders) {
    const defaultStat = window.SportConfig?.[gameInfo.sportKey]?.statCategories?.[0]?.key || 'pts';
    setTimeout(() => {
      renderH2HChart('h2hChartAway', h2h, 'away', defaultStat);
      renderH2HChart('h2hChartHome', h2h, 'home', defaultStat);
    }, 50);
  }
}

function renderH2HChart(chartId, h2h, side, stat) {
  const ctx = document.getElementById(chartId);
  if (!ctx) return;
  if (S.charts[chartId]) S.charts[chartId].destroy();

  const teamAbbr = side === 'away' ? S.gameData.gameInfo.awayAbbr : S.gameData.gameInfo.homeAbbr;
  const ordered = [...h2h].reverse(); // oldest left, newest right
  const labels = ordered.map(g => g.date.replace(/,.*/, ''));
  const values = ordered.map(g => {
    const leader = side === 'away' ? g.awayLeader : g.homeLeader;
    return leader?.[stat]?.value ?? 0;
  });
  const colors = ordered.map(g =>
    g.winnerAbbr === teamAbbr ? 'rgba(35,209,139,0.82)' : 'rgba(255,61,90,0.82)'
  );
  const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;

  S.charts[chartId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: colors,
          borderRadius: 5,
          borderSkipped: false,
        },
        {
          type: 'line',
          data: new Array(values.length).fill(parseFloat(avg.toFixed(1))),
          borderColor: 'rgba(255,255,255,0.22)',
          borderWidth: 1.5,
          borderDash: [5, 4],
          pointRadius: 0,
          fill: false,
          tension: 0,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const g = ordered[items[0].dataIndex];
              return `${g.awayTeam} @ ${g.homeTeam} · ${g.awayScore}–${g.homeScore}`;
            },
            label: (item) => {
              const g = ordered[item.dataIndex];
              const leader = side === 'away' ? g.awayLeader : g.homeLeader;
              const catLeader = leader?.[stat];
              if (!catLeader) return `${item.raw} ${stat.toUpperCase()}`;
              return `${catLeader.name} — ${catLeader.value} ${stat.toUpperCase()}`;
            },
          },
          backgroundColor: 'rgba(13,13,18,0.95)',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          titleColor: '#f0f0fa',
          bodyColor: '#b8bce8',
          padding: 10,
        },
      },
      scales: {
        x: {
          ticks: { color: '#8888b0', font: { family: 'IBM Plex Mono', size: 10 } },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          ticks: { color: '#8888b0', font: { family: 'IBM Plex Mono', size: 10 }, stepSize: 5 },
          grid: { color: 'rgba(255,255,255,0.04)' },
          border: { display: false },
          beginAtZero: true,
        },
      },
    },
  });
}

function switchH2HStat(chartId, stat, btn) {
  btn.closest('.stat-toggle').querySelectorAll('.stat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const side = chartId === 'h2hChartAway' ? 'away' : 'home';
  renderH2HChart(chartId, S.gameData.h2h, side, stat);
}

/* ── PROPS SCOUT TAB (ALL SPORTS) ──────────────────────── */
/* Injury data + team stats. Uses SportConfig.propsStats    */
async function renderProps(data) {
  const { gameInfo, awayForm, homeForm } = data;
  const el = document.getElementById('propsContent');
  if (!el) return;

  el.innerHTML = `<div class="inline-loader"><div class="mini-spin"></div> Loading team data…</div>`;

  let awayStats = null, homeStats = null;
  try {
    [awayStats, homeStats] = await Promise.all([
      fetchTeamStats(gameInfo.sportKey, gameInfo.awayTeamId),
      fetchTeamStats(gameInfo.sportKey, gameInfo.homeTeamId),
    ]);
  } catch (e) {
    console.error('fetchTeamStats failed:', e);
  }

  // Only show truly injured players (not active) — enrich with position from roster
  const enrichWithPos = (injs, roster) => injs.map(i => {
    if (!i.pos) {
      const match = roster.find(p => p.name === i.name || p.fullName === i.name);
      if (match) i.pos = match.pos;
    }
    return i;
  });
  const awayInj = enrichWithPos(
    (data.injuries?.away || []).filter(i => !/^active$/i.test(i.status)),
    data.awayRoster || []
  );
  const homeInj = enrichWithPos(
    (data.injuries?.home || []).filter(i => !/^active$/i.test(i.status)),
    data.homeRoster || []
  );

  // Also pull injured players from roster that might not be in injury report
  const addRosterInjured = (roster, existingInjs) => {
    const existingNames = new Set(existingInjs.map(i => i.name));
    roster.forEach(p => {
      if (!existingNames.has(p.name) && p.status && !/^active$/i.test(p.status)) {
        existingInjs.push({
          name: p.name,
          status: p.status,
          desc: p.injuryDesc || '—',
          pos: p.pos,
          headshotUrl: p.headshotUrl,
        });
      }
    });
  };
  addRosterInjured(data.awayRoster || [], awayInj);
  addRosterInjured(data.homeRoster || [], homeInj);

  // Back-to-back check — did either team play yesterday?
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  const yStr = yest.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const awayB2B = (awayForm||[]).length && awayForm[awayForm.length - 1]?.date === yStr;
  const homeB2B = (homeForm||[]).length && homeForm[homeForm.length - 1]?.date === yStr;

  const cfg = window.SportConfig?.[gameInfo.sportKey]?.propsStats;

  const statBlock = (stats, label, color) => {
    if (!stats) return `<div class="pc-team-col"><div class="pc-team-label" style="color:${color}">${label}</div><div style="color:var(--text3);font-size:12px;padding:12px 0">Stats unavailable</div></div>`;
    const r = (key) => stats[key]?.rank ? `<span class="pc-rank">#${stats[key].rank}</span>` : '';
    const v = (key, pct) => {
      if (stats[key]?.value == null) return '—';
      const val = Math.round(stats[key].value * 100) / 100;
      return pct ? val + '%' : val;
    };
    const rows = (group) => (cfg?.[group] || []).map(s =>
      `<div class="pc-row"><span class="pc-key">${s.label}</span><span class="pc-val">${v(s.key, s.pct)} ${r(s.key)}</span></div>`
    ).join('');

    return `
      <div class="pc-team-col">
        <div class="pc-team-label" style="color:${color}">${label}</div>
        <div class="pc-section-title">Pace &amp; Scoring</div>
        <div class="pc-rows">${rows('paceAndScoring')}</div>
        <div class="pc-section-title">Scoring Methods</div>
        <div class="pc-rows">${rows('scoringMethods')}</div>
        <div class="pc-section-title">Defense</div>
        <div class="pc-rows">${rows('defense')}</div>
      </div>`;
  };

  const injStatusColor = (s) =>
    /^active$/i.test(s)      ? 'var(--green)'  :
    /out/i.test(s)           ? 'var(--red)'    :
    /doubtful/i.test(s)      ? 'var(--orange)' :
    /questionable/i.test(s)  ? 'var(--yellow)' : 'var(--text3)';

  const injBlock = (injs, label, color) => {
    if (!injs?.length) return '<div class="pc-inj-none"><span class="pc-inj-label" style="color:' + color + '">' + label + '</span><span style="color:var(--text3);font-size:12px">No injuries reported</span></div>';
    const rows = injs.map(i => {
      const img = i.headshotUrl
        ? '<img class="pc-inj-headshot" src="' + i.headshotUrl + '" alt="' + i.name + '" onerror="this.style.display=\'none\'">'
        : '<div class="pc-inj-headshot pc-inj-headshot-empty"></div>';
      const sc = injStatusColor(i.status);
      const posTag = i.pos ? '<span class="pc-inj-pos">' + i.pos + '</span>' : '';

      // Expandable detail section (hidden by default)
      const descTag = i.desc && i.desc !== '—' ? '<div class="pc-inj-detail-row"><span class="pc-inj-detail-label">Injury</span><span class="pc-inj-detail-val">' + i.desc + '</span></div>' : '';
      const dateTag = i.reportDate ? '<div class="pc-inj-detail-row"><span class="pc-inj-detail-label">Reported</span><span class="pc-inj-detail-val">' + i.reportDate + '</span></div>' : '';
      const shortTag = i.shortComment ? '<div class="pc-inj-detail-row"><span class="pc-inj-detail-label">Update</span><span class="pc-inj-detail-val">' + i.shortComment + '</span></div>' : '';
      const returnTag = i.estReturn ? '<div class="pc-inj-detail-row"><span class="pc-inj-detail-label">Outlook</span><span class="pc-inj-detail-val pc-inj-return">' + i.estReturn + '</span></div>' : '';
      const hasDetail = descTag || dateTag || shortTag || returnTag;

      return '<div class="pc-inj-player' + (hasDetail ? ' pc-inj-clickable' : '') + '"' + (hasDetail ? ' onclick="this.classList.toggle(\'pc-inj-expanded\')"' : '') + '>'
        + '<div class="pc-inj-summary">'
        + img
        + '<div class="pc-inj-name-wrap"><span class="pc-inj-name">' + i.name + posTag + '</span></div>'
        + '<span class="pc-inj-badge" style="color:' + sc + ';border-color:' + sc + '">' + i.status + '</span>'
        + (hasDetail ? '<span class="pc-inj-chevron">›</span>' : '')
        + '</div>'
        + (hasDetail ? '<div class="pc-inj-detail">' + descTag + dateTag + shortTag + returnTag + '</div>' : '')
        + '</div>';
    }).join('');
    return '<div class="pc-inj-team"><span class="pc-inj-label" style="color:' + color + '">' + label + '</span>' + rows + '</div>';
  };

  try {
    el.innerHTML = `
      <!-- GAME CONTEXT STRIP -->
      <div class="pc-context-strip">
        ${gameInfo.overUnder ? `<div class="pc-ctx-pill"><span class="pc-ctx-label">Over/Under</span><span class="pc-ctx-val">${gameInfo.overUnder}</span></div>` : ''}
        ${gameInfo.spread    ? `<div class="pc-ctx-pill"><span class="pc-ctx-label">Spread</span><span class="pc-ctx-val">${gameInfo.spread}</span></div>` : ''}
        <div class="pc-ctx-pill"><span class="pc-ctx-label">Venue</span><span class="pc-ctx-val">${gameInfo.venue || '—'}</span></div>
        ${awayB2B ? `<div class="pc-ctx-pill pc-b2b"><span class="pc-ctx-label">Back-to-Back</span><span class="pc-ctx-val">${gameInfo.awayAbbr}</span></div>` : ''}
        ${homeB2B ? `<div class="pc-ctx-pill pc-b2b"><span class="pc-ctx-label">Back-to-Back</span><span class="pc-ctx-val">${gameInfo.homeAbbr}</span></div>` : ''}
      </div>

      <!-- INJURY REPORT IMPACT -->
      <div class="pc-card">
        <div class="pc-card-title">Injury Report Impact</div>
        <div class="pc-inj-grid">
          ${injBlock(awayInj, gameInfo.awayAbbr, 'var(--blue)')}
          ${injBlock(homeInj, gameInfo.homeAbbr, 'var(--orange)')}
        </div>
      </div>

      <!-- TEAM STATS COMPARISON -->
      <div class="pc-card">
        <div class="pc-card-title">Team Stats &amp; Rankings — Pace · Scoring Methods · Defense</div>
        <div class="pc-teams-grid">
          ${statBlock(awayStats, gameInfo.awayAbbr, 'var(--blue)')}
          ${statBlock(homeStats, gameInfo.homeAbbr, 'var(--orange)')}
        </div>
      </div>`;
  } catch (e) {
    console.error('renderProps render failed:', e);
    el.innerHTML = `<div style="color:var(--red);padding:20px;font-family:var(--font-m);font-size:12px">Props Scout error: ${e.message}</div>`;
  }
}



/* ── LINEUPS (NBA ONLY) ────────────────────────────────── */
function renderLineups({ gameInfo, awayLineup, homeLineup, injuries, lineupStatsType }) {
  const el = document.getElementById('lineupsContent');
  if (!el) return;

  if (!awayLineup?.length && !homeLineup?.length) {
    el.innerHTML = `<div class="lu-empty">Lineup data not available for this game.</div>`;
    return;
  }

  const posOrder = ['PG', 'SG', 'SF', 'PF', 'C'];

  // Stat categories for matchup comparison
  const matchupStats = [
    { key: 'avgPoints',      label: 'PTS',  higher: true },
    { key: 'avgRebounds',    label: 'REB',  higher: true },
    { key: 'avgAssists',     label: 'AST',  higher: true },
    { key: 'fieldGoalPct',   label: 'FG%',  higher: true, pct: true },
    { key: 'avgSteals',      label: 'STL',  higher: true },
    { key: 'avgBlocks',      label: 'BLK',  higher: true },
    { key: 'avgMinutes',     label: 'MIN',  higher: true },
    { key: 'avgTurnovers',   label: 'TO',   higher: false }, // lower is better
  ];

  // Check if a player is injured
  const injStatus = (name) => {
    const allInj = [...(injuries?.away || []), ...(injuries?.home || [])];
    const match = allInj.find(i => i.name === name);
    if (!match || /^active$/i.test(match.status)) return null;
    return match.status;
  };
  const injColor = (s) => {
    if (!s) return '';
    if (/out/i.test(s)) return 'var(--red)';
    if (/doubtful/i.test(s)) return 'var(--orange)';
    return 'var(--yellow)';
  };

  // Compute edge: returns 'away', 'home', or 'even'
  const getEdge = (aVal, hVal, higherBetter) => {
    if (aVal == null || hVal == null) return 'even';
    const diff = Math.abs(aVal - hVal);
    const threshold = Math.max(aVal, hVal) * 0.05; // 5% margin
    if (diff < threshold) return 'even';
    if (higherBetter) return aVal > hVal ? 'away' : 'home';
    return aVal < hVal ? 'away' : 'home'; // lower is better (e.g. TO)
  };

  // Build stat comparison bar for a single stat
  const statBar = (aStat, hStat, cfg) => {
    const aVal = aStat?.stats?.[cfg.key];
    const hVal = hStat?.stats?.[cfg.key];
    if (aVal == null && hVal == null) return '';
    const aStr = aVal != null ? (cfg.pct ? aVal.toFixed(1) + '%' : aVal.toFixed(1)) : '—';
    const hStr = hVal != null ? (cfg.pct ? hVal.toFixed(1) + '%' : hVal.toFixed(1)) : '—';
    const edge = getEdge(aVal, hVal, cfg.higher);
    const aColor = edge === 'away' ? 'var(--green)' : edge === 'home' ? 'var(--red)' : 'var(--text2)';
    const hColor = edge === 'home' ? 'var(--green)' : edge === 'away' ? 'var(--red)' : 'var(--text2)';
    return `
      <div class="lu-stat-row">
        <span class="lu-stat-val" style="color:${aColor}">${aStr}</span>
        <span class="lu-stat-label">${cfg.label}</span>
        <span class="lu-stat-val" style="color:${hColor}">${hStr}</span>
      </div>`;
  };

  // Compute overall edge score for a matchup
  const overallEdge = (away, home) => {
    if (!away?.stats || !home?.stats) return { label: '—', color: 'var(--text3)', awayWins: 0, homeWins: 0 };
    let awayWins = 0, homeWins = 0;
    matchupStats.forEach(cfg => {
      const edge = getEdge(away.stats[cfg.key], home.stats[cfg.key], cfg.higher);
      if (edge === 'away') awayWins++;
      if (edge === 'home') homeWins++;
    });
    return { awayWins, homeWins };
  };

  // Build position-by-position matchup rows
  const matchupRows = posOrder.map(pos => {
    const away = awayLineup.find(p => p.pos === pos);
    const home = homeLineup.find(p => p.pos === pos);
    const hasStats = away?.stats || home?.stats;
    const edge = overallEdge(away, home);

    const playerSide = (p, color, align) => {
      if (!p) return `<div class="lu-player-side"><div class="lu-player-empty">—</div></div>`;
      const inj = injStatus(p.name);
      const injBadge = inj ? `<span class="lu-inj-badge" style="color:${injColor(inj)};border-color:${injColor(inj)}">${inj}</span>` : '';
      const gpLabel = lineupStatsType === 'h2h' ? 'H2H' : 'GP';
      const gp = p.stats?._gp ? `<span class="lu-gp">${p.stats._gp} ${gpLabel}</span>` : '';
      return `
        <div class="lu-player-side ${align}">
          <div class="lu-hs-wrap" style="border-color:${color}">
            <img class="lu-hs" src="${p.headshotUrl}" alt="${p.name}" onerror="this.style.display='none'">
          </div>
          <div class="lu-player-info">
            <span class="lu-p-name">${p.name}</span>
            <span class="lu-p-meta">#${p.jersey} ${gp}${injBadge}</span>
          </div>
        </div>`;
    };

    // Edge indicator
    const edgeIndicator = hasStats ? (() => {
      const total = edge.awayWins + edge.homeWins;
      if (!total) return '<div class="lu-edge-badge lu-edge-even">EVEN</div>';
      if (edge.awayWins > edge.homeWins) return `<div class="lu-edge-badge lu-edge-away">${gameInfo.awayAbbr} +${edge.awayWins - edge.homeWins}</div>`;
      if (edge.homeWins > edge.awayWins) return `<div class="lu-edge-badge lu-edge-home">${gameInfo.homeAbbr} +${edge.homeWins - edge.awayWins}</div>`;
      return '<div class="lu-edge-badge lu-edge-even">EVEN</div>';
    })() : '';

    // Stat comparison bars
    const statBars = hasStats ? matchupStats.map(cfg => statBar(away, home, cfg)).join('') : '';

    return `
      <div class="lu-matchup-row${hasStats ? ' lu-matchup-clickable' : ''}"${hasStats ? ' onclick="this.classList.toggle(\'lu-matchup-expanded\')"' : ''}>
        <div class="lu-matchup-header">
          ${playerSide(away, 'var(--blue)', 'lu-align-left')}
          <div class="lu-pos-col">
            <div class="lu-pos-badge">${pos}</div>
            ${edgeIndicator}
          </div>
          ${playerSide(home, 'var(--lime)', 'lu-align-right')}
          ${hasStats ? '<span class="lu-expand-chevron">›</span>' : ''}
        </div>
        ${hasStats ? `<div class="lu-matchup-stats">${statBars}</div>` : ''}
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="lu-header">
      <div class="lu-title">Starting Lineups</div>
      <div class="lu-subtitle">Projected starters · ESPN depth charts · ${lineupStatsType === 'h2h' ? 'Head-to-head averages' : 'Season averages'}</div>
    </div>

    <!-- Team headers -->
    <div class="lu-teams-header">
      <div class="lu-th-side">
        ${gameInfo.awayLogo ? `<img class="lu-th-logo" src="${gameInfo.awayLogo}" alt="${gameInfo.awayAbbr}" onerror="this.style.display='none'">` : ''}
        <span class="lu-th-name" style="color:var(--blue)">${gameInfo.awayAbbr}</span>
      </div>
      <div class="lu-th-vs">VS</div>
      <div class="lu-th-side lu-th-right">
        <span class="lu-th-name" style="color:var(--lime)">${gameInfo.homeAbbr}</span>
        ${gameInfo.homeLogo ? `<img class="lu-th-logo" src="${gameInfo.homeLogo}" alt="${gameInfo.homeAbbr}" onerror="this.style.display='none'">` : ''}
      </div>
    </div>

    <!-- Matchups -->
    <div class="lu-matchups">
      ${matchupRows}
    </div>`;
}

/* ═══════════════════════════════════════════════════════════
   10. AI PLAYS — Claude API (ALL SPORTS)
   Sends game context to Claude Haiku for betting analysis.
   Sport-agnostic — uses whatever data is in S.gameData.
═══════════════════════════════════════════════════════════ */
function buildGameContext(data) {
  const { gameInfo, injuries, awayForm, homeForm, h2h } = data;

  const formStr = (form) => form.map(g => `${g.result} ${g.myScore}-${g.oppScore} vs ${g.opponent}`).join(', ') || 'N/A';
  const injStr = (list) => list.length ? list.map(i => `${i.name} (${i.status})`).join(', ') : 'None';

  return `GAME: ${gameInfo.awayFull} (${gameInfo.awayAbbr}) @ ${gameInfo.homeFull} (${gameInfo.homeAbbr})
SPORT: ${gameInfo.sportLabel}
DATE: ${new Date(gameInfo.date).toLocaleDateString()}
VENUE: ${gameInfo.venue || 'TBD'}
STATUS: ${gameInfo.statusText}

ODDS:
- Spread: ${gameInfo.spread || 'N/A'}
- Over/Under: ${gameInfo.overUnder || 'N/A'}
- ${gameInfo.awayAbbr} Moneyline: ${gameInfo.awayMoneyline || 'N/A'}
- ${gameInfo.homeAbbr} Moneyline: ${gameInfo.homeMoneyline || 'N/A'}

LAST 5 GAMES — ${gameInfo.awayAbbr}: ${formStr(awayForm)}
LAST 5 GAMES — ${gameInfo.homeAbbr}: ${formStr(homeForm)}

HEAD-TO-HEAD (this season): ${h2h.length ? h2h.map(g => `${g.awayTeam} ${g.awayScore}-${g.homeScore} ${g.homeTeam}`).join(' | ') : 'No data'}

INJURIES — ${gameInfo.awayAbbr}: ${injStr(injuries.away)}
INJURIES — ${gameInfo.homeAbbr}: ${injStr(injuries.home)}`;
}

async function generateAIPlays(data) {
  const playsEl = document.getElementById('aiPlaysList');
  playsEl.innerHTML = `<div class="inline-loader"><div class="mini-spin"></div>Claude is analyzing all data and generating plays...</div>`;

  if (!S.apiKey) {
    playsEl.innerHTML = `<p class="empty-msg">Add your Claude API key in the top bar to generate AI plays.</p>`;
    return;
  }

  const context = buildGameContext(data);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': S.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1200,
        messages: [{
          role: 'user',
          content: `You are a sharp sports betting analyst. Based on the game data below, generate specific betting plays across all categories.

${context}

Respond ONLY in this exact JSON format (no markdown fences, no extra text):
{
  "plays": [
    {
      "type": "spread",
      "call": "Lakers -4.5",
      "confidence": 74,
      "odds": "-110",
      "reasoning": "2-3 sentence sharp analysis",
      "key_factor": "single most important factor"
    },
    {
      "type": "total",
      "call": "Over 224.5",
      "confidence": 68,
      "odds": "-110",
      "reasoning": "2-3 sentence analysis",
      "key_factor": "single most important factor"
    },
    {
      "type": "prop",
      "call": "Player Name Over X.X stat",
      "confidence": 71,
      "odds": "-115",
      "reasoning": "2-3 sentence analysis",
      "key_factor": "single most important factor"
    },
    {
      "type": "prop",
      "call": "Another player prop",
      "confidence": 65,
      "odds": "-110",
      "reasoning": "2-3 sentence analysis",
      "key_factor": "single most important factor"
    },
    {
      "type": "parlay",
      "call": "2-leg parlay: Leg 1 + Leg 2",
      "confidence": 55,
      "odds": "+260",
      "reasoning": "Why these two legs correlate well",
      "key_factor": "correlation rationale"
    }
  ]
}`
        }]
      })
    });

    const d = await res.json();
    const text = d.content?.[0]?.text || '';
    let result;
    try {
      result = JSON.parse(text.replace(/```json|```/g,'').trim());
    } catch {
      playsEl.innerHTML = `<p class="empty-msg">Could not parse AI response. Try again.</p>`;
      return;
    }

    renderAIPlays(result.plays || []);
  } catch (err) {
    playsEl.innerHTML = `<p class="empty-msg">Error: ${err.message}</p>`;
  }
}

function renderAIPlays(plays) {
  const el = document.getElementById('aiPlaysList');
  if (!plays.length) { el.innerHTML = `<p class="empty-msg">No plays generated.</p>`; return; }

  el.innerHTML = plays.map(p => {
    const conf = Math.min(Math.max(p.confidence || 60, 0), 100);
    const confClass = conf >= 70 ? 'high' : conf >= 58 ? 'mid' : 'low';
    const typeLabel = { spread: 'Spread', total: 'Total', prop: 'Player Prop', parlay: 'Parlay' }[p.type] || p.type;

    return `
      <div class="ai-play-card ${p.type}">
        <div class="play-top">
          <div>
            <div class="play-type-tag">${typeLabel}</div>
            <div class="play-call">${p.call}</div>
          </div>
          <div class="play-confidence">
            <span class="conf-num ${confClass}">${conf}%</span>
            <span class="conf-label">confidence</span>
          </div>
        </div>
        <div class="play-reasoning">${p.reasoning}</div>
        <div class="play-odds-note">Key factor: ${p.key_factor} · Odds: ${p.odds || 'N/A'}</div>
      </div>`;
  }).join('');
}

/* ── DISCUSS USER'S PLAY (ALL SPORTS) ──────────────────── */
async function discussUserPlay() {
  const play = document.getElementById('userPlay').value.trim();
  if (!play) return;
  if (!S.apiKey) { alert('Add Claude API key first.'); return; }
  if (!S.gameData) { alert('Load a game first.'); return; }

  const result = document.getElementById('userPlayResult');
  result.classList.remove('hidden');
  result.innerHTML = `<div class="inline-loader"><div class="mini-spin"></div>Claude is evaluating your play...</div>`;

  const context = buildGameContext(S.gameData);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': S.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 900,
        messages: [{
          role: 'user',
          content: `You are a sharp sports betting analyst. A bettor is proposing a specific play. Analyze it critically using the game data.

GAME DATA:
${context}

BETTOR'S PROPOSED PLAY: "${play}"

Respond ONLY in this JSON (no markdown):
{
  "confidence": 67,
  "verdict": "strong" | "lean" | "against",
  "summary": "One sentence verdict on this play",
  "for": [
    "Argument supporting this play",
    "Another argument for it"
  ],
  "against": [
    "Argument against or risk",
    "Another risk or counter"
  ]
}`
        }]
      })
    });

    const d = await res.json();
    const text = d.content?.[0]?.text || '';
    let r;
    try { r = JSON.parse(text.replace(/```json|```/g,'').trim()); }
    catch { result.innerHTML = `<p class="empty-msg">Could not parse response. Try again.</p>`; return; }

    const conf = Math.min(Math.max(r.confidence || 60, 0), 100);
    const confColor = conf >= 70 ? 'var(--green)' : conf >= 55 ? 'var(--yellow)' : 'var(--red)';
    const verdictClass = { strong: 'verdict-strong', lean: 'verdict-lean', against: 'verdict-against' }[r.verdict] || 'verdict-lean';
    const verdictLabel = { strong: '✓ Strong Play', lean: '~ Lean', against: '✗ Fade' }[r.verdict] || r.verdict;

    const forArgs = (r.for || []).map(a => `<div class="arg-row arg-for"><span class="arg-icon">+</span><span>${a}</span></div>`).join('');
    const againstArgs = (r.against || []).map(a => `<div class="arg-row arg-against"><span class="arg-icon">−</span><span>${a}</span></div>`).join('');

    result.innerHTML = `
      <div class="upr-top">
        <div>
          <div style="font-size:10px;letter-spacing:.1em;color:var(--text3);margin-bottom:4px">YOUR PLAY</div>
          <div class="upr-play-name">${play}</div>
        </div>
        <div class="upr-confidence">
          <span class="upr-conf-score" style="color:${confColor}">${conf}%</span>
          <span class="upr-conf-label">confidence</span>
        </div>
        <span class="upr-verdict ${verdictClass}">${verdictLabel}</span>
      </div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:14px;font-family:var(--font-s)">${r.summary}</div>
      <div class="upr-arguments">
        ${forArgs}
        ${againstArgs}
      </div>`;
  } catch (err) {
    result.innerHTML = `<p class="empty-msg">Error: ${err.message}</p>`;
  }
}

/* ═══════════════════════════════════════════════════════════
   11. UTILITIES
═══════════════════════════════════════════════════════════ */
/* ── TAB SWITCH ─────────────────────────────────────────── */
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
  document.querySelector(`[data-tab="${tab}"]`)?.classList.add('active');
  document.getElementById(`tab-${tab}`)?.classList.remove('hidden');
}

/* ── CHART DEFAULTS ─────────────────────────────────────── */
function chartOpts() {
  return {
    responsive: true,
    plugins: {
      legend: {
        labels: { color: '#7878a0', font: { family: 'IBM Plex Mono', size: 10 }, boxWidth: 10 }
      },
      tooltip: {
        backgroundColor: '#16161b',
        borderColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        titleColor: '#dddde8',
        bodyColor: '#7878a0',
        titleFont: { family: 'Bebas Neue', size: 14 },
        bodyFont: { family: 'IBM Plex Mono', size: 11 },
      }
    },
    scales: {
      x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#44445a', font: { family: 'IBM Plex Mono', size: 10 } } },
      y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#44445a', font: { family: 'IBM Plex Mono', size: 10 } } },
    }
  };
}
