export type MaybeTime = string | null | undefined

export interface ListSLOsResponse {
  items: SLOSummary[]
}

export interface SLOSummary {
  name: string
  namespace: string
  displayName: string
  status: string
  target: number
  actual: number
  window: string
  errorBudget: ErrorBudget
  burnRates?: BurnRate[]
  conditions?: Condition[]
  lastUpdateTime?: MaybeTime
  creationTimestamp: string
  labels?: Record<string, string>
  prometheusRule: ResourceRef
}

export interface SLODetail extends SLOSummary {
  spec: SLOSpec
}

export interface SLOSpec {
  objective: ObjectiveSpec
  workloadSelector?: WorkloadSelector
}

export interface ObjectiveSpec {
  name: string
  target: number
  window: string
  sli: SLI
  alerting: Alerting
}

export interface SLI {
  query?: Query
  template?: Template
}

export interface Query {
  totalQuery: string
  errorQuery: string
}

export interface Template {
  name: string
  labels?: Record<string, string>
  params?: Record<string, string>
}

export interface Alerting {
  budgetErrorAlerts?: BudgetErrorAlerts
  burnRateAlerts?: BurnRateAlerts
}

export interface BudgetErrorAlerts {
  enabled: boolean
  alerts?: BudgetAlert[]
}

export interface BudgetAlert {
  name: string
  percent: number
  severity: string
}

export interface BurnRateAlerts {
  enabled: boolean
  alerts?: BurnRateAlert[]
}

export interface BurnRateAlert {
  name: string
  consumePercent: number
  consumeWindow: string
  longWindow: string
  shortWindow: string
  severity: string
}

export interface WorkloadSelector {
  labelSelector?: Record<string, string>
  namespaces?: string[]
}

export interface ErrorBudget {
  total: string
  consumed: string
  remaining: string
  percentRemaining: number
}

export interface BurnRate {
  shortWindow: string
  shortBurnRate: number
  longWindow: string
  longBurnRate: number
}

export interface Condition {
  type: string
  status: string
  reason?: string
  message?: string
  lastTransitionTime?: MaybeTime
}

export interface ResourceRef {
  name?: string
  namespace?: string
  exists: boolean
}


export interface SLOTimeseriesResponse {
  objectiveId: string
  range: string
  step: string
  series: {
    availability: TimeseriesPoint[]
    target: TimeseriesPoint[]
    burnRate: TimeseriesPoint[]
  }
}

export interface TimeseriesPoint {
  timestamp: string
  value: number
}
