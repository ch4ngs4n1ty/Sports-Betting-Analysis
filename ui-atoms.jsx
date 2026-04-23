/* ============================================================
   PLAYIQ — UI ATOMS
   All shared primitive components
   ============================================================ */

/* ── Corner-bracket HUD card ─────────────────────────── */
function HudCard({ children, style = {}, accent = 'var(--cyan)', onClick, active = false, className = '' }) {
  const [hov, setHov] = React.useState(false);
  const on = hov || active;
  const bw = 1.5, bs = 10;
  return (
    <div onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      className={className}
      style={{ position: 'relative', background: 'var(--card)', cursor: onClick ? 'pointer' : 'default',
        transition: 'box-shadow 0.2s', boxShadow: on ? `0 0 28px ${accent}18, inset 0 0 14px ${accent}06` : 'none', ...style }}>
      {[['top','left'],['top','right'],['bottom','left'],['bottom','right']].map(([v,h]) => (
        <div key={v+h} style={{
          position: 'absolute', [v]: 0, [h]: 0, width: bs, height: bs, pointerEvents: 'none',
          borderTop:    v==='top'    ? `${bw}px solid ${on ? accent : accent+'44'}` : 'none',
          borderBottom: v==='bottom' ? `${bw}px solid ${on ? accent : accent+'44'}` : 'none',
          borderLeft:   h==='left'   ? `${bw}px solid ${on ? accent : accent+'44'}` : 'none',
          borderRight:  h==='right'  ? `${bw}px solid ${on ? accent : accent+'44'}` : 'none',
          transition: 'border-color 0.2s',
        }} />
      ))}
      {children}
    </div>
  );
}

/* ── Status badge ─────────────────────────────────────── */
function StatusBadge({ status }) {
  const cfg = {
    'Scheduled':   { color: 'var(--cyan)',  label: 'SCH',  pulse: false },
    'In Progress': { color: 'var(--green)', label: 'LIVE', pulse: true  },
    'Final':       { color: 'var(--dim)',   label: 'FIN',  pulse: false },
    'Postponed':   { color: 'var(--orange)',label: 'PPD',  pulse: false },
  };
  const { color, label, pulse } = cfg[status] || cfg['Scheduled'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: color,
        boxShadow: `0 0 6px ${color}`, animation: pulse ? 'livePulse 1.4s ease-in-out infinite' : 'none' }} />
      <span style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', color, letterSpacing: '0.12em', fontWeight: 700 }}>{label}</span>
    </div>
  );
}

/* ── Loader ───────────────────────────────────────────── */
function Loader({ text = 'LOADING' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '48px 24px' }}>
      <svg width="40" height="40" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(0,212,255,0.1)" strokeWidth="2" />
        <circle cx="20" cy="20" r="16" fill="none" stroke="var(--cyan)" strokeWidth="2"
          strokeDasharray="40 60" strokeLinecap="round">
          <animateTransform attributeName="transform" type="rotate" from="0 20 20" to="360 20 20" dur="0.9s" repeatCount="indefinite" />
        </circle>
      </svg>
      <span style={{ fontFamily: 'Space Mono, monospace', fontSize: 10, color: 'var(--dim)', letterSpacing: '0.2em' }}>{text}</span>
    </div>
  );
}

/* ── Stat bar ─────────────────────────────────────────── */
function StatBar({ label, value, max = 1, color = 'var(--cyan)', decimals = 3 }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--dim)', fontFamily: 'Space Mono, monospace', textTransform: 'uppercase' }}>{label}</span>
        <span style={{ fontSize: 12, fontFamily: 'Space Mono, monospace', fontWeight: 700, color }}>{value != null ? value.toFixed(decimals) : '—'}</span>
      </div>
      <div style={{ height: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, boxShadow: `0 0 8px ${color}88`, borderRadius: 2, transition: 'width 0.9s cubic-bezier(0.16,1,0.3,1)' }} />
      </div>
    </div>
  );
}

