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

/* ── TEAM LOGO URL ──────────────────────────────────────── */
function teamLogoUrl(league, abbr, teamId) {
  const proLeagues = ['nba', 'nfl', 'mlb', 'nhl'];
  if (proLeagues.includes(league)) {
    return `https://a.espncdn.com/i/teamlogos/${league}/500-dark/${abbr.toLowerCase()}.png`;
  }
  return `https://a.espncdn.com/i/teamlogos/ncaa/500/${teamId}.png`;
}

/* ── ESPN SPORT MAP ─────────────────────────────────────── */
const SPORTS = [
  { key: 'nba',    sport: 'basketball', league: 'nba',                     label: 'NBA' },
  { key: 'mlb',    sport: 'baseball',   league: 'mlb',                     label: 'MLB' },
  { key: 'nhl',    sport: 'hockey',     league: 'nhl',                     label: 'NHL' },
  { key: 'ncaamb', sport: 'basketball', league: 'mens-college-basketball',  label: 'NCAAB' },
];

/* ── SERVICE WORKER (PWA) ───────────────────────────────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

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
    const r = await fetch(url, { cache: 'no-store' });
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

    const athletes = statsGroup.athletes || [];
    const findLeader = (idx) => {
      if (idx === -1) return null;
      let best = null, max = -1;
      for (const athlete of athletes) {
        const val = parseInt(athlete.stats?.[idx] || 0);
        if (val > max) {
          max = val;
          best = { name: athlete.athlete?.shortName || athlete.athlete?.displayName || '?', value: val };
        }
      }
      return best;
    };

    return { ...g, player: { pts: findLeader(ptsIdx), reb: findLeader(rebIdx), ast: findLeader(astIdx) } };
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
      return {
        pts: getCatLeader('points'),
        reb: getCatLeader('rebounds'),
        ast: getCatLeader('assists'),
      };
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
}

/* ── PLAYER MODAL ───────────────────────────────────────── */
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

    let pts = 0, reb = 0, ast = 0, didNotPlay = false, dnpReason = '';
    const summary = summaries[i];
    if (summary?.boxscore?.players) {
      let playerFound = false;
      outer: for (const td of summary.boxscore.players) {
        for (const grp of td.statistics || []) {
          const lbls = grp.labels || [];
          const pi = lbls.indexOf('PTS'), ri = lbls.indexOf('REB'), ai = lbls.indexOf('AST');
          const ath = grp.athletes?.find(a => a.athlete?.id === athleteId);
          if (ath) {
            playerFound = true;
            const isDnp = ath.didNotPlay || !ath.stats?.length || ath.stats?.[0] === 'DNP' || ath.stats?.[0] === '0:00';
            if (isDnp) {
              didNotPlay = true;
              dnpReason = ath.reason || 'DNP';
            } else {
              pts = parseInt(ath.stats?.[pi] || 0) || 0;
              reb = ri > -1 ? parseInt(ath.stats?.[ri] || 0) || 0 : 0;
              ast = ai > -1 ? parseInt(ath.stats?.[ai] || 0) || 0 : 0;
            }
            break outer;
          }
        }
      }
      if (!playerFound) { didNotPlay = true; dnpReason = 'INACTIVE'; }
    }

    return {
      opponent: oppC?.team?.abbreviation || '?',
      isHome: teamC?.homeAway === 'home',
      result, myScore, oppScore, pts, reb, ast, didNotPlay, dnpReason,
      date: new Date(ev.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    };
  });
}

async function openPlayerModal(el) {
  const athleteId = el.dataset.athleteId;
  const teamId    = el.dataset.teamId;
  const name      = el.dataset.name;

  S.playerModal = { athleteId, teamId, name, games: null };
  document.getElementById('playerModalName').textContent = name;
  const hsEl = document.getElementById('playerModalHeadshot');
  hsEl.src = el.dataset.headshot || '';
  hsEl.style.display = el.dataset.headshot ? 'block' : 'none';
  document.getElementById('playerModalLoading').classList.remove('hidden');
  document.getElementById('playerModalChart').classList.add('hidden');
  document.getElementById('playerModal').classList.remove('hidden');
  document.querySelectorAll('#playerModal .stat-btn').forEach((b, i) => {
    b.classList.toggle('active', i === 0);
  });

  const games = await fetchPlayerLastGames(S.gameData.gameInfo.sportKey, teamId, athleteId);
  S.playerModal.games = games;
  document.getElementById('playerModalLoading').classList.add('hidden');
  document.getElementById('playerModalChart').classList.remove('hidden');
  renderPlayerModalChart('pts');
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

function closePlayerModal(e) {
  if (e && e.target !== document.getElementById('playerModal')) return;
  document.getElementById('playerModal').classList.add('hidden');
  if (S.charts.playerModal) { S.charts.playerModal.destroy(); delete S.charts.playerModal; }
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
          [...form].reverse().map(g => `
            <div class="form-game">
              <div class="form-result ${g.result}">${g.result}</div>
              <div class="form-details">
                <div class="form-matchup">${g.home ? 'vs' : '@'} ${g.opponent}</div>
                <div class="form-score">${g.myScore} – ${g.oppScore}${g.player?.pts ? ` · <span style="color:var(--lime);opacity:0.8">${g.player.pts.name} ${g.player.pts.value}pts</span>` : ''}</div>
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
  const values = games.map(g => g.player?.[stat]?.value ?? 0);
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
    return `
      <div class="h2h-player-row">
        ${playerCard(leader.pts, 'PTS')}
        ${playerCard(leader.reb, 'REB')}
        ${playerCard(leader.ast, 'AST')}
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

    ${hasLeaders ? `
    <div class="h2h-charts-row">
      <div class="form-chart-section">
        <div class="form-chart-controls">
          <span class="form-chart-label" style="color:var(--blue)">${gameInfo.awayAbbr} · Player of the Game</span>
          <div class="stat-toggle">
            <button class="stat-btn active" onclick="switchH2HStat('h2hChartAway', 'pts', this)">PTS</button>
            <button class="stat-btn" onclick="switchH2HStat('h2hChartAway', 'reb', this)">REB</button>
            <button class="stat-btn" onclick="switchH2HStat('h2hChartAway', 'ast', this)">AST</button>
          </div>
        </div>
        <canvas id="h2hChartAway" height="150"></canvas>
      </div>
      <div class="form-chart-section">
        <div class="form-chart-controls">
          <span class="form-chart-label" style="color:var(--orange)">${gameInfo.homeAbbr} · Player of the Game</span>
          <div class="stat-toggle">
            <button class="stat-btn active" onclick="switchH2HStat('h2hChartHome', 'pts', this)">PTS</button>
            <button class="stat-btn" onclick="switchH2HStat('h2hChartHome', 'reb', this)">REB</button>
            <button class="stat-btn" onclick="switchH2HStat('h2hChartHome', 'ast', this)">AST</button>
          </div>
        </div>
        <canvas id="h2hChartHome" height="150"></canvas>
      </div>
    </div>` : ''}

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
    setTimeout(() => {
      renderH2HChart('h2hChartAway', h2h, 'away', 'pts');
      renderH2HChart('h2hChartHome', h2h, 'home', 'pts');
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
