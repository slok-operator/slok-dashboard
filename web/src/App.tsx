import { useEffect, useId, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { getSLO, getSLOTimeseries, listSLOs } from './api'
import type { SLODetail, SLOSummary, SLOTimeseriesResponse, TimeseriesPoint } from './types'

type Filter = 'all' | 'healthy' | 'warning' | 'critical' | 'other'
type TrendRange = '4w' | '1w' | '1d' | '12h' | '1h'
type TrendRangeMode = TrendRange | 'custom'
type CustomRangeUnit = 'm' | 'h' | 'd' | 'w'
type View = 'list' | 'trend'

const TREND_PRESETS: Record<TrendRange, { range: string; step: string; label: string; subtitle: string }> = {
  '4w': { range: '4w', step: '1d', label: '4w', subtitle: 'Four weeks' },
  '1w': { range: '1w', step: '6h', label: '1w', subtitle: 'One week' },
  '1d': { range: '1d', step: '1h', label: '1d', subtitle: 'One day' },
  '12h': { range: '12h', step: '30m', label: '12h', subtitle: 'Twelve hours' },
  '1h': { range: '1h', step: '5m', label: '1h', subtitle: 'One hour' },
}

const TREND_RANGE_ORDER: TrendRange[] = ['4w', '1w', '1d', '12h', '1h']
const CUSTOM_RANGE_UNITS: CustomRangeUnit[] = ['m', 'h', 'd', 'w']

const percentFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 2,
})

const numberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
})

function percentLabel(value: number) {
  const normalized = value > 1.5 ? value / 100 : value
  return percentFormatter.format(Number.isFinite(normalized) ? normalized : 0)
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function statusKey(status: string): Filter {
  const value = normalize(status)

  if (['met', 'healthy', 'ok', 'passing', 'true'].some((token) => value === token || value.includes(token))) {
    return 'healthy'
  }
  if (['warning', 'warn', 'degraded', 'degrad'].some((token) => value === token || value.includes(token))) {
    return 'warning'
  }
  if (['critical', 'crit', 'violated', 'violate', 'failed', 'fail', 'error', 'false'].some((token) => value === token || value.includes(token))) {
    return 'critical'
  }

  return 'other'
}

function statusTone(status: string) {
  switch (statusKey(status)) {
    case 'healthy':
      return 'good'
    case 'warning':
      return 'warning'
    case 'critical':
      return 'danger'
    default:
      return 'neutral'
  }
}

function formatTarget(value: number) {
  return percentLabel(value)
}

function formatBurnRate(value: number) {
  return `${numberFormatter.format(value)}x`
}

function matchesSearch(item: SLOSummary, query: string) {
  if (!query) return true

  const normalizedQuery = normalize(query)
  const haystack = [
    item.name,
    item.displayName,
    item.namespace,
    item.status,
    ...(item.labels ? Object.entries(item.labels).flat() : []),
  ]
    .map((piece) => normalize(piece))
    .join(' ')

  return haystack.includes(normalizedQuery)
}

function lastPoint<T>(points?: T[]) {
  return points && points.length ? points[points.length - 1] : undefined
}


function trendRangeToMilliseconds(range: string) {
  const match = range.match(/^(\d+)([mhdw])$/)
  if (!match) return 60 * 60 * 1000

  const amount = Number(match[1])
  const unit = match[2]
  const multipliers: Record<string, number> = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  }

  return amount * multipliers[unit]
}

function stepForRange(range: string) {
  const duration = trendRangeToMilliseconds(range)
  const targetPoints = 120
  const rawStepSeconds = Math.max(60, Math.round(duration / targetPoints / 1000))
  const candidates = [60, 300, 900, 1800, 3600, 21600, 86400]
  const selected = candidates.find((candidate) => candidate >= rawStepSeconds) ?? candidates[candidates.length - 1]

  if (selected % 86400 === 0) return `${selected / 86400}d`
  if (selected % 3600 === 0) return `${selected / 3600}h`
  if (selected % 60 === 0) return `${selected / 60}m`
  return `${selected}s`
}