/* ── Sparkline ────────────────────────────────────────── */
function Sparkline({ data, width = 200, height = 48, color = 'var(--cyan)', valueKey = 'avg' }) {
  if (!data || data.length < 2) return (
    <svg width={width} height={height}><text x={width/2} y={height/2+4} textAnchor="middle" fill="var(--dim)" fontSize="9" fontFamily="Space Mono, monospace">NO DATA</text></svg>
  );
  const vals = data.map(d => d[valueKey] ?? d);
  const minV = Math.min(...vals), maxV = Math.max(...vals);
  const range = maxV - minV || 0.001;
  const p = 4;
  const pts = vals.map((v, i) => [p + (i/(vals.length-1))*(width-p*2), p + (1-(v-minV)/range)*(height-p*2)]);
  const d = pts.map((pt, i) => `${i===0?'M':'L'}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(' ');
  const area = d + ` L${pts[pts.length-1][0]},${height} L${pts[0][0]},${height} Z`;
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={`sg_${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg_${color})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      {pts.map((pt, i) => <circle key={i} cx={pt[0]} cy={pt[1]} r={2.5} fill={color} stroke="var(--bg)" strokeWidth="1.5" />)}
    </svg>
  );
}

/* ── OPS Gauge (circular) ─────────────────────────────── */
function OpsGauge({ ops, size = 80 }) {
  const max = 1.4, r = size*0.42, cx = size/2, cy = size/2, sw = size*0.075;
  const pct = Math.min(ops / max, 1);
  const circ = 2 * Math.PI * r;
  const color = ops >= 0.900 ? '#00ff88' : ops >= 0.750 ? '#ffd060' : ops >= 0.600 ? 'var(--cyan)' : '#ff6b35';
  return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={sw} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={sw}
        strokeDasharray={`${circ*pct} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: 'stroke-dasharray 1s cubic-bezier(0.16,1,0.3,1)' }} />
      <text x={cx} y={cy-3} textAnchor="middle" fill={color} fontSize={size*0.165} fontFamily="Space Mono, monospace" fontWeight="700">{ops>0?ops.toFixed(3):'—'}</text>
      <text x={cx} y={cy+size*0.14} textAnchor="middle" fill="var(--dim)" fontSize={size*0.1} fontFamily="Space Mono, monospace" letterSpacing="2">OPS</text>
    </svg>
  );
}

/* ── Player card ─────────────────────────────────────── */
function PlayerCard({ player, size = 'md', accent, showStats = false }) {
  const [imgErr, setImgErr] = React.useState(false);
  const s = size === 'sm' ? 40 : size === 'lg' ? 72 : 52;
  const ac = accent || 'var(--cyan)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center' }}>
      <div style={{ width: s, height: s, borderRadius: '50%', overflow: 'hidden', border: `2px solid ${ac}44`,
        boxShadow: `0 0 12px ${ac}22`, background: 'var(--surface)', flexShrink: 0 }}>
        {player?.headshot && !imgErr
          ? <img src={player.headshot} alt={player.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => setImgErr(true)} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: s * 0.35, fontFamily: 'Orbitron, monospace', color: ac, fontWeight: 700 }}>
              {(player?.name || '?').charAt(0)}
            </div>
        }
      </div>
      <div>
        <div style={{ fontSize: size === 'sm' ? 9 : 11, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700, lineHeight: 1.2 }}>
          {player?.name || '—'}
        </div>
        {player?.pos && <div style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', marginTop: 2 }}>{player.pos}{player?.jersey ? ` #${player.jersey}` : ''}</div>}
      </div>
      {showStats && player?.value != null && (
        <div style={{ fontSize: 16, fontFamily: 'Orbitron, monospace', color: ac, fontWeight: 700 }}>{player.value}</div>
      )}
    </div>
  );
}

