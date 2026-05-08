/* ============================================================
   PLAYIQ — SHARED DATA LAYER
   Cross-sport APIs, shared fetchers, and AI helpers
   ============================================================ */

// Backend URL resolution order (so the same build works locally + deployed):
//   1. window.PIQ_API_BASE override
//   2. localhost shortcut: if the page is served from localhost / 127.0.0.1 /
//      file://, use http://localhost:3001 — keeps dev fast even when the meta
//      tag is set to a public URL for production
//   3. <meta name="piq-api-base" content="https://…onrender.com">
//   4. localhost fallback (last resort)
const API_BASE = (() => {
  if (typeof window !== 'undefined' && window.PIQ_API_BASE) return window.PIQ_API_BASE;
  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  if (!host || host === 'localhost' || host === '127.0.0.1') return 'http://localhost:3001';
  if (typeof document !== 'undefined') {
    const meta = document.querySelector('meta[name="piq-api-base"]');
    if (meta?.content) return meta.content;
  }
  return 'http://localhost:3001';
})();

const SPORTS_CONFIG = [
  { key: 'mlb', sport: 'baseball', league: 'mlb', label: 'MLB' },
  { key: 'nba', sport: 'basketball', league: 'nba', label: 'NBA' },
  { key: 'nhl', sport: 'hockey', league: 'nhl', label: 'NHL' },
  { key: 'ncaamb', sport: 'basketball', league: 'mens-college-basketball', label: 'NCAAB' },
];

function teamLogoUrl(league, abbr, teamId) {
  const pro = ['nba', 'nfl', 'mlb', 'nhl'];
  return pro.includes(league)
    ? `https://a.espncdn.com/i/teamlogos/${league}/500-dark/${(abbr || '').toLowerCase()}.png`
    : `https://a.espncdn.com/i/teamlogos/ncaa/500/${teamId}.png`;
}

async function espnFetch(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function getSeasonYear(sportKey) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (sportKey === 'nfl' || sportKey === 'ncaafb') return month < 8 ? year - 1 : year;
  return year;
}

