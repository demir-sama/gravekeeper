import { useAppApi } from '@kirocrew/app-sdk'
import { PageHeader } from '@kirocrew/app-sdk/ui'
import { useCallback, useEffect, useState } from 'react'

type Snapshot = { timestamp: string; url: string; beforeCite: boolean } | null
type Grave = { url: string; cls: 'tombstone' | 'ghost' | 'zombie'; snapshot: Snapshot; where: string[] }
type Counts = Record<'living' | 'tombstone' | 'ghost' | 'drifted' | 'zombie' | 'restless' | 'sealed' | 'total', number>
type Latest = { repo: string; at: string; health: number; counts: Counts; reportUrl: string | null; graves: Grave[] }
type RepoRow = { repo: string; latest: Latest | null; history: { at: string; health: number }[] }
type Walks = { lychgate: string | null; repos: RepoRow[] }

const CLS_LABEL: Record<Grave['cls'], string> = { tombstone: 'Tombstone', ghost: 'Ghost', zombie: 'Zombie' }
const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

const CSS = `
.gk { --ink:#ece7dc; --dim:#a9a5b8; --bg:#14162a; --card:#1c1f38; --line:#343859; --lantern:#f5b94a; --ok:#7fd17a; --warn:#f0b64a; --bad:#ff7b6b;
  color:var(--ink); background:var(--bg); border-radius:14px; padding:20px; font-size:14px; line-height:1.5 }
.gk a { color:var(--lantern); text-underline-offset:3px }
.gk a:focus-visible, .gk summary:focus-visible, .gk button:focus-visible { outline:3px solid var(--lantern); outline-offset:3px; border-radius:4px }
.gk-intro { color:var(--dim); margin:0 0 18px; max-width:62ch }
.gk-lantern { display:inline-block; animation:gk-flicker 4s ease-in-out infinite }
@media (prefers-reduced-motion: reduce) { .gk-lantern { animation:none } }
@keyframes gk-flicker { 0%,100% { opacity:1 } 45% { opacity:.82 } 60% { opacity:.95 } }
.gk-grid { display:grid; gap:16px; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); list-style:none; margin:0; padding:0 }
.gk-card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; height:100% }
.gk-card h2 { font-size:16px; margin:0 0 2px; font-weight:600; overflow-wrap:anywhere }
.gk-card h2 a { color:var(--ink) }
.gk-meta { color:var(--dim); font-size:12px; margin:0 0 12px }
.gk-row { display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin-bottom:12px }
.gk-score { font-size:34px; font-weight:700; line-height:1; font-variant-numeric:tabular-nums }
.gk-score small { font-size:12px; font-weight:500; color:var(--dim); margin-left:4px }
.gk-mood { font-weight:600 }
.gk-ok { color:var(--ok) } .gk-warn { color:var(--warn) } .gk-bad { color:var(--bad) }
.gk-trend { color:var(--dim); font-size:12px }
.gk-counts { display:grid; grid-template-columns:repeat(3,1fr); gap:6px 12px; margin:0 0 12px }
.gk-counts div { display:flex; justify-content:space-between; border-bottom:1px dashed var(--line); padding-bottom:2px }
.gk-counts dt { color:var(--dim) } .gk-counts dd { margin:0; font-variant-numeric:tabular-nums; font-weight:600 }
.gk-card details { margin-top:10px }
.gk-card summary { cursor:pointer; padding:4px 0 }
.gk-graves { list-style:none; margin:8px 0 0; padding:0; display:grid; gap:10px }
.gk-graves li { border-left:3px solid var(--bad); padding-left:10px }
.gk-url { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; overflow-wrap:anywhere }
.gk-tag { font-size:11px; letter-spacing:.04em; text-transform:uppercase; color:var(--bad); font-weight:700 }
.gk-empty, .gk-error { background:var(--card); border:1px dashed var(--line); border-radius:12px; padding:18px }
.gk-btn { background:transparent; color:var(--ink); border:1px solid var(--lantern); border-radius:8px; padding:6px 12px; cursor:pointer }
.gk-btn:hover { background:rgba(245,185,74,.14) }
`

const mood = (h: number) => (h >= 85 ? { word: 'Peaceful', cls: 'gk-ok' } : h >= 60 ? { word: 'Uneasy', cls: 'gk-warn' } : { word: 'Haunted', cls: 'gk-bad' })
const day = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
const snapDay = (ts: string) => (/^\d{8}/.test(ts) ? `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}` : ts)
const isHttps = (u: string) => {
  try {
    return new URL(u).protocol === 'https:'
  } catch {
    return false
  }
}

function Sparkline({ points }: { points: number[] }) {
  const W = 120
  const H = 34
  const label = points.length ? `Health trend over ${points.length} walk${points.length === 1 ? '' : 's'}: ${points.join(', ')}` : 'No health history yet'
  const x = (i: number) => (points.length === 1 ? W / 2 : 4 + (i * (W - 8)) / (points.length - 1))
  const y = (v: number) => 4 + ((100 - Math.max(0, Math.min(100, v))) * (H - 8)) / 100
  const path = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const last = points.length - 1
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <title>{label}</title>
      <line x1="0" x2={W} y1={y(85)} y2={y(85)} stroke="#343859" strokeDasharray="3 3" />
      {points.length > 1 && <path d={path} fill="none" stroke="#f5b94a" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
      {points.length > 0 && <circle cx={x(last)} cy={y(points[last])} r="3.5" fill="#f5b94a" />}
    </svg>
  )
}

