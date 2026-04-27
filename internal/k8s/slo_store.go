package k8s

import (
	"fmt"
	"net/http"
	"time"

	"github.com/slok-operator/slok-dashboard/internal/api"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

const unknownStatus = "unknown"

var (
	sloGVK = schema.GroupVersionKind{
		Group:   "observability.slok.io",
		Version: "v1alpha1",
		Kind:    "ServiceLevelObjective",
	}
	sloListGVK = schema.GroupVersionKind{
		Group:   "observability.slok.io",
		Version: "v1alpha1",
		Kind:    "ServiceLevelObjectiveList",
	}
	sloGVR = schema.GroupVersionResource{
		Group:    "observability.slok.io",
		Version:  "v1alpha1",
		Resource: "servicelevelobjectives",
	}
	prometheusRuleGVK = schema.GroupVersionKind{
		Group:   "monitoring.coreos.com",
		Version: "v1",
		Kind:    "PrometheusRule",
	}
)

type SLOStore struct {
	client    client.Client
	namespace string
}

func NewSLOStore(kubeClient client.Client, namespace string) *SLOStore {
	return &SLOStore{client: kubeClient, namespace: namespace}
}

func (s *SLOStore) List(r *http.Request) ([]api.SLOSummary, error) {
	list := &unstructured.UnstructuredList{}
	list.SetGroupVersionKind(sloListGVK)

	opts := []client.ListOption{}
	if s.namespace != "" {
		opts = append(opts, client.InNamespace(s.namespace))
	}

	if err := s.client.List(r.Context(), list, opts...); err != nil {
		return nil, err
	}

	slos := make([]api.SLOSummary, 0, len(list.Items))
	for i := range list.Items {
		summary := toSLOSummary(&list.Items[i])
		summary.PrometheusRule.Exists = s.prometheusRuleExists(r, summary.PrometheusRule.Namespace, summary.PrometheusRule.Name)
		slos = append(slos, summary)
	}

	return slos, nil
}

func (s *SLOStore) Get(r *http.Request, namespace string, name string) (*api.SLODetail, error) {
	if namespace == "" || name == "" {
		return nil, fmt.Errorf("%w: namespace and name are required", api.ErrInvalidRequest)
	}
	if s.namespace != "" && namespace != s.namespace {
		return nil, apierrors.NewForbidden(sloGVR.GroupResource(), name, fmt.Errorf("dashboard is scoped to namespace %q", s.namespace))
	}

	slo := &unstructured.Unstructured{}
	slo.SetGroupVersionKind(sloGVK)
	if err := s.client.Get(r.Context(), types.NamespacedName{Namespace: namespace, Name: name}, slo); err != nil {
		return nil, err
	}

	summary := toSLOSummary(slo)
	summary.PrometheusRule.Exists = s.prometheusRuleExists(r, summary.PrometheusRule.Namespace, summary.PrometheusRule.Name)

	return &api.SLODetail{
		SLOSummary: summary,
		Spec:       toSLOSpec(slo),
	}, nil
}

func (s *SLOStore) prometheusRuleExists(r *http.Request, namespace string, name string) bool {
	if namespace == "" || name == "" {
		return false
	}

	rule := &unstructured.Unstructured{}
	rule.SetGroupVersionKind(prometheusRuleGVK)
	err := s.client.Get(r.Context(), types.NamespacedName{Namespace: namespace, Name: name}, rule)
	return err == nil
}

func toSLOSummary(slo *unstructured.Unstructured) api.SLOSummary {
	objectiveName := nestedString(slo.Object, "spec", "objective", "name")
	status := nestedString(slo.Object, "status", "objective", "status")
	if status == "" {
		status = unknownStatus
	}

	return api.SLOSummary{
		Name:        slo.GetName(),
		Namespace:   slo.GetNamespace(),
		DisplayName: nestedString(slo.Object, "spec", "displayName"),
		Status:      status,
		Target: valueOrDefault(
			nestedFloat64(slo.Object, "status", "objective", "target"),
			nestedFloat64(slo.Object, "spec", "objective", "target"),
		),
		Actual:            nestedFloat64(slo.Object, "status", "objective", "actual"),
		Window:            nestedString(slo.Object, "spec", "objective", "window"),
		ErrorBudget:       toErrorBudget(slo.Object),
		BurnRates:         toBurnRates(slo.Object),
		Conditions:        toConditions(slo.Object),
		LastUpdateTime:    nestedTimePtr(slo.Object, "status", "lastUpdateTime"),
		CreationTimestamp: slo.GetCreationTimestamp().Time,
		Labels:            slo.GetLabels(),
		PrometheusRule: api.ResourceRef{
			Name:      prometheusRuleName(slo.GetName(), objectiveName),
			Namespace: slo.GetNamespace(),
		},
	}
}

func toSLOSpec(slo *unstructured.Unstructured) api.SLOSpec {
	return api.SLOSpec{
		Objective: api.ObjectiveSpec{
			Name:     nestedString(slo.Object, "spec", "objective", "name"),
			Target:   nestedFloat64(slo.Object, "spec", "objective", "target"),
			Window:   nestedString(slo.Object, "spec", "objective", "window"),
			SLI:      toSLI(slo.Object),
			Alerting: toAlerting(slo.Object),
		},
		WorkloadSelector: toWorkloadSelector(slo.Object),
	}
}

func toSLI(obj map[string]any) api.SLI {
	result := api.SLI{}
	if totalQuery := nestedString(obj, "spec", "objective", "sli", "query", "totalQuery"); totalQuery != "" {
		result.Query = &api.Query{
			TotalQuery: totalQuery,
			ErrorQuery: nestedString(obj, "spec", "objective", "sli", "query", "errorQuery"),
		}
	}
	if name := nestedString(obj, "spec", "objective", "sli", "template", "name"); name != "" {
		result.Template = &api.Template{
			Name:   name,
			Labels: nestedStringMap(obj, "spec", "objective", "sli", "template", "labels"),
			Params: nestedStringMap(obj, "spec", "objective", "sli", "template", "params"),
		}
	}
	return result
}

func toAlerting(obj map[string]any) api.Alerting {
	result := api.Alerting{}
	if alerts, ok, _ := unstructured.NestedSlice(obj, "spec", "objective", "alerting", "budgetErrorAlerts", "alerts"); ok {
		result.BudgetErrorAlerts = &api.BudgetErrorAlerts{
			Enabled: nestedBool(obj, "spec", "objective", "alerting", "budgetErrorAlerts", "enabled"),
			Alerts:  toBudgetAlerts(alerts),
		}
	}
	if alerts, ok, _ := unstructured.NestedSlice(obj, "spec", "objective", "alerting", "burnRateAlerts", "alerts"); ok {
		result.BurnRateAlerts = &api.BurnRateAlerts{
			Enabled: nestedBool(obj, "spec", "objective", "alerting", "burnRateAlerts", "enabled"),
			Alerts:  toBurnRateAlerts(alerts),
		}
	}
	return result
}

func toBudgetAlerts(items []any) []api.BudgetAlert {
	alerts := make([]api.BudgetAlert, 0, len(items))
	for _, item := range items {
		alert, ok := item.(map[string]any)
		if !ok {
			continue
		}
		alerts = append(alerts, api.BudgetAlert{
			Name:     nestedString(alert, "name"),
			Percent:  nestedFloat64(alert, "percent"),
			Severity: nestedString(alert, "severity"),
		})
	}
	return alerts
}

func toBurnRateAlerts(items []any) []api.BurnRateAlert {
	alerts := make([]api.BurnRateAlert, 0, len(items))
	for _, item := range items {
		alert, ok := item.(map[string]any)
		if !ok {
			continue
		}
		alerts = append(alerts, api.BurnRateAlert{
			Name:           nestedString(alert, "name"),
			ConsumePercent: nestedFloat64(alert, "consumePercent"),
			ConsumeWindow:  nestedString(alert, "consumeWindow"),
			LongWindow:     nestedString(alert, "longWindow"),
			ShortWindow:    nestedString(alert, "shortWindow"),
			Severity:       nestedString(alert, "severity"),
		})
	}
	return alerts
}

func toWorkloadSelector(obj map[string]any) *api.WorkloadSelector {
	selector, ok, _ := unstructured.NestedMap(obj, "spec", "workloadSelector")
	if !ok {
		return nil
	}
	return &api.WorkloadSelector{
		LabelSelector: nestedStringMap(selector, "labelSelector"),
		Namespaces:    nestedStringSlice(selector, "namespaces"),
	}
}

func toErrorBudget(obj map[string]any) api.ErrorBudget {
	return api.ErrorBudget{
		Total:            nestedString(obj, "status", "objective", "errorBudget", "total"),
		Consumed:         nestedString(obj, "status", "objective", "errorBudget", "consumed"),
		Remaining:        nestedString(obj, "status", "objective", "errorBudget", "remaining"),
		PercentRemaining: nestedFloat64(obj, "status", "objective", "errorBudget", "percentRemaining"),
	}
}

func toBurnRates(obj map[string]any) []api.BurnRate {
	items, ok, _ := unstructured.NestedSlice(obj, "status", "objective", "burnRate")
	if !ok {
		return nil
	}

	burnRates := make([]api.BurnRate, 0, len(items))
	for _, item := range items {
		burnRate, ok := item.(map[string]any)
		if !ok {
			continue
		}
		burnRates = append(burnRates, api.BurnRate{
			ShortWindow:   nestedString(burnRate, "shortWindow"),
			ShortBurnRate: nestedFloat64(burnRate, "shortBurnRate"),
			LongWindow:    nestedString(burnRate, "longWindow"),
			LongBurnRate:  nestedFloat64(burnRate, "longBurnRate"),
		})
	}
	return burnRates
}

func toConditions(obj map[string]any) []api.Condition {
	items, ok, _ := unstructured.NestedSlice(obj, "status", "conditions")
	if !ok {
		return nil
	}

	conditions := make([]api.Condition, 0, len(items))
	for _, item := range items {
		condition, ok := item.(map[string]any)
		if !ok {
			continue
		}
		conditions = append(conditions, api.Condition{
			Type:               nestedString(condition, "type"),
			Status:             nestedString(condition, "status"),
			Reason:             nestedString(condition, "reason"),
			Message:            nestedString(condition, "message"),
			LastTransitionTime: nestedTimePtr(condition, "lastTransitionTime"),
		})
	}
	return conditions
}

func prometheusRuleName(sloName string, objectiveName string) string {
	return fmt.Sprintf("slok-%s-%s", sloName, objectiveName)
}

func nestedString(obj map[string]any, fields ...string) string {
	value, _, _ := unstructured.NestedString(obj, fields...)
	return value
}

func nestedBool(obj map[string]any, fields ...string) bool {
	value, _, _ := unstructured.NestedBool(obj, fields...)
	return value
}

func nestedFloat64(obj map[string]any, fields ...string) float64 {
	value, ok, _ := unstructured.NestedFloat64(obj, fields...)
	if ok {
		return value
	}
	intValue, ok, _ := unstructured.NestedInt64(obj, fields...)
	if ok {
		return float64(intValue)
	}
	return 0
}

func nestedStringMap(obj map[string]any, fields ...string) map[string]string {
	value, ok, _ := unstructured.NestedStringMap(obj, fields...)
	if !ok {
		return nil
	}
	return value
}

func nestedStringSlice(obj map[string]any, fields ...string) []string {
	items, ok, _ := unstructured.NestedStringSlice(obj, fields...)
	if !ok {
		return nil
	}
	return items
}

func nestedTimePtr(obj map[string]any, fields ...string) *time.Time {
	value := nestedString(obj, fields...)
	if value == "" {
		return nil
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil
	}
	return &parsed
}

func valueOrDefault(value float64, fallback float64) float64 {
	if value != 0 {
		return value
	}
	return fallback
}