/* ── SVG Bar Chart (Edge Finder) ──────────────────────── */
function SvgBarChart({ items, height = 140, barW = 28, gap = 10, showLabel = true, valuePad = 16 }) {
  // items: [{label, value, max, color, sublabel, valueLabel}]
  // `valuePad` = top headroom so value labels never clip when bars hit max.
  if (!items?.length) return null;
  const totalW = items.length * (barW + gap) - gap;
  const labelH = showLabel ? 28 : 0;
  const totalH = valuePad + height + labelH;
  return (
    <svg width={totalW} height={totalH} style={{ overflow: 'visible' }}>
      {items.map((item, i) => {
        const x = i * (barW + gap);
        const pct = Math.min((item.value || 0) / (item.max || 1), 1);
        const barH = pct * height;
        const barTop = valuePad + (height - barH);
        const color = item.color || 'var(--cyan)';
        const labelY = Math.max(valuePad - 4, barTop - 4);
        return (
          <g key={i}>
            {/* Track */}
            <rect x={x} y={valuePad} width={barW} height={height} fill="rgba(255,255,255,0.03)" rx={3} />
            {/* Fill */}
            <rect x={x} y={barTop} width={barW} height={barH} fill={color} rx={3}
              style={{ filter: `drop-shadow(0 0 4px ${color}88)` }} />
            {/* Value label — clamped to the padded headroom */}
            <text x={x + barW/2} y={labelY} textAnchor="middle" fill={color}
              fontSize="9" fontFamily="Space Mono, monospace" fontWeight="700">
              {item.valueLabel || ''}
            </text>
            {/* Bottom label */}
            {showLabel && (
              <text x={x + barW/2} y={valuePad + height + 16} textAnchor="middle" fill="var(--dim)"
                fontSize="8" fontFamily="Space Mono, monospace" letterSpacing="1">
                {item.label}
              </text>
            )}
            {/* Sublabel */}
            {showLabel && item.sublabel && (
              <text x={x + barW/2} y={valuePad + height + 26} textAnchor="middle" fill="var(--muted)"
                fontSize="7" fontFamily="Space Mono, monospace">
                {item.sublabel}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ── Dual bar (BvP vs Season comparison) ─────────────── */
function DualStatBar({ label, bvpVal, seasonVal, fmt, higher = true }) {
  if (bvpVal == null && seasonVal == null) return null;
  const max = Math.max(bvpVal || 0, seasonVal || 0, 0.001) * 1.3;
  const bvpPct = Math.min((bvpVal || 0) / max * 100, 100);
  const seaPct = Math.min((seasonVal || 0) / max * 100, 100);
  const edge = (bvpVal != null && seasonVal != null) ? bvpVal - seasonVal : null;
  const isGood = higher ? edge > 0 : edge < 0;
  const edgeColor = edge == null ? 'var(--dim)' : Math.abs(edge) < 0.01 ? 'var(--dim)' : isGood ? '#00ff88' : '#ff6b35';
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.1em' }}>{label}</span>
        {edge != null && <span style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', color: edgeColor, fontWeight: 700 }}>
          {edge > 0 ? '+' : ''}{fmt(edge)}
        </span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 8, color: 'var(--cyan)', fontFamily: 'Space Mono, monospace', width: 26, flexShrink: 0 }}>BvP</span>
          <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${bvpPct}%`, background: 'var(--cyan)', borderRadius: 2 }} />
          </div>
          <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--cyan)', fontWeight: 700, width: 40, textAlign: 'right' }}>{bvpVal != null ? fmt(bvpVal) : '—'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 8, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', width: 26, flexShrink: 0 }}>SEA</span>
          <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${seaPct}%`, background: 'var(--muted)', borderRadius: 2 }} />
          </div>
          <span style={{ fontSize: 10, fontFamily: 'Space Mono, monospace', color: 'var(--muted)', width: 40, textAlign: 'right' }}>{seasonVal != null ? fmt(seasonVal) : '—'}</span>
        </div>
      </div>
    </div>
  );
}

/* ── Weather pill (compact) ───────────────────────────── */
function WeatherPill({ weather }) {
  if (!weather) return null;
  const wind = parseInt(weather.wind) || 0;
  const wColor = wind >= 10 ? '#ff6b35' : wind >= 6 ? '#ffd060' : '#00ff88';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
      background: 'rgba(0,212,255,0.04)', border: '1px solid rgba(0,212,255,0.08)', borderRadius: 3 }}>
      <span style={{ fontSize: 13, fontFamily: 'Space Mono, monospace', color: 'var(--text)', fontWeight: 700 }}>{weather.temp}°F</span>
      <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'Space Mono, monospace' }}>{weather.condition}</span>
      <span style={{ fontSize: 10, color: wColor, fontFamily: 'Space Mono, monospace' }}>{weather.wind}</span>
      {weather.roofType && weather.roofType !== 'Open' && (
        <span style={{ fontSize: 9, color: weather.roofType === 'Indoor' ? '#ff6b35' : '#ffd060',
          fontFamily: 'Space Mono, monospace', letterSpacing: '0.1em' }}>{weather.roofType.toUpperCase()}</span>
      )}
    </div>
  );
}

