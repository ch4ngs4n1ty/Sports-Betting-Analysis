/* ── MLB SPORT CONFIG ─────────────────────────────────────
   Shared MLB stat labels and props mappings.
   MLB tab implementations live in sports/mlb/tabs.js.
─────────────────────────────────────────────────────────── */
window.SportConfig = window.SportConfig || {};

SportConfig.mlb = {
  statCategories: [
    { key: 'hits', label: 'H', espnBoxLabel: 'H', espnLeaderCat: 'hits' },
    { key: 'runs', label: 'R', espnBoxLabel: 'R', espnLeaderCat: 'runs' },
    { key: 'rbi', label: 'RBI', espnBoxLabel: 'RBI', espnLeaderCat: 'RBI' },
  ],

  propsStats: {
    paceAndScoring: [
      { label: 'Runs / Game', key: 'avgRuns' },
      { label: 'Hits / Game', key: 'avgHits' },
      { label: 'Batting Avg', key: 'battingAvg', pct: true },
      { label: 'On-base %', key: 'onBasePct', pct: true },
    ],
    scoringMethods: [
      { label: 'HRs / Game', key: 'avgHomeRuns' },
      { label: 'Slugging %', key: 'sluggingPct', pct: true },
      { label: 'OPS', key: 'OPS' },
      { label: 'RBI / Game', key: 'avgRbi' },
    ],
    defense: [
      { label: 'ERA', key: 'ERA' },
      { label: 'WHIP', key: 'WHIP' },
      { label: 'Strikeouts / 9', key: 'strikeoutsPerNineInnings' },
    ],
  },
};