function customRangeValue(amount: number, unit: CustomRangeUnit) {
  const safeAmount = clamp(Math.floor(amount), 1, unit === 'm' ? 1440 : unit === 'h' ? 720 : unit === 'd' ? 365 : 52)
  return `${safeAmount}${unit}`
}

function evenlySpacedTimes(start: number, end: number, count: number) {
  return Array.from({ length: count }, (_, index) => start + ((end - start) * index) / Math.max(count - 1, 1))
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function trendTickLabel(timestamp: string | number, range: string) {
  const date = new Date(timestamp)
  if (range.includes('w')) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function App() {
  const [view, setView] = useState<View>('list')
  const [items, setItems] = useState<SLOSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [namespaceFilter, setNamespaceFilter] = useState('all')
  const [selected, setSelected] = useState<SLOSummary | null>(null)
  const [detail, setDetail] = useState<SLODetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [timeseries, setTimeseries] = useState<SLOTimeseriesResponse | null>(null)
  const [timeseriesLoading, setTimeseriesLoading] = useState(false)
  const [timeseriesError, setTimeseriesError] = useState<string | null>(null)
  const [trendRangeMode, setTrendRangeMode] = useState<TrendRangeMode>('1w')
  const [customRangeAmount, setCustomRangeAmount] = useState(3)
  const [customRangeUnit, setCustomRangeUnit] = useState<CustomRangeUnit>('h')

  useEffect(() => {
    let active = true
    setLoading(true)

    listSLOs()
      .then((response) => {
        if (!active) return
        setItems(response.items)
        setSelected((current) => current ?? response.items[0] ?? null)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Failed to load SLOs')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!selected) {
      setDetail(null)
      setDetailError(null)
      setDetailLoading(false)
      return
    }

    const controller = new AbortController()
    setDetailLoading(true)
    setDetailError(null)

    getSLO(selected.namespace, selected.name)
      .then((response) => setDetail(response))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setDetailError(err instanceof Error ? err.message : 'Failed to load detail')
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false)
      })

    return () => controller.abort()
  }, [selected])

  useEffect(() => {
    if (view !== 'trend' || !selected) {
      setTimeseriesLoading(false)
      return
    }

    const controller = new AbortController()
    const range = trendRangeMode === 'custom' ? customRangeValue(customRangeAmount, customRangeUnit) : TREND_PRESETS[trendRangeMode].range
    const step = trendRangeMode === 'custom' ? stepForRange(range) : TREND_PRESETS[trendRangeMode].step

    setTimeseriesLoading(true)
    setTimeseriesError(null)

    getSLOTimeseries(selected.namespace, selected.name, range, step)
      .then((response) => {
        if (!controller.signal.aborted) setTimeseries(response)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setTimeseries(null)
        setTimeseriesError(err instanceof Error ? err.message : 'Failed to load SLO trend')
      })
      .finally(() => {
        if (!controller.signal.aborted) setTimeseriesLoading(false)
      })

    return () => controller.abort()
  }, [selected, trendRangeMode, customRangeAmount, customRangeUnit, view])

  const namespaces = useMemo(() => Array.from(new Set(items.map((item) => item.namespace))).sort(), [items])

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchFilter = filter === 'all' || statusKey(item.status) === filter
      const matchNamespace = namespaceFilter === 'all' || item.namespace === namespaceFilter
      return matchFilter && matchNamespace && matchesSearch(item, query)
    })
  }, [items, filter, namespaceFilter, query])

  const selectedTrendRange = trendRangeMode === 'custom' ? customRangeValue(customRangeAmount, customRangeUnit) : TREND_PRESETS[trendRangeMode].range
  const selectedTrendStep = trendRangeMode === 'custom' ? stepForRange(selectedTrendRange) : TREND_PRESETS[trendRangeMode].step
  const availabilitySeries = timeseries?.series.availability ?? []
  const targetSeries = timeseries?.series.target ?? []
  const errorBudgetSeries = timeseries?.series.errorBudget ?? []
  const burnRateSeries = timeseries?.series.burnRate ?? []
  const tooltipSeries = [
    { label: 'Availability', series: availabilitySeries, suffix: '%' },
    { label: 'Target', series: targetSeries, suffix: '%' },
    { label: 'Error budget', series: errorBudgetSeries, suffix: '%' },
    { label: 'Burn rate', series: burnRateSeries, suffix: 'x' },
  ]

  if (view === 'trend') {
    return (
      <div className="app-shell trend-shell">
        <div className="backdrop backdrop-a" />
        <div className="backdrop backdrop-b" />

        <main className="trend-page">
          <header className="trend-header card">
            <div className="trend-header-left">
              <button type="button" className="back-button" onClick={() => setView('list')}>
                ← Back
              </button>
              <div>
                <p className="eyebrow">Trend view</p>
                <h1>{selected?.displayName || selected?.name || 'Select an SLO'}</h1>
                {selected ? <p className="muted">{selected.namespace} · {selected.name}</p> : null}
              </div>
            </div>
            <div className="trend-header-meta">
              {selected ? <StatusBadge status={selected.status} /> : null}
              {selected ? <span className="pill">Target {formatTarget(selected.target)}</span> : null}
              {selected ? <span className="pill">Actual {formatTarget(selected.actual)}</span> : null}
              {selected ? <span className="pill">Budget {percentLabel(selected.errorBudget.percentRemaining)}</span> : null}
            </div>
          </header>

          <section className="card trend-hero">
            <div className="trend-toolbar trend-toolbar-wide">
              <div className="trend-copy">
                <p className="eyebrow">Timeseries</p>
                <h2>Expanded SLO trend</h2>
                <p className="muted">A full-screen view focused on one SLO, with a large time axis and faster range switching.</p>
              </div>
              <div className="trend-range-selector" role="tablist" aria-label="SLO trend range selector">
                {TREND_RANGE_ORDER.map((item) => {
                  const preset = TREND_PRESETS[item]
                  return (
                    <button
                      key={item}
                      type="button"
                      className={`trend-range-button ${trendRangeMode === item ? 'active' : ''}`}
                      onClick={() => setTrendRangeMode(item)}
                    >
                      <span>{preset.label}</span>
                      <small>{preset.subtitle}</small>
                    </button>
                  )
                })}
                <div className={`custom-range-control ${trendRangeMode === 'custom' ? 'active' : ''}`}>
                  <button type="button" className="trend-range-button custom-range-toggle" onClick={() => setTrendRangeMode('custom')}>
                    <span>Custom</span>
                    <small>{customRangeValue(customRangeAmount, customRangeUnit)}</small>
                  </button>
                  <div className="custom-range-fields">
                    <input
                      aria-label="Custom range amount"
                      min="1"
                      type="number"
                      value={customRangeAmount}
                      onChange={(event) => {
                        setCustomRangeAmount(Number(event.target.value) || 1)
                        setTrendRangeMode('custom')
                      }}
                    />
                    <select
                      aria-label="Custom range unit"
                      value={customRangeUnit}
                      onChange={(event) => {
                        setCustomRangeUnit(event.target.value as CustomRangeUnit)
                        setTrendRangeMode('custom')
                      }}
                    >
                      {CUSTOM_RANGE_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div className="trend-metrics">
              <TrendMetric label="Availability" value={lastPoint(availabilitySeries)?.value} suffix="%" tone="accent" />
              <TrendMetric label="Error budget" value={lastPoint(errorBudgetSeries)?.value} suffix="%" tone="gold" />
              <TrendMetric label="Range" value={selectedTrendRange} tone="neutral" />
            </div>

            {timeseriesLoading ? (
              <div className="trend-state">
                <strong>Loading trend…</strong>
                <p>Querying Prometheus for the selected range.</p>
              </div>
            ) : timeseriesError ? (
              <div className="trend-state error">
                <strong>Trend unavailable</strong>
                <p>{timeseriesError}</p>
              </div>
            ) : !selected ? (
              <div className="trend-state">
                <strong>No selection</strong>
                <p>Choose an SLO from the list to inspect its trend.</p>
              </div>
            ) : availabilitySeries.length ? (
              <div className="trend-charts-grid">
                <SloTrendChart
                  title="Availability"
                  valueLabel="Current"
                  availability={availabilitySeries}
                  target={targetSeries}
                  targetLabel="Target"
                  range={selectedTrendRange}
                  step={timeseries?.step ?? selectedTrendStep}
                  height={360}
                  tooltipItems={tooltipSeries}
                />
                {errorBudgetSeries.length ? (
                  <SloTrendChart
                    title="Error budget remaining"
                    valueLabel="Remaining"
                    availability={errorBudgetSeries}
                    target={[]}
                    range={selectedTrendRange}
                    step={timeseries?.step ?? selectedTrendStep}
                    height={320}
                    fixedPercentDomain
                    tooltipItems={tooltipSeries}
                  />
                ) : (
                  <div className="trend-state trend-state-compact">
                    <strong>Error budget unavailable</strong>
                    <p>Prometheus returned no 30d burn-rate samples for this SLO.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="trend-state">
                <strong>No trend data</strong>
                <p>Prometheus returned no samples for this SLO and range.</p>
              </div>
            )}
          </section>
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <div className="backdrop backdrop-a" />
      <div className="backdrop backdrop-b" />

      <header className="topbar">
        <div>
          <p className="eyebrow">Slok Dashboard</p>
          <h1>SLO inventory, stripped to the essentials.</h1>
          <p className="muted">Search by name, namespace, label or status. Open a row to inspect details, then jump to the trend when needed.</p>
        </div>
        <div className="topbar-actions">
          <span className="pill pill-success">Live API</span>
          <span className="pill">{items.length} SLOs</span>
        </div>
      </header>

      <main className="content list-page">
        <section className="card controls">
          <div className="controls-grid">
            <label className="search search-wide">
              <span>Search</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name, namespace, label, status…"
              />
            </label>

            <label className="select-field">
              <span>Namespace</span>
              <select value={namespaceFilter} onChange={(event) => setNamespaceFilter(event.target.value)}>
                <option value="all">All namespaces</option>
                {namespaces.map((namespace) => (
                  <option key={namespace} value={namespace}>{namespace}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="filter-row" role="tablist" aria-label="SLO status filter">
            {(['all', 'healthy', 'warning', 'critical', 'other'] as Filter[]).map((item) => (
              <button
                key={item}
                type="button"
                className={`chip ${filter === item ? 'active' : ''}`}
                onClick={() => setFilter(item)}
              >
                {item}
              </button>
            ))}
          </div>

          <div className="meta-row">
            <span>{filteredItems.length} matching</span>
            <span>{namespaces.length} namespaces</span>
          </div>
        </section>

        <section className="layout">
          <section className="card table-card">
            <div className="section-head">
              <div>
                <p className="eyebrow">Portfolio</p>
                <h2>SLO list</h2>
              </div>
              {loading ? <span className="muted">Loading…</span> : <span className="muted">{filteredItems.length} visible</span>}
            </div>

            {error ? (
              <div className="empty-state error">
                <strong>Unable to load SLOs</strong>
                <p>{error}</p>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="empty-state">
                <strong>No SLOs found</strong>
                <p>Try another search, namespace or status filter.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>SLO</th>
                      <th>Namespace</th>
                      <th>Status</th>
                      <th>Target</th>
                      <th>Actual</th>
                      <th>Budget</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((item) => (
                      <tr
                        key={`${item.namespace}/${item.name}`}
                        className={selected?.name === item.name && selected?.namespace === item.namespace ? 'selected' : ''}
                      >
                        <td data-label="SLO">
                          <button type="button" className="row-button" onClick={() => setSelected(item)}>
                            <strong>{item.displayName || item.name}</strong>
                            <span>{item.name}</span>
                          </button>
                        </td>
                        <td data-label="Namespace">{item.namespace}</td>
                        <td data-label="Status"><StatusBadge status={item.status} /></td>
                        <td data-label="Target">{formatTarget(item.target)}</td>
                        <td data-label="Actual">{formatTarget(item.actual)}</td>
                        <td data-label="Budget">{percentLabel(item.errorBudget.percentRemaining)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <aside className="card detail-card">
            <div className="section-head detail-head">
              <div>
                <p className="eyebrow">Details</p>
                <h2>{selected?.displayName || 'Select an SLO'}</h2>
              </div>
              <div className="detail-head-actions">
                {selected ? <StatusBadge status={selected.status} /> : null}
                <button type="button" className="primary-button" onClick={() => setView('trend')} disabled={!selected}>
                  Show trend
                </button>
              </div>
            </div>

            {!selected ? (
              <div className="empty-state">
                <strong>No selection</strong>
                <p>Click a row to inspect the SLO details and open the trend view.</p>
              </div>
            ) : detailLoading ? (
              <div className="empty-state">
                <strong>Loading detail…</strong>
                <p>Fetching spec for {selected.namespace}/{selected.name}</p>
              </div>
            ) : detailError ? (
              <div className="empty-state error">
                <strong>Detail unavailable</strong>
                <p>{detailError}</p>
              </div>
            ) : detail ? (
              <div className="detail-stack">
                <div className="detail-grid">
                  <Stat label="Namespace" value={detail.namespace} />
                  <Stat label="Window" value={detail.window} />
                  <Stat label="Target" value={formatTarget(detail.target)} />
                  <Stat label="Actual" value={formatTarget(detail.actual)} />
                  <Stat label="Budget left" value={percentLabel(detail.errorBudget.percentRemaining)} />
                  <Stat label="Prometheus rule" value={detail.prometheusRule.exists ? 'Present' : 'Missing'} tone={detail.prometheusRule.exists ? 'good' : 'warning'} />
                </div>

                {detail.burnRates?.length ? (
                  <section>
                    <h3>Burn rates</h3>
                    <div className="mini-grid">
                      {detail.burnRates.map((burnRate) => (
                        <article key={`${burnRate.shortWindow}-${burnRate.longWindow}`} className="mini-card">
                          <span>{burnRate.shortWindow} / {burnRate.longWindow}</span>
                          <strong>{formatBurnRate(burnRate.shortBurnRate)} · {formatBurnRate(burnRate.longBurnRate)}</strong>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}

                {detail.conditions?.length ? (
                  <section>
                    <h3>Conditions</h3>
                    <div className="stack">
                      {detail.conditions.map((condition) => (
                        <article key={`${condition.type}-${condition.status}`} className="condition">
                          <div className="condition-head">
                            <strong>{condition.type}</strong>
                            <StatusBadge status={condition.status} />
                          </div>
                          {condition.reason ? <p>{condition.reason}</p> : null}
                          {condition.message ? <p className="muted">{condition.message}</p> : null}
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}

                <section>
                  <h3>Objective</h3>
                  <div className="stack">
                    <article className="info-block">
                      <strong>{detail.spec.objective.name}</strong>
                      <p>{detail.spec.objective.window} · target {formatTarget(detail.spec.objective.target)}</p>
                    </article>
                    {detail.spec.objective.sli.query ? (
                      <article className="info-block code-block">
                        <strong>Queries</strong>
                        <code>Total: {detail.spec.objective.sli.query.totalQuery}</code>
                        <code>Error: {detail.spec.objective.sli.query.errorQuery}</code>
                      </article>
                    ) : null}
                    {detail.spec.objective.sli.template ? (
                      <article className="info-block">
                        <strong>Template</strong>
                        <p>{detail.spec.objective.sli.template.name}</p>
                      </article>
                    ) : null}
                  </div>
                </section>

                {detail.labels && Object.keys(detail.labels).length ? (
                  <section>
                    <h3>Labels</h3>
                    <div className="label-row">
                      {Object.entries(detail.labels).map(([key, value]) => (
                        <span key={key} className="label-chip">
                          {key}={value}
                        </span>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            ) : null}
          </aside>
        </section>
      </main>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`status status-${statusTone(status)}`}>{status || 'Unknown'}</span>
}

function Stat({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'good' | 'warning' }) {
  return (
    <article className={`stat ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function TrendMetric({
  label,
  value,
  suffix = '',
  tone = 'neutral',
}: {
  label: string
  value?: number | string
  suffix?: string
  tone?: 'accent' | 'gold' | 'neutral'
}) {
  return (
    <article className={`trend-metric ${tone}`}>
      <span>{label}</span>
      <strong>{typeof value === 'number' ? `${numberFormatter.format(value)}${suffix}` : value ?? '—'}</strong>
    </article>
  )
}

function SloTrendChart({
  title,
  valueLabel = 'Current',
  availability,
  target,
  targetLabel,
  range,
  step,
  height = 420,
  fixedPercentDomain = false,
  tooltipItems = [],
}: {
  title: string
  valueLabel?: string
  availability: TimeseriesPoint[]
  target: TimeseriesPoint[]
  targetLabel?: string
  range: string
  step: string
  height?: number
  fixedPercentDomain?: boolean
  tooltipItems?: { label: string; series: TimeseriesPoint[]; suffix?: string }[]
}) {
  const chartId = useId().replace(/:/g, '')
  const fillId = `${chartId}-trendFill`
  const strokeId = `${chartId}-trendStroke`
  const clipId = `${chartId}-trendPlotClip`
  const width = 1400
  const padding = { top: 32, right: 36, bottom: 64, left: 76 }
  const [hoveredPoint, setHoveredPoint] = useState<{
    timestamp: string
    items: { label: string; value: number; suffix?: string }[]
    x: number
    y: number
  } | null>(null)
  const [zoomDomain, setZoomDomain] = useState<{ start: number; end: number } | null>(null)
  const [dragSelection, setDragSelection] = useState<{ startX: number; currentX: number } | null>(null)
  const values = [...availability.map((point) => point.value), ...target.map((point) => point.value)]
  const minValue = fixedPercentDomain ? -4 : Math.max(0, Math.min(...values) - 0.5)
  const maxValue = fixedPercentDomain ? 100 : Math.min(100, Math.max(...values) + 0.5)
  const sampleEnd = new Date(availability[availability.length - 1]?.timestamp ?? Date.now()).getTime()
  const baseEnd = sampleEnd
  const baseStart = baseEnd - trendRangeToMilliseconds(range)
  const start = zoomDomain?.start ?? baseStart
  const end = zoomDomain?.end ?? baseEnd
  const span = Math.max(end - start, 1)
  const zoomed = Boolean(zoomDomain)
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom
  const yTicks = 6
  const xTicks = 7

  const x = (timestamp: string) => {
    const value = new Date(timestamp).getTime()
    return padding.left + ((value - start) / span) * plotWidth
  }
  const y = (value: number) => {
    const ratio = (value - minValue) / Math.max(maxValue - minValue, 0.0001)
    return height - padding.bottom - ratio * plotHeight
  }
  const line = (points: TimeseriesPoint[]) => points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.timestamp)} ${y(point.value)}`).join(' ')
  const area = (points: TimeseriesPoint[]) => {
    if (!points.length) return ''
    const startX = x(points[0].timestamp)
    const endX = x(points[points.length - 1].timestamp)
    const baseY = y(minValue)
    const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.timestamp)} ${y(point.value)}`).join(' ')
    return `${path} L ${endX} ${baseY} L ${startX} ${baseY} Z`
  }
  const xTickTimes = evenlySpacedTimes(start, end, xTicks)
  const yTickValues = fixedPercentDomain
    ? Array.from({ length: yTicks }, (_, index) => (100 * index) / Math.max(yTicks - 1, 1))
    : Array.from({ length: yTicks }, (_, index) => minValue + ((maxValue - minValue) * index) / Math.max(yTicks - 1, 1))
  const latest = availability[availability.length - 1]
  const targetPoint = target[target.length - 1]
  const currentValue = latest ? `${numberFormatter.format(latest.value)}%` : '—'
  const targetValue = targetPoint ? `${numberFormatter.format(targetPoint.value)}%` : '—'
  const selectionLeft = dragSelection ? Math.min(dragSelection.startX, dragSelection.currentX) : 0
  const selectionWidth = dragSelection ? Math.abs(dragSelection.currentX - dragSelection.startX) : 0

  useEffect(() => {
    setHoveredPoint(null)
    setZoomDomain(null)
    setDragSelection(null)
  }, [availability, range, step])

  const timeFromChartX = (chartX: number) => {
    const boundedX = clamp(chartX, padding.left, width - padding.right)
    const ratio = (boundedX - padding.left) / Math.max(plotWidth, 1)
    return start + ratio * span
  }

  const chartXFromEvent = (event: ReactMouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const rawX = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * width
    return clamp(rawX, padding.left, width - padding.right)
  }

  const interpolateAt = (series: TimeseriesPoint[], timestamp: number) => {
    if (!series.length) return null

    const points = series
      .map((point) => ({ ...point, time: new Date(point.timestamp).getTime() }))
      .filter((point) => Number.isFinite(point.time))
      .sort((left, right) => left.time - right.time)

    if (!points.length) return null

    if (timestamp <= points[0].time) {
      return { timestamp, value: points[0].value }
    }
    if (timestamp >= points[points.length - 1].time) {
      return { timestamp, value: points[points.length - 1].value }
    }

    const rightIndex = points.findIndex((point) => point.time >= timestamp)
    const right = points[rightIndex]
    const left = points[Math.max(0, rightIndex - 1)]
    const ratio = (timestamp - left.time) / Math.max(right.time - left.time, 1)
    return {
      timestamp,
      value: left.value + (right.value - left.value) * ratio,
    }
  }

  const handleMouseMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (!availability.length) return

    const cursorX = chartXFromEvent(event)
    const cursorTime = timeFromChartX(cursorX)
    const interpolated = interpolateAt(availability, cursorTime)

    if (dragSelection) {
      setDragSelection((current) => current ? { ...current, currentX: cursorX } : null)
    }

    if (!interpolated) return

    setHoveredPoint({
      timestamp: new Date(interpolated.timestamp).toISOString(),
      items: (tooltipItems.length ? tooltipItems : [{ label: valueLabel, series: availability, suffix: '%' }])
        .flatMap((item) => {
          const value = interpolateAt(item.series, cursorTime)?.value
          return typeof value === 'number' ? [{ label: item.label, value, suffix: item.suffix }] : []
        }),
      x: cursorX,
      y: y(interpolated.value),
    })
  }

  const handleMouseDown = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (!availability.length) return
    const cursorX = chartXFromEvent(event)
    setDragSelection({ startX: cursorX, currentX: cursorX })
  }

  const handleMouseUp = () => {
    if (!dragSelection) return

    const leftX = Math.min(dragSelection.startX, dragSelection.currentX)
    const rightX = Math.max(dragSelection.startX, dragSelection.currentX)
    setDragSelection(null)

    if (rightX - leftX < 12) return

    const nextStart = timeFromChartX(leftX)
    const nextEnd = timeFromChartX(rightX)
    if (nextEnd - nextStart < 1000) return

    setZoomDomain({ start: nextStart, end: nextEnd })
    setHoveredPoint(null)
  }

  return (
    <div className="trend-chart-shell trend-chart-shell-large">
      <div className="trend-chart-title">
        <h3>{title}</h3>
      </div>
      <div className="trend-chart-meta">
        <span>{zoomed ? 'Custom zoom' : `Last ${range}`}</span>
        <span>Step {step}</span>
        {zoomed ? (
          <button type="button" className="chart-reset-button" onClick={() => setZoomDomain(null)}>
            Reset zoom
          </button>
        ) : (
          <span className="chart-help">Drag to zoom</span>
        )}
      </div>
      <div className="trend-chart-canvas">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`SLO ${title} trend`}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            setHoveredPoint(null)
            setDragSelection(null)
          }}
        >
          <defs>
            <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="rgba(34, 211, 238, 0.32)" />
              <stop offset="100%" stopColor="rgba(34, 211, 238, 0.02)" />
            </linearGradient>
            <linearGradient id={strokeId} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#22d3ee" />
              <stop offset="100%" stopColor="#8b5cf6" />
            </linearGradient>
            <clipPath id={clipId}>
              <rect x={padding.left - 8} y={padding.top - 8} width={plotWidth + 16} height={plotHeight + 16} />
            </clipPath>
          </defs>
          {yTickValues.map((tick) => (
            <g key={tick}>
              <line className="chart-grid" x1={padding.left} x2={width - padding.right} y1={y(tick)} y2={y(tick)} />
              <text className="chart-label" x="16" y={y(tick) + 4}>{numberFormatter.format(tick)}%</text>
            </g>
          ))}
          {xTickTimes.map((tickTime) => {
            const tick = new Date(tickTime).toISOString()
            return (
              <g key={tickTime}>
                <line className="chart-grid chart-grid-vertical" x1={x(tick)} x2={x(tick)} y1={padding.top} y2={height - padding.bottom} />
                <text className="chart-label chart-label-x" x={x(tick)} y={height - 18}>{trendTickLabel(tickTime, range)}</text>
              </g>
            )
          })}
          <g clipPath={`url(#${clipId})`}>
            <path className="chart-area chart-area-availability" style={{ fill: `url(#${fillId})` }} d={area(availability)} />
            {target.length ? <path className="chart-line chart-line-target" d={line(target)} /> : null}
            <path className="chart-line chart-line-availability" style={{ stroke: `url(#${strokeId})` }} d={line(availability)} />
            {latest ? <circle className="chart-dot" cx={x(latest.timestamp)} cy={y(latest.value)} r="6" /> : null}
            {targetPoint ? <circle className="chart-dot chart-dot-target" cx={x(targetPoint.timestamp)} cy={y(targetPoint.value)} r="5" /> : null}
          </g>
          {dragSelection && selectionWidth > 2 ? (
            <rect
              className="chart-zoom-selection"
              x={selectionLeft}
              y={padding.top}
              width={selectionWidth}
              height={plotHeight}
            />
          ) : null}
          {hoveredPoint ? (
            <g className="chart-hover-group">
              <line
                className="chart-crosshair"
                x1={hoveredPoint.x}
                x2={hoveredPoint.x}
                y1={padding.top}
                y2={height - padding.bottom}
              />
              <circle className="chart-dot chart-dot-hover" cx={hoveredPoint.x} cy={hoveredPoint.y} r="8" />
              <circle className="chart-dot chart-dot-hover-ring" cx={hoveredPoint.x} cy={hoveredPoint.y} r="15" />
            </g>
          ) : null}
        </svg>

        {hoveredPoint ? (
          <div
            className={`trend-tooltip ${hoveredPoint.y < height * 0.24 ? 'trend-tooltip-below' : 'trend-tooltip-above'}`}
            style={{
              left: `${(clamp(hoveredPoint.x, 140, width - 140) / width) * 100}%`,
              top: `${(hoveredPoint.y / height) * 100}%`,
            }}
          >
            <span className="trend-tooltip-time">{formatDate(hoveredPoint.timestamp)}</span>
            <div className="trend-tooltip-values">
              {hoveredPoint.items.map((item) => (
                <div key={item.label} className="trend-tooltip-row">
                  <span>{item.label}</span>
                  <strong>{`${numberFormatter.format(item.value)}${item.suffix ?? ''}`}</strong>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="trend-footnote">
        <span>{valueLabel} <strong>{currentValue}</strong></span>
        {targetLabel ? <span>{targetLabel} <strong>{targetValue}</strong></span> : null}
        <span>{zoomed ? 'Drag again to zoom deeper' : 'Drag across the plot to zoom'}</span>
      </div>
    </div>
  )
}

export default App