async function fetchAllGames(date) {
  const dateStr = (date || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })).replace(/-/g, '');
  const results = await Promise.all(
    SPORTS_CONFIG.map(sp =>
      espnFetch(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/scoreboard?dates=${dateStr}`)
        .then(data => ({ sp, events: data?.events || [] }))
    )
  );
  const allGames = [];
  for (const { sp, events } of results) {
    for (const ev of events) {
      const comp = ev.competitions?.[0];
      if (!comp) continue;
      const home = comp.competitors?.find(c => c.homeAway === 'home');
      const away = comp.competitors?.find(c => c.homeAway === 'away');
      if (!home || !away) continue;
      const odds = comp.odds?.[0];
      const parseScore = s => {
        const v = parseInt(s?.displayValue ?? s ?? '', 10);
        return Number.isNaN(v) ? null : v;
      };
      allGames.push({
        sportKey: sp.key, sportLabel: sp.label, sport: sp.sport, league: sp.league,
        eventId: ev.id,
        awayFull: away.team.displayName, awayAbbr: away.team.abbreviation, awayTeamId: away.team.id,
        awayScore: parseScore(away.score), awayLogo: teamLogoUrl(sp.league, away.team.abbreviation, away.team.id),
        homeFull: home.team.displayName, homeAbbr: home.team.abbreviation, homeTeamId: home.team.id,
        homeScore: parseScore(home.score), homeLogo: teamLogoUrl(sp.league, home.team.abbreviation, home.team.id),
        statusText: ev.status?.type?.description || 'Scheduled',
        statusState: ev.status?.type?.state,
        statusDetail: ev.status?.type?.shortDetail || '',
        date: ev.date, venue: comp.venue?.fullName,
        spread: odds?.details, overUnder: odds?.overUnder,
        awayMoneyline: odds?.awayTeamOdds?.moneyLine,
        homeMoneyline: odds?.homeTeamOdds?.moneyLine,
      });
    }
  }
  return allGames;
}

async function fetchTeamForm(sportKey, teamId) {
  const sp = SPORTS_CONFIG.find(s => s.key === sportKey);
  if (!sp) return [];
  const season = getSeasonYear(sportKey);
  const data = await espnFetch(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/teams/${teamId}/schedule?season=${season}`);
  if (!data?.events) return [];
  const completed = data.events.filter(e => e.competitions?.[0]?.status?.type?.completed).slice(-10);
  return completed.map(ev => {
    const comp = ev.competitions[0];
    const mine = comp.competitors?.find(c => c.team?.id === teamId);
    const opp = comp.competitors?.find(c => c.team?.id !== teamId);
    const ps = s => parseInt(s?.displayValue ?? s ?? 0, 10) || 0;
    const myScore = ps(mine?.score);
    const oppScore = ps(opp?.score);
    const result = mine?.winner === true ? 'W' : mine?.winner === false ? 'L' : myScore > oppScore ? 'W' : myScore < oppScore ? 'L' : 'T';
    return {
      eventId: ev.id, result,
      opponent: opp?.team?.abbreviation || '?', opponentFull: opp?.team?.displayName || '',
      oppLogo: teamLogoUrl(sp.league, opp?.team?.abbreviation, opp?.team?.id),
      myScore, oppScore, home: comp.competitors?.find(c => c.homeAway === 'home')?.team?.id === teamId,
      date: new Date(ev.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    };
  });
}

async function enrichFormWithPlayerStats(sportKey, teamId, formGames) {
  const sp = SPORTS_CONFIG.find(s => s.key === sportKey);
  if (!sp) return formGames;
  const MLB_CATS = [
    { key: 'hits', label: 'H', espnBoxLabel: 'H', espnLeaderCat: 'hits' },
    { key: 'rbi', label: 'RBI', espnBoxLabel: 'RBI', espnLeaderCat: 'RBI' },
    { key: 'runs', label: 'R', espnBoxLabel: 'R', espnLeaderCat: 'runs' },
  ];
  const NBA_CATS = [
    { key: 'pts', label: 'PTS', espnBoxLabel: 'PTS' },
    { key: 'reb', label: 'REB', espnBoxLabel: 'REB' },
    { key: 'ast', label: 'AST', espnBoxLabel: 'AST' },
  ];
  const cats = sportKey === 'mlb' ? MLB_CATS : NBA_CATS;
  const summaries = await Promise.all(
    formGames.map(g => g.eventId
      ? espnFetch(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/summary?event=${g.eventId}`)
      : Promise.resolve(null))
  );
  return formGames.map((g, i) => {
    const summary = summaries[i];
    const teamPlayers = summary?.boxscore?.players?.find(p => String(p.team?.id) === String(teamId));
    const statsGroup = teamPlayers?.statistics?.[0];
    if (!statsGroup) return { ...g, player: null };
    const labels = statsGroup.labels || [];
    const athletes = statsGroup.athletes || [];
    const player = {};
    cats.forEach(c => {
      const idx = labels.indexOf(c.espnBoxLabel);
      if (idx === -1) return;
      let best = null, max = -1;
      for (const ath of athletes) {
        const val = parseInt(ath.stats?.[idx] || 0, 10);
        if (val > max) {
          max = val;
          const a = ath.athlete || {};
          best = {
            name: a.shortName || a.displayName || '?',
            value: val,
            headshot: a.headshot?.href || (a.id ? `https://a.espncdn.com/i/headshots/${sp.league}/players/full/${a.id}.png` : null),
          };
        }
      }
      player[c.key] = best;
    });
    return { ...g, player, cats };
  });
}

