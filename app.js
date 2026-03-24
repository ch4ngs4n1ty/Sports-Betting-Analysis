/* ═══════════════════════════════════════════════════════════
   PLAYIQ — app.js
   Deep Game Analysis Engine
═══════════════════════════════════════════════════════════ */
/* global Chart */

/* ── STATE ──────────────────────────────────────────────── */
const S = {
  apiKey: localStorage.getItem('piq_key') || '',
  gameData: null,   // full fetched game context
  allGames: [],     // flat list of gameInfo objects from dashboard
  charts: {},       // chart instances
};

/* ── ESPN SPORT MAP ─────────────────────────────────────── */
const SPORTS = [
  { key: 'nba', sport: 'basketball', league: 'nba',    label: 'NBA' },
  { key: 'nfl', sport: 'football',   league: 'nfl',    label: 'NFL' },
  { key: 'mlb', sport: 'baseball',   league: 'mlb',    label: 'MLB' },
  { key: 'nhl', sport: 'hockey',     league: 'nhl',    label: 'NHL' },
  { key: 'ncaamb', sport: 'basketball', league: 'mens-college-basketball', label: 'NCAAB' },
  { key: 'ncaafb', sport: 'football',   league: 'college-football',        label: 'NCAAF' },
];

/* ── INIT ───────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  if (S.apiKey) document.getElementById('apiKey').value = S.apiKey;
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
  dateEl.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const content = document.getElementById('dashboardContent');
  content.innerHTML = `<div class="dashboard-loading"><div class="loader-spinner"></div><span>Loading today's games...</span></div>`;

  S.allGames = [];

  const results = await Promise.all(
    SPORTS.map(sp =>
      espn(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/scoreboard`)
        .then(data => ({ sp, events: data?.events || [] }))
    )
  );

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
          <span class="card-abbr ${awayLeading ? 'leading' : ''}">${g.awayAbbr}</span>
          <span class="card-name">${g.awayFull}</span>
        </div>
        ${showScore ? `<div class="card-scores">
          <span class="${awayLeading ? 'score-lead' : 'score-val'}">${awayScore}</span>
          <span class="score-dash">—</span>
          <span class="${homeLeading ? 'score-lead' : 'score-val'}">${homeScore}</span>
        </div>` : `<div class="card-vs">VS</div>`}
        <div class="card-team right">
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
    document.getElementById('gameTitle').textContent = `${gameInfo.awayAbbr} vs ${gameInfo.homeAbbr}`;
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
    const h2h = await fetchH2H(gameInfo);

    // Step 5 — Rosters
    setStep(4);
    const [awayRoster, homeRoster] = await Promise.all([
      fetchRoster(gameInfo.sportKey, gameInfo.awayTeamId),
      fetchRoster(gameInfo.sportKey, gameInfo.homeTeamId),
    ]);

    S.gameData = { gameInfo, injuries, awayForm, homeForm, h2h, awayRoster, homeRoster };

    renderOverview(S.gameData);
    renderRoster(S.gameData);
    renderForm(S.gameData);
    renderH2H(S.gameData);
    renderInjuries(S.gameData);

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

/* ── PARSE INPUT ────────────────────────────────────────── */
function parseGameInput(raw) {
  const sep = /\s+(?:vs\.?|@|versus|-)\s+/i;
  const parts = raw.split(sep);
  if (parts.length >= 2) {
    return { away: parts[0].trim(), home: parts[1].trim() };
  }
  const words = raw.trim().split(/\s+/);
  const mid = Math.floor(words.length / 2);
  return { away: words.slice(0, mid).join(' '), home: words.slice(mid).join(' ') };
}

