import { useEffect, useMemo, useState } from 'react'
import { getSLO, listSLOs } from './api'
import type { SLODetail, SLOSummary } from './types'

type Filter = 'all' | 'healthy' | 'warning' | 'critical' | 'other'

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
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
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
  const haystack = [
    item.name,
    item.displayName,
    item.namespace,
    item.status,
    item.window,
    ...(item.labels ? Object.entries(item.labels).flat() : []),
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(query.toLowerCase())
}

function App() {
  const [items, setItems] = useState<SLOSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<SLOSummary | null>(null)
  const [detail, setDetail] = useState<SLODetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

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

  const namespaces = useMemo(() => {
    return Array.from(new Set(items.map((item) => item.namespace))).sort()
  }, [items])

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchFilter = filter === 'all' || statusKey(item.status) === filter
      return matchFilter && matchesSearch(item, query)
    })
  }, [items, filter, query])

  const stats = useMemo(() => {
    const total = filteredItems.length
    const healthy = filteredItems.filter((item) => statusKey(item.status) === 'healthy').length
    const warning = filteredItems.filter((item) => statusKey(item.status) === 'warning').length
    const critical = filteredItems.filter((item) => statusKey(item.status) === 'critical').length
    const averageBudget =
      total > 0
        ? filteredItems.reduce((sum, item) => sum + item.errorBudget.percentRemaining, 0) / total
        : 0

    return { total, healthy, warning, critical, averageBudget }
  }, [filteredItems])

  const selectItem = (item: SLOSummary) => {
    setSelected(item)
  }

  return (
    <div className="app-shell">
      <div className="backdrop backdrop-a" />
      <div className="backdrop backdrop-b" />
      <div className="noise" />

      <header className="topbar">
        <div>
          <p className="eyebrow">Slok Dashboard</p>
          <h1>Service level control, without the noise.</h1>
        </div>
        <div className="topbar-actions">
          <span className="pill pill-success">Live API</span>
          <span className="pill">{items.length} SLOs</span>
        </div>
      </header>

      <main className="content">
        <section className="kpi-grid">
          <KpiCard label="Visible" value={stats.total.toString()} helper="after filters" />
          <KpiCard label="Healthy" value={stats.healthy.toString()} helper="green status" />
          <KpiCard label="Warning" value={stats.warning.toString()} helper="needs attention" />
          <KpiCard label="Budget left" value={percentLabel(stats.averageBudget)} helper="average remaining" />
        </section>

        <section className="controls card">
          <label className="search">
            <span>Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, namespace, label…"
            />
          </label>

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
            <span>{namespaces.length} namespaces</span>
            <span>{filteredItems.length} matching</span>
          </div>
        </section>

        <section className="layout">
          <section className="card table-card">
            <div className="section-head">
              <div>
                <p className="eyebrow">Portfolio</p>
                <h2>SLO inventory</h2>
              </div>
              {loading ? <span className="muted">Loading…</span> : <span className="muted">Sorted by recency</span>}
            </div>

            {error ? (
              <div className="empty-state error">
                <strong>Unable to load SLOs</strong>
                <p>{error}</p>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="empty-state">
                <strong>No SLOs found</strong>
                <p>Try another search or status filter.</p>
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
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((item) => (
                      <tr
                        key={`${item.namespace}/${item.name}`}
                        className={selected?.name === item.name && selected?.namespace === item.namespace ? 'selected' : ''}
                      >
                        <td data-label="SLO">
                          <button type="button" className="row-button" onClick={() => selectItem(item)}>
                            <strong>{item.displayName || item.name}</strong>
                            <span>{item.name}</span>
                          </button>
                        </td>
                        <td data-label="Namespace">{item.namespace}</td>
                        <td data-label="Status"><StatusBadge status={item.status} /></td>
                        <td data-label="Target">{formatTarget(item.target)}</td>
                        <td data-label="Actual">{formatTarget(item.actual)}</td>
                        <td data-label="Budget">{percentLabel(item.errorBudget.percentRemaining)}</td>
                        <td data-label="Updated">{formatDate(item.lastUpdateTime ?? item.creationTimestamp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <aside className="card detail-card">
            <div className="section-head">
              <div>
                <p className="eyebrow">Details</p>
                <h2>{selected?.displayName || 'Select an SLO'}</h2>
              </div>
              {selected ? <StatusBadge status={selected.status} /> : null}
            </div>

            {!selected ? (
              <div className="empty-state">
                <strong>No selection</strong>
                <p>Click a row to inspect the SLO spec and alerting details.</p>
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

function KpiCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <article className="card kpi-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </article>
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

export default App