/* ── Section header ───────────────────────────────────── */
function SectionHeader({ label, sub }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 9, fontFamily: 'Space Mono, monospace', color: 'var(--cyan)', letterSpacing: '0.22em' }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'Space Mono, monospace', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/* ── Odds strip ──────────────────────────────────────── */
function OddsStrip({ game }) {
  const pills = [];
  if (game.spread) pills.push(['SPREAD', game.spread]);
  if (game.overUnder) pills.push(['O/U', game.overUnder]);
  if (game.awayMoneyline) pills.push([`${game.awayAbbr} ML`, game.awayMoneyline > 0 ? `+${game.awayMoneyline}` : game.awayMoneyline]);
  if (game.homeMoneyline) pills.push([`${game.homeAbbr} ML`, game.homeMoneyline > 0 ? `+${game.homeMoneyline}` : game.homeMoneyline]);
  if (!pills.length) return null;
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {pills.map(([l, v]) => (
        <div key={l} style={{ padding: '4px 10px', border: '1px solid rgba(0,212,255,0.15)', borderRadius: 2,
          background: 'rgba(0,212,255,0.04)' }}>
          <div style={{ fontSize: 8, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.1em' }}>{l}</div>
          <div style={{ fontSize: 13, color: 'var(--cyan)', fontFamily: 'Space Mono, monospace', fontWeight: 700 }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

/* ── Form dots (W/L pills) ───────────────────────────── */
function FormDots({ form }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {form.map((g, i) => (
        <div key={i} style={{
          width: 20, height: 20, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: g.result === 'W' ? 'rgba(0,255,136,0.15)' : 'rgba(255,107,53,0.15)',
          border: `1px solid ${g.result === 'W' ? 'rgba(0,255,136,0.3)' : 'rgba(255,107,53,0.3)'}`,
          fontSize: 9, fontFamily: 'Space Mono, monospace',
          color: g.result === 'W' ? '#00ff88' : '#ff6b35', fontWeight: 700
        }} title={`${g.result} ${g.myScore}-${g.oppScore} vs ${g.opponent}`}>
          {g.result}
        </div>
      ))}
    </div>
  );
}

/* ── Game log chart (L5 season + BvP per-game) ────────── */
// `games` = [{hits, hr, r, rbi, k, bb, opp, home, date, weather:{temp,wind}}, ...]
// `stats` = [{key, label}] — toggle buttons across the top
// `defaultStat` = which stat to show first
// Uses flex cells so bars distribute evenly across the container, regardless of width.
// Default color buckets (MLB counting stats). Callers pass `colorFor` to override for NBA etc.
const defaultStatColorFor = (v, sk) => {
  if (sk === 'k')   return v === 0 ? 'var(--green)' : v === 1 ? 'var(--cyan)' : v >= 3 ? 'var(--orange)' : 'var(--gold)';
  if (sk === 'hr')  return v >= 1 ? 'var(--green)' : 'var(--dim)';
  if (sk === 'bb')  return v >= 2 ? 'var(--green)' : v === 1 ? 'var(--gold)' : 'var(--dim)';
  return v === 0 ? 'var(--orange)' : v === 1 ? 'var(--cyan)' : 'var(--green)';
};

function GameLogChart({ games, stats, defaultStat, emptyLabel = 'NO GAMES', accent = 'var(--cyan)', chartHeight = 130, maxBarW = 64, colorFor = defaultStatColorFor }) {
  const [statKey, setStatKey] = React.useState(defaultStat || stats[0].key);
  if (!games?.length) {
    return <div style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', padding: '16px 0', letterSpacing: '0.1em' }}>{emptyLabel}</div>;
  }

  const vals = games.map(g => Number(g[statKey] || 0));
  const maxVal = Math.max(...vals, 1);
  const barColor = v => colorFor(v, statKey);

  const total = vals.reduce((a, b) => a + b, 0);
  const high = Math.max(...vals);
  const low = Math.min(...vals);
  const avg = total / vals.length;

  const hasWeather = games.some(g => g.weather);

  // Each cell column (bar + opp/date + weather) shares `flex: 1` so columns
  // distribute evenly across the card width. maxBarW caps bar width on wide
  // screens so a 5-game chart doesn't look like giant columns on desktop.
  const Cell = ({ g, children }) => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 0 }}>
      {children}
    </div>
  );

  return (
    <div>
      {/* Stat toggles */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.14em', alignSelf: 'center', marginRight: 4 }}>STAT</span>
        {stats.map(s => (
          <button key={s.key} onClick={() => setStatKey(s.key)}
            style={{ padding: '5px 11px', background: statKey === s.key ? `${accent}18` : 'transparent',
              border: `1px solid ${statKey === s.key ? accent : 'rgba(255,255,255,0.06)'}`,
              color: statKey === s.key ? accent : 'var(--muted)', fontFamily: 'Space Mono, monospace',
              fontSize: 10, cursor: 'pointer', borderRadius: 2, letterSpacing: '0.08em', fontWeight: 700 }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Bars row — flex cells, each bar rendered as a div with percentage fill */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', padding: '0 4px' }}>
        {games.map((g, i) => {
          const v = Number(g[statKey] || 0);
          const pct = Math.min(v / maxVal, 1) * 100;
          const color = barColor(v);
          return (
            <Cell key={i} g={g}>
              {/* Value label */}
              <div style={{ fontSize: 11, fontFamily: 'Space Mono, monospace', color, fontWeight: 700, height: 14, lineHeight: 1 }}>
                {v}
              </div>
              {/* Bar track + fill */}
              <div style={{ width: '100%', maxWidth: maxBarW, height: chartHeight,
                background: 'rgba(255,255,255,0.03)', borderRadius: 4, position: 'relative', overflow: 'hidden',
                border: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${pct}%`, background: color,
                  boxShadow: `0 0 8px ${color}88, inset 0 0 8px ${color}22`, borderRadius: 3,
                  transition: 'height 0.45s cubic-bezier(0.16,1,0.3,1)' }} />
              </div>
            </Cell>
          );
        })}
      </div>

      {/* Opponent + date labels */}
      <div style={{ display: 'flex', gap: 16, marginTop: 8, padding: '0 4px' }}>
        {games.map((g, i) => (
          <Cell key={i} g={g}>
            <div style={{ fontFamily: 'Space Mono, monospace', fontSize: 10, color: 'var(--muted)', textAlign: 'center', letterSpacing: '0.05em' }}>
              {g.home ? 'vs' : '@'}{g.opp || '?'}
            </div>
            <div style={{ fontFamily: 'Space Mono, monospace', fontSize: 9, color: 'var(--dim)', textAlign: 'center', marginTop: -4 }}>
              {g.date}
            </div>
          </Cell>
        ))}
      </div>

      {/* Weather row */}
      {hasWeather && (
        <div style={{ display: 'flex', gap: 16, marginTop: 10, padding: '0 4px' }}>
          {games.map((g, i) => (
            <Cell key={i} g={g}>
              <div style={{ width: '100%', maxWidth: maxBarW, padding: '6px 4px', textAlign: 'center',
                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: 2,
                fontFamily: 'Space Mono, monospace' }}>
                {g.weather ? (
                  <>
                    <div style={{ fontSize: 11, color: 'var(--text)', fontWeight: 700 }}>{g.weather.temp != null ? `${g.weather.temp}°` : '—'}</div>
                    <div style={{ fontSize: 8, color: 'var(--dim)', marginTop: 2 }}>{g.weather.wind || '—'}</div>
                  </>
                ) : <div style={{ fontSize: 9, color: 'var(--dim)' }}>—</div>}
              </div>
            </Cell>
          ))}
        </div>
      )}

      {/* Summary row */}
      <div style={{ display: 'flex', gap: 28, marginTop: 16, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.04)', flexWrap: 'wrap' }}>
        {[['AVG', avg.toFixed(1)], ['TOTAL', total], ['HIGH', high], ['LOW', low]].map(([l, v]) => (
          <div key={l}>
            <div style={{ fontSize: 8, color: 'var(--dim)', fontFamily: 'Space Mono, monospace', letterSpacing: '0.14em', marginBottom: 2 }}>{l}</div>
            <div style={{ fontSize: 16, fontFamily: 'Orbitron, monospace',
              color: l === 'HIGH' ? 'var(--green)' : l === 'LOW' ? 'var(--orange)' : accent, fontWeight: 700 }}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Export ──────────────────────────────────────────── */
Object.assign(window, {
  HudCard, StatusBadge, Loader, StatBar, Sparkline, OpsGauge,
  PlayerCard, SvgBarChart, DualStatBar, WeatherPill, SectionHeader,
  OddsStrip, FormDots, GameLogChart,
});
