package api

import (
	"errors"
	"time"
)

var ErrInvalidRequest = errors.New("invalid request")

type ListSLOsResponse struct {
	Items []SLOSummary `json:"items"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

type SLOSummary struct {
	Name              string            `json:"name"`
	Namespace         string            `json:"namespace"`
	DisplayName       string            `json:"displayName"`
	Status            string            `json:"status"`
	Target            float64           `json:"target"`
	Actual            float64           `json:"actual"`
	Window            string            `json:"window"`
	ErrorBudget       ErrorBudget       `json:"errorBudget"`
	BurnRates         []BurnRate        `json:"burnRates,omitempty"`
	Conditions        []Condition       `json:"conditions,omitempty"`
	LastUpdateTime    *time.Time        `json:"lastUpdateTime,omitempty"`
	CreationTimestamp time.Time         `json:"creationTimestamp"`
	Labels            map[string]string `json:"labels,omitempty"`
	PrometheusRule    ResourceRef       `json:"prometheusRule"`
}

type SLODetail struct {
	SLOSummary
	Spec SLOSpec `json:"spec"`
}

type SLOSpec struct {
	Objective        ObjectiveSpec     `json:"objective"`
	WorkloadSelector *WorkloadSelector `json:"workloadSelector,omitempty"`
}

type ObjectiveSpec struct {
	Name     string   `json:"name"`
	Target   float64  `json:"target"`
	Window   string   `json:"window"`
	SLI      SLI      `json:"sli"`
	Alerting Alerting `json:"alerting"`
}

type SLI struct {
	Query    *Query    `json:"query,omitempty"`
	Template *Template `json:"template,omitempty"`
}

type Query struct {
	TotalQuery string `json:"totalQuery"`
	ErrorQuery string `json:"errorQuery"`
}

type Template struct {
	Name   string            `json:"name"`
	Labels map[string]string `json:"labels,omitempty"`
	Params map[string]string `json:"params,omitempty"`
}

type Alerting struct {
	BudgetErrorAlerts *BudgetErrorAlerts `json:"budgetErrorAlerts,omitempty"`
	BurnRateAlerts    *BurnRateAlerts    `json:"burnRateAlerts,omitempty"`
}

type BudgetErrorAlerts struct {
	Enabled bool          `json:"enabled"`
	Alerts  []BudgetAlert `json:"alerts,omitempty"`
}

type BudgetAlert struct {
	Name     string  `json:"name"`
	Percent  float64 `json:"percent"`
	Severity string  `json:"severity"`
}

type BurnRateAlerts struct {
	Enabled bool            `json:"enabled"`
	Alerts  []BurnRateAlert `json:"alerts,omitempty"`
}

type BurnRateAlert struct {
	Name           string  `json:"name"`
	ConsumePercent float64 `json:"consumePercent"`
	ConsumeWindow  string  `json:"consumeWindow"`
	LongWindow     string  `json:"longWindow"`
	ShortWindow    string  `json:"shortWindow"`
	Severity       string  `json:"severity"`
}

type WorkloadSelector struct {
	LabelSelector map[string]string `json:"labelSelector,omitempty"`
	Namespaces    []string          `json:"namespaces,omitempty"`
}

type ErrorBudget struct {
	Total            string  `json:"total"`
	Consumed         string  `json:"consumed"`
	Remaining        string  `json:"remaining"`
	PercentRemaining float64 `json:"percentRemaining"`
}

type BurnRate struct {
	ShortWindow   string  `json:"shortWindow"`
	ShortBurnRate float64 `json:"shortBurnRate"`
	LongWindow    string  `json:"longWindow"`
	LongBurnRate  float64 `json:"longBurnRate"`
}

type Condition struct {
	Type               string     `json:"type"`
	Status             string     `json:"status"`
	Reason             string     `json:"reason,omitempty"`
	Message            string     `json:"message,omitempty"`
	LastTransitionTime *time.Time `json:"lastTransitionTime,omitempty"`
}

type ResourceRef struct {
	Name      string `json:"name,omitempty"`
	Namespace string `json:"namespace,omitempty"`
	Exists    bool   `json:"exists"`
}

type SLOTimeseriesResponse struct {
	ObjectiveID string            `json:"objectiveId"`
	Range       string            `json:"range"`
	Step        string            `json:"step"`
	Series      SLOTimeseriesData `json:"series"`
}

type SLOTimeseriesData struct {
	Availability []TimeseriesPoint `json:"availability"`
	Target       []TimeseriesPoint `json:"target"`
	BurnRate     []TimeseriesPoint `json:"burnRate"`
	ErrorBudget  []TimeseriesPoint `json:"errorBudget"`
}

type TimeseriesPoint struct {
	Timestamp time.Time `json:"timestamp"`
	Value     float64   `json:"value"`
}