/* ── ESPN FETCH HELPER ──────────────────────────────────── */
async function espn(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/* ── FIND GAME ──────────────────────────────────────────── */
async function findGame(parsed) {
  const awayQ = parsed.away.toLowerCase();
  const homeQ = parsed.home.toLowerCase();

  for (const sp of SPORTS) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/scoreboard`;
    const data = await espn(url);
    if (!data?.events) continue;

    for (const ev of data.events) {
      const comp = ev.competitions?.[0];
      if (!comp) continue;
      const home = comp.competitors?.find(c => c.homeAway === 'home');
      const away = comp.competitors?.find(c => c.homeAway === 'away');
      if (!home || !away) continue;

      const homeName = (home.team.displayName + ' ' + home.team.abbreviation + ' ' + home.team.shortDisplayName).toLowerCase();
      const awayName = (away.team.displayName + ' ' + away.team.abbreviation + ' ' + away.team.shortDisplayName).toLowerCase();

      const awayMatch = awayName.includes(awayQ) || awayQ.includes(away.team.abbreviation.toLowerCase()) || awayQ.split(' ').some(w => w.length > 3 && awayName.includes(w));
      const homeMatch = homeName.includes(homeQ) || homeQ.includes(home.team.abbreviation.toLowerCase()) || homeQ.split(' ').some(w => w.length > 3 && homeName.includes(w));

      if (awayMatch && homeMatch) {
        const odds = comp.odds?.[0];
        return {
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
          date: ev.date,
          venue: comp.venue?.fullName,
          spread: odds?.details,
          overUnder: odds?.overUnder,
          awayMoneyline: odds?.awayTeamOdds?.moneyLine,
          homeMoneyline: odds?.homeTeamOdds?.moneyLine,
        };
      }
    }
  }
  return null;
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
function getSeasonYear(sportKey) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  // NFL and NCAAF use the year the season *started* (fall)
  // Before August, the most recent season started last year
  if (sportKey === 'nfl' || sportKey === 'ncaafb') {
    return month < 8 ? year - 1 : year;
  }
  // NBA, NHL, NCAAB, MLB use current calendar year
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

    const teamPlayers = summary.boxscore?.players?.find(p => p.team?.id === teamId);
    if (!teamPlayers) return { ...g, player: null };

    const statsGroup = teamPlayers.statistics?.[0];
    if (!statsGroup) return { ...g, player: null };

    const labels = statsGroup.labels || [];
    const ptsIdx = labels.indexOf('PTS');
    const rebIdx = labels.indexOf('REB');
    const astIdx = labels.indexOf('AST');
    if (ptsIdx === -1) return { ...g, player: null };

    let topPlayer = null;
    let maxPts = -1;
    for (const athlete of statsGroup.athletes || []) {
      const pts = parseInt(athlete.stats?.[ptsIdx] || 0);
      if (pts > maxPts) {
        maxPts = pts;
        topPlayer = {
          name: athlete.athlete?.shortName || athlete.athlete?.displayName || '?',
          pts: parseInt(athlete.stats?.[ptsIdx] || 0),
          reb: rebIdx > -1 ? parseInt(athlete.stats?.[rebIdx] || 0) : 0,
          ast: astIdx > -1 ? parseInt(athlete.stats?.[astIdx] || 0) : 0,
        };
      }
    }
    return { ...g, player: topPlayer };
  });
}

/* ── INJURIES ───────────────────────────────────────────── */
async function fetchInjuries(gameInfo) {
  const sp = SPORTS.find(s => s.key === gameInfo.sportKey);
  if (!sp) return { away: [], home: [] };

  const data = await espn(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/injuries`);
  if (!data?.injuries) return { away: [], home: [] };

  const filter = (teamId) => {
    const teamInj = data.injuries.find(t => t.team?.id === teamId);
    return (teamInj?.injuries || []).map(i => ({
      name: i.athlete?.displayName || '—',
      status: i.status || 'Unknown',
      desc: i.injury?.description || i.shortComment || '—',
    }));
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

  return h2h.map((ev, i) => {
    const comp = ev.competitions[0];
    const awayC = comp.competitors.find(c => c.homeAway === 'away');
    const homeC = comp.competitors.find(c => c.homeAway === 'home');
    const parseScore = (s) => parseInt(s?.displayValue ?? s ?? 0) || 0;
    const awayScore = parseScore(awayC?.score);
    const homeScore = parseScore(homeC?.score);
    const winner = awayC?.winner === true ? 'away' : homeC?.winner === true ? 'home' : awayScore > homeScore ? 'away' : 'home';

    // Extract top performer per team from summary leaders
    const leaders = summaries[i]?.leaders || [];
    const getTopPerformer = (teamAbbr) => {
      const teamLeaders = leaders.find(l => l.team?.abbreviation === teamAbbr);
      if (!teamLeaders) return null;
      const pts = teamLeaders.leaders?.find(cat => cat.name === 'points');
      const top = pts?.leaders?.[0];
      if (!top) return null;
      return {
        name: top.athlete?.shortName || top.athlete?.displayName || '?',
        pts: top.displayValue,
        ast: teamLeaders.leaders?.find(c => c.name === 'assists')?.leaders?.[0]?.displayValue || '?',
        reb: teamLeaders.leaders?.find(c => c.name === 'rebounds')?.leaders?.[0]?.displayValue || '?',
      };
    };

    return {
      eventId: ev.id,
      date: new Date(ev.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      awayTeam: awayC?.team?.abbreviation || '?',
      homeTeam: homeC?.team?.abbreviation || '?',
      awayScore, homeScore, winner,
      awayLeader: getTopPerformer(awayC?.team?.abbreviation),
      homeLeader: getTopPerformer(homeC?.team?.abbreviation),
    };
  });
}

/* ── ROSTER ─────────────────────────────────────────────── */
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
        players.push({
          name: p.displayName || p.fullName,
          pos: p.position?.abbreviation || '—',
          jersey: p.jersey || '—',
          status: p.injuries?.[0]?.status || null,
        });
      }
    });
  });
  return players.slice(0, 20);
}