function trendText(points: number[]) {
  if (points.length < 2) return points.length ? 'First walk, nothing to compare yet' : ''
  const d = points[points.length - 1] - points[points.length - 2]
  if (d === 0) return 'Unchanged since the previous walk'
  return d > 0 ? `Up ${d} since the previous walk` : `Down ${-d} since the previous walk`
}

function RepoCard({ row, lychgate }: { row: RepoRow; lychgate: string | null }) {
  const { latest } = row
  const id = `gk-${row.repo.replace(/[^A-Za-z0-9]/g, '-')}`
  const points = row.history.map((h) => h.health)
  const reportOk = !!(latest?.reportUrl && lychgate && latest.reportUrl.startsWith(`${lychgate}/r/`) && isHttps(latest.reportUrl))
  return (
    <li>
      <article className="gk-card" aria-labelledby={id}>
        <h2 id={id}>
          {REPO_RE.test(row.repo) ? (
            <a href={`https://github.com/${row.repo}`} target="_blank" rel="noopener noreferrer">
              {row.repo}
            </a>
          ) : (
            row.repo
          )}
        </h2>
        {!latest ? (
          <p className="gk-meta">Not walked yet. The next walk will give this grave a first reading.</p>
        ) : (
          <>
            <p className="gk-meta">Last walked {day(latest.at)}</p>
            <div className="gk-row">
              <div className="gk-score">
                <span className={mood(latest.health).cls}>{latest.health}</span>
                <small>/ 100 health</small>
              </div>
              <div>
                <div className={`gk-mood ${mood(latest.health).cls}`}>{mood(latest.health).word}</div>
                <div className="gk-trend">{trendText(points)}</div>
              </div>
              <Sparkline points={points} />
            </div>
            <dl className="gk-counts">
              <div><dt>Living</dt><dd>{latest.counts.living}</dd></div>
              <div><dt>Tombstone</dt><dd>{latest.counts.tombstone}</dd></div>
              <div><dt>Ghost</dt><dd>{latest.counts.ghost}</dd></div>
              <div><dt>Zombie</dt><dd>{latest.counts.zombie}</dd></div>
              <div><dt>Drifted</dt><dd>{latest.counts.drifted}</dd></div>
              <div><dt>Links</dt><dd>{latest.counts.total}</dd></div>
            </dl>
            {reportOk ? (
              <a href={latest.reportUrl!} target="_blank" rel="noopener noreferrer">
                Open the shared Lychgate report<span className="sr-only"> for {row.repo} (opens in a new tab)</span>
              </a>
            ) : (
              <span className="gk-meta">No shared report for the last walk.</span>
            )}
            {latest.graves.length > 0 && (
              <details>
                <summary>
                  {latest.graves.length} grave{latest.graves.length === 1 ? '' : 's'}
                </summary>
                <ul className="gk-graves">
                  {latest.graves.map((g) => (
                    <li key={g.url}>
                      <span className="gk-tag">{CLS_LABEL[g.cls] ?? g.cls}</span>
                      <div className="gk-url">{g.url}</div>
                      {g.where.length > 0 && <div className="gk-meta">Cited at {g.where.join(', ')}</div>}
                      {g.snapshot && isHttps(g.snapshot.url) && (
                        <a href={g.snapshot.url} target="_blank" rel="noopener noreferrer">
                          Wayback snapshot from {snapDay(g.snapshot.timestamp)}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </article>
    </li>
  )
}

export default function Gravekeeper() {
  const api = useAppApi()
  const [data, setData] = useState<Walks | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api
      .get<Walks>('/apps/gravekeeper/api/walks')
      .then((d: Walks) => setData(d))
      .catch((e: Error) => setError(e?.message ?? 'Could not read the walk history'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(load, [load])

  return (
    <>
      <PageHeader title="Gravekeeper" subtitle="Keeper of the docs graveyard: weekly link walks over the repos you watch" />
      <div className="px-6 pb-8 overflow-y-auto flex-1 min-h-0">
        <style>{CSS + '.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}'}</style>
        <div className="gk">
          <p className="gk-intro">
            <span className="gk-lantern" aria-hidden="true">🏮 </span>
            Once a week the keeper walks each watched repo with the Lychgate scanner. Graves are links that are gone (Tombstone), lead nowhere real (Ghost) or answer with something else (Zombie).
          </p>
          {loading && <p role="status">Lighting the lantern…</p>}
          {error && (
            <div className="gk-error" role="alert">
              <p>The keeper could not read the walk history: {error}</p>
              <button className="gk-btn" onClick={load}>Try again</button>
            </div>
          )}
          {!loading && !error && data && data.repos.length === 0 && (
            <div className="gk-empty">
              <p>No repos are watched yet. Add <code>owner/repo</code> entries to <code>watchlist.json</code> in the app folder.</p>
            </div>
          )}
          {!error && data && data.repos.length > 0 && (
            <ul className="gk-grid" aria-label="Watched repos">
              {data.repos.map((row) => (
                <RepoCard key={row.repo} row={row} lychgate={data.lychgate} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}