async function fetchH2H(gameInfo) {
  const sp = SPORTS_CONFIG.find(s => s.key === gameInfo.sportKey);
  if (!sp) return { games: [], summaries: [] };
  const baseSeason = getSeasonYear(gameInfo.sportKey);
  const seasons = [baseSeason, baseSeason - 1, baseSeason - 2];
  const fetched = await Promise.all(
    seasons.flatMap(season => [2, 3].map(stype =>
      espnFetch(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/teams/${gameInfo.awayTeamId}/schedule?season=${season}&seasontype=${stype}`)
        .then(d => d?.events || [])
    ))
  );
  const seen = new Set();
  const allEvents = [];
  for (const list of fetched) {
    for (const ev of list) {
      if (ev?.id && !seen.has(ev.id)) { seen.add(ev.id); allEvents.push(ev); }
    }
  }
  const h2h = allEvents
    .filter(ev => {
      const comp = ev.competitions?.[0];
      return comp?.status?.type?.completed && comp.competitors?.some(c => c.team?.id === gameInfo.homeTeamId);
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);
  const summaries = await Promise.all(
    h2h.map(ev => espnFetch(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/summary?event=${ev.id}`))
  );
  const MLB_CATS = [
    { key: 'hits', espnLeaderCat: 'hits' },
    { key: 'rbi', espnLeaderCat: 'RBI' },
    { key: 'runs', espnLeaderCat: 'runs' },
  ];
  const NBA_CATS = [
    { key: 'pts', espnLeaderCat: 'points' },
    { key: 'reb', espnLeaderCat: 'rebounds' },
    { key: 'ast', espnLeaderCat: 'assists' },
  ];
  const cats = gameInfo.sportKey === 'mlb' ? MLB_CATS : NBA_CATS;
  const games = h2h.map((ev, i) => {
    const comp = ev.competitions[0];
    const awayC = comp.competitors.find(c => c.homeAway === 'away');
    const homeC = comp.competitors.find(c => c.homeAway === 'home');
    const ps = s => parseInt(s?.displayValue ?? s ?? 0, 10) || 0;
    const awayScore = ps(awayC?.score), homeScore = ps(homeC?.score);
    const leaders = summaries[i]?.leaders || [];
    const getLeader = (teamAbbr, catName) => {
      const tl = leaders.find(l => l.team?.abbreviation === teamAbbr);
      const cat = tl?.leaders?.find(c => c.name === catName);
      const top = cat?.leaders?.[0];
      return top ? {
        name: top.athlete?.shortName || top.athlete?.displayName || '?',
        value: parseInt(top.displayValue, 10) || 0,
        headshot: top.athlete?.headshot?.href || (top.athlete?.id ? `https://a.espncdn.com/i/headshots/${sp.league}/players/full/${top.athlete.id}.png` : null),
      } : null;
    };
    const awayLeaders = {}, homeLeaders = {};
    cats.forEach(c => {
      awayLeaders[c.key] = getLeader(gameInfo.awayAbbr, c.espnLeaderCat);
      homeLeaders[c.key] = getLeader(gameInfo.homeAbbr, c.espnLeaderCat);
    });
    return {
      date: new Date(ev.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      awayAbbr: awayC?.team?.abbreviation, homeAbbr: homeC?.team?.abbreviation,
      awayScore, homeScore,
      winner: awayC?.winner === true ? 'away' : homeC?.winner === true ? 'home' : awayScore > homeScore ? 'away' : 'home',
      awayLeaders, homeLeaders,
    };
  });
  return { games, summaries };
}

async function fetchInjuries(gameInfo) {
  const sp = SPORTS_CONFIG.find(s => s.key === gameInfo.sportKey);
  if (!sp) return { away: [], home: [] };
  const data = await espnFetch(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/injuries`);
  if (!data?.injuries) return { away: [], home: [] };
  const filter = teamId => {
    const t = data.injuries.find(team => String(team.id) === String(teamId));
    return (t?.injuries || []).map(inj => {
      const athleteId = inj.athlete?.id || null;
      const details = inj.details || {};
      // ESPN sometimes provides a returnDate string (YYYY-MM-DD) or a free-form
      // string like "January 5". Keep both raw and humanized forms.
      const returnRaw = details.returnDate || inj.athlete?.injuries?.[0]?.details?.returnDate || null;
      let returnDate = null;
      if (returnRaw) {
        const d = new Date(returnRaw);
        returnDate = Number.isNaN(d.getTime())
          ? returnRaw
          : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
      return {
        name: inj.athlete?.displayName || '—',
        status: inj.status || 'Unknown',
        pos: inj.athlete?.position?.abbreviation || '',
        athleteId,
        headshot: athleteId ? `https://a.espncdn.com/i/headshots/${sp.league}/players/full/${athleteId}.png` : null,
        desc: (inj.shortComment || '').match(/\(([^)]+)\)/)?.[1] || '',
        // Full report fields
        shortComment: inj.shortComment || '',
        longComment: inj.longComment || '',
        type: details.type || '',
        location: details.location || '',
        detail: details.detail || '',
        side: details.side || '',
        fantasyStatus: details.fantasyStatus?.description || '',
        returnDate,
        reportedDate: inj.date ? new Date(inj.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null,
      };
    });
  };
  return { away: filter(gameInfo.awayTeamId), home: filter(gameInfo.homeTeamId) };
}