/* ═══════════════════════════════════════════════════════════
   RENDER FUNCTIONS
═══════════════════════════════════════════════════════════ */

/* ── OVERVIEW ───────────────────────────────────────────── */
function renderOverview({ gameInfo, awayForm, homeForm }) {
  const awayW = awayForm.filter(g => g.result === 'W').length;
  const homeW = homeForm.filter(g => g.result === 'W').length;
  const awayStreak = getStreak(awayForm);
  const homeStreak = getStreak(homeForm);

  const teamCol = (team, abbr, form, wins, streak, side) => `
    <div class="team-col">
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

  document.getElementById('teamColAway').innerHTML = teamCol(gameInfo.awayFull, gameInfo.awayAbbr, awayForm, awayW, awayStreak, 'away');
  document.getElementById('teamColHome').innerHTML = teamCol(gameInfo.homeFull, gameInfo.homeAbbr, homeForm, homeW, homeStreak, 'home');

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
  const table = (roster) => `
    <table class="roster-table">
      <thead><tr><th>#</th><th>Player</th><th>Pos</th><th>Status</th></tr></thead>
      <tbody>${roster.map(p => `
        <tr>
          <td style="color:var(--text3)">${p.jersey}</td>
          <td>${p.name}</td>
          <td><span class="player-pos">${p.pos}</span></td>
          <td style="color:${p.status ? 'var(--red)' : 'var(--text3)'}">${p.status || '—'}</td>
        </tr>`).join('')}
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
  const hasPlayerData = (form) => form.some(g => g.player);

  const formBlock = (teamName, form, chartId) => `
    <div class="form-team-block">
      <h3>${teamName}</h3>
      ${hasPlayerData(form) ? `
      <div class="form-chart-section">
        <div class="form-chart-controls">
          <span class="form-chart-label">Player of the Game</span>
          <div class="stat-toggle">
            <button class="stat-btn active" onclick="switchFormStat('${chartId}', 'pts', this)">PTS</button>
            <button class="stat-btn" onclick="switchFormStat('${chartId}', 'reb', this)">REB</button>
            <button class="stat-btn" onclick="switchFormStat('${chartId}', 'ast', this)">AST</button>
          </div>
        </div>
        <canvas id="${chartId}" height="150"></canvas>
      </div>` : ''}
      <div class="form-games-list">
        ${form.length === 0 ? '<p class="empty-msg">No recent games found</p>' :
          form.map(g => `
            <div class="form-game">
              <div class="form-result ${g.result}">${g.result}</div>
              <div class="form-details">
                <div class="form-matchup">${g.home ? 'vs' : '@'} ${g.opponent}</div>
                <div class="form-score">${g.myScore} – ${g.oppScore}${g.player ? ` · <span style="color:var(--lime);opacity:0.8">${g.player.name} ${g.player.pts}pts</span>` : ''}</div>
              </div>
              <span class="form-date">${g.date}</span>
            </div>`).join('')}
      </div>
    </div>`;

  document.getElementById('formGrid').innerHTML =
    formBlock(gameInfo.awayFull, awayForm, 'formChartAway') +
    formBlock(gameInfo.homeFull, homeForm, 'formChartHome');

  setTimeout(() => {
    if (hasPlayerData(awayForm)) renderFormChart('formChartAway', awayForm, 'pts');
    if (hasPlayerData(homeForm)) renderFormChart('formChartHome', homeForm, 'pts');
  }, 50);
}

function renderFormChart(chartId, games, stat) {
  const ctx = document.getElementById(chartId);
  if (!ctx) return;
  if (S.charts[chartId]) S.charts[chartId].destroy();

  const labels = games.map(g => `${g.home ? 'vs' : '@'}${g.opponent}`);
  const values = games.map(g => g.player?.[stat] ?? 0);
  const colors = games.map(g =>
    g.result === 'W' ? 'rgba(35,209,139,0.82)' : 'rgba(255,61,90,0.82)'
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
              const g = games[items[0].dataIndex];
              return `${g.home ? 'vs' : '@'}${g.opponent} — ${g.result} (${g.myScore}-${g.oppScore})`;
            },
            label: (item) => {
              const g = games[item.dataIndex];
              if (!g.player) return `${item.raw} ${stat.toUpperCase()}`;
              return `${g.player.name}: ${g.player.pts} PTS · ${g.player.reb} REB · ${g.player.ast} AST`;
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

  const awayWins = h2h.filter(g => g.winner === 'away' && g.awayTeam === gameInfo.awayAbbr).length;
  const homeWins = h2h.length - awayWins;

  const leaderBlock = (leader) => {
    if (!leader) return '';
    return `
      <div class="h2h-leader">
        <span class="h2h-leader-name">${leader.name}</span>
        <span class="h2h-leader-stats">${leader.pts} PTS · ${leader.reb} REB · ${leader.ast} AST</span>
      </div>`;
  };

  document.getElementById('h2hContent').innerHTML = `
    <div class="h2h-summary">
      <div class="h2h-stat-card">
        <span class="h2h-val" style="color:var(--blue)">${awayWins}</span>
        <span class="h2h-label">${gameInfo.awayAbbr} Wins</span>
      </div>
      <div class="h2h-stat-card">
        <span class="h2h-val" style="color:var(--lime)">${homeWins}</span>
        <span class="h2h-label">${gameInfo.homeAbbr} Wins</span>
      </div>
      <div class="h2h-stat-card">
        <span class="h2h-val" style="color:var(--text2)">${h2h.length}</span>
        <span class="h2h-label">Last ${h2h.length} Games</span>
      </div>
    </div>
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
          <div class="h2h-leaders-row">
            <div class="h2h-leader-col">
              <span class="h2h-leader-tag" style="color:var(--blue)">${g.awayTeam}</span>
              ${leaderBlock(g.awayLeader, g.awayTeam)}
            </div>
            <div class="h2h-leader-col">
              <span class="h2h-leader-tag" style="color:var(--lime)">${g.homeTeam}</span>
              ${leaderBlock(g.homeLeader, g.homeTeam)}
            </div>
          </div>` : ''}
        </div>`).join('')}
    </div>`;
}

/* ── INJURIES ───────────────────────────────────────────── */
function renderInjuries({ gameInfo, injuries }) {
  const statusClass = (s) => ({
    'out': 'inj-out', 'doubtful': 'inj-doubtful',
    'questionable': 'inj-questionable', 'probable': 'inj-probable',
  })[s.toLowerCase()] || 'inj-questionable';

  const block = (teamName, list) => `
    <div class="injury-team-block">
      <h3>${teamName}</h3>
      ${list.length === 0 ? '<p class="empty-msg">No injuries reported</p>' :
        list.map(i => `
          <div class="injury-row">
            <span class="inj-status ${statusClass(i.status)}">${i.status}</span>
            <span class="inj-name">${i.name}</span>
            <span class="inj-desc">${i.desc}</span>
          </div>`).join('')}
    </div>`;

  document.getElementById('injuriesContent').innerHTML = `
    <div class="injuries-grid">
      ${block(gameInfo.awayFull, injuries.away)}
      ${block(gameInfo.homeFull, injuries.home)}
    </div>`;
}

/* ═══════════════════════════════════════════════════════════
   AI PLAYS — Claude Analysis
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

/* ═══════════════════════════════════════════════════════════
   DISCUSS USER'S PLAY
═══════════════════════════════════════════════════════════ */
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