async function fetchRoster(sportKey, teamId) {
  const sp = SPORTS_CONFIG.find(s => s.key === sportKey);
  if (!sp) return [];
  const data = await espnFetch(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/teams/${teamId}/roster`);
  if (!data?.athletes) return [];
  const players = [];
  (data.athletes || []).forEach(group => {
    (group.items || [group]).forEach(p => {
      if (!p.fullName) return;
      const injStatus = typeof p.injuries?.[0]?.status === 'string' ? p.injuries[0].status : (p.injuries?.[0]?.status?.description || null);
      const status = injStatus || (typeof p.status === 'string' ? p.status : p.status?.description || 'Active');
      players.push({
        id: p.id,
        name: p.displayName || p.fullName,
        pos: p.position?.abbreviation || '—',
        jersey: p.jersey || '—',
        status,
        injuryDesc: p.injuries?.[0]?.type?.description || '',
        headshot: p.headshot?.href || (p.id ? `https://a.espncdn.com/i/headshots/${sp.league}/players/full/${p.id}.png` : null),
      });
    });
  });
  return players;
}

async function fetchTeamStats(sportKey, teamId) {
  const sp = SPORTS_CONFIG.find(s => s.key === sportKey);
  if (!sp) return null;
  const data = await espnFetch(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/teams/${teamId}/statistics`);
  if (!data?.results?.stats?.categories) return null;
  const result = {};
  for (const cat of data.results.stats.categories) {
    for (const stat of cat.stats || []) {
      result[stat.name] = { value: stat.value, rank: stat.rank ?? null };
    }
  }
  return Object.keys(result).length ? result : null;
}

const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

function getApiKey() {
  return localStorage.getItem('piq_key') || '';
}

async function claudeComplete(prompt, { maxTokens = 1200 } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('NO_API_KEY');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

window.claude = window.claude || {};
window.claude.complete = claudeComplete;

async function generateAIPlays(gameData) {
  const { gameInfo, awayForm, homeForm, h2h } = gameData;
  const awayW = (awayForm || []).filter(g => g.result === 'W').length;
  const homeW = (homeForm || []).filter(g => g.result === 'W').length;
  const h2hGames = (h2h?.games || []).slice(0, 3);
  const prompt = `You are a sports betting analyst. Analyze this ${gameInfo.sportLabel} game and provide 3 specific prop or game bets.

Game: ${gameInfo.awayFull} @ ${gameInfo.homeFull}
Venue: ${gameInfo.venue || 'TBD'}
Spread: ${gameInfo.spread || 'N/A'} | O/U: ${gameInfo.overUnder || 'N/A'}
${gameInfo.awayAbbr} last ${awayForm?.length || 0}: ${awayW}W-${(awayForm?.length || 0) - awayW}L
${gameInfo.homeAbbr} last ${homeForm?.length || 0}: ${homeW}W-${(homeForm?.length || 0) - homeW}L
H2H recent: ${h2hGames.map(g => `${g.awayAbbr} ${g.awayScore}-${g.homeScore} ${g.homeAbbr} (${g.date})`).join(', ') || 'No recent data'}

Respond with exactly 3 plays in this JSON format:
[{"play":"bet description","confidence":"HIGH|MEDIUM|LOW","reason":"1-sentence reason","type":"SPREAD|TOTAL|PROP|ML"}]`;

  try {
    const response = await claudeComplete(prompt, { maxTokens: 900 });
    const match = response.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
  } catch (e) {
    if (e.message === 'NO_API_KEY') return { error: 'NO_API_KEY' };
    console.error('generateAIPlays failed:', e);
  }
  return [];
}

Object.assign(window, {
  SPORTS_CONFIG, API_BASE, teamLogoUrl, espnFetch, getSeasonYear,
  fetchAllGames, fetchTeamForm, enrichFormWithPlayerStats,
  fetchH2H, fetchInjuries, fetchRoster, fetchTeamStats,
  getApiKey, claudeComplete, CLAUDE_MODEL, generateAIPlays,
});
