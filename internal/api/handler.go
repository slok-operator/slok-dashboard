package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

type SLOStore interface {
	List(r *http.Request) ([]SLOSummary, error)
	Get(r *http.Request, namespace string, name string) (*SLODetail, error)
}

type MetricsStore interface {
	QueryRange(r *http.Request, query string, start time.Time, end time.Time, step time.Duration) ([]TimeseriesPoint, error)
}

type Handler struct {
	store   SLOStore
	metrics MetricsStore
}

func NewHandler(store SLOStore, metrics MetricsStore) *Handler {
	return &Handler{store: store, metrics: metrics}
}

func (h *Handler) Index(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"name":   "slok-dashboard",
		"status": "running",
		"endpoints": []string{
			"GET /api/healthz",
			"GET /api/slos",
			"GET /api/slos/{namespace}/{name}",
			"GET /api/slos/{namespace}/{name}/timeseries",
		},
	})
}

func (h *Handler) Healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) ListSLOs(w http.ResponseWriter, r *http.Request) {
	slos, err := h.store.List(r)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, ListSLOsResponse{Items: slos})
}

func (h *Handler) GetSLO(w http.ResponseWriter, r *http.Request) {
	slo, err := h.store.Get(r, r.PathValue("namespace"), r.PathValue("name"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, slo)
}

func (h *Handler) GetSLOTimeseries(w http.ResponseWriter, r *http.Request) {
	if h.metrics == nil {
		writeError(w, fmt.Errorf("%w: prometheus url is not configured", ErrInvalidRequest))
		return
	}

	slo, err := h.store.Get(r, r.PathValue("namespace"), r.PathValue("name"))
	if err != nil {
		writeError(w, err)
		return
	}

	rangeDuration := durationQueryParam(r, "range", 6*time.Hour)
	step := durationQueryParam(r, "step", 5*time.Minute)
	end := time.Now().UTC()
	start := end.Add(-rangeDuration)
	objectiveID := fmt.Sprintf("%s/%s", slo.Name, slo.Spec.Objective.Name)

	availabilityQuery := fmt.Sprintf(`100 - (slok:sli_error_rate:5m{objective_id=%q} * 100)`, objectiveID)
	burnRateQuery := fmt.Sprintf(`slok:burn_rate:5m{objective_id=%q}`, objectiveID)

	availability, err := h.metrics.QueryRange(r, availabilityQuery, start, end, step)
	if err != nil {
		writeError(w, err)
		return
	}
	burnRate, err := h.metrics.QueryRange(r, burnRateQuery, start, end, step)
	if err != nil {
		writeError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, SLOTimeseriesResponse{
		ObjectiveID: objectiveID,
		Range:       rangeDuration.String(),
		Step:        step.String(),
		Series: SLOTimeseriesData{
			Availability: availability,
			Target:       targetSeries(availability, slo.Target),
			BurnRate:     burnRate,
		},
	})
}

func durationQueryParam(r *http.Request, name string, fallback time.Duration) time.Duration {
	value := r.URL.Query().Get(name)
	if value == "" {
		return fallback
	}
	parsed, err := parseDashboardDuration(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func parseDashboardDuration(value string) (time.Duration, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, fmt.Errorf("empty duration")
	}

	unit := value[len(value)-1:]
	number := value[:len(value)-1]
	switch unit {
	case "d", "w":
		amount, err := strconv.Atoi(number)
		if err != nil {
			return 0, err
		}
		if unit == "d" {
			return time.Duration(amount) * 24 * time.Hour, nil
		}
		return time.Duration(amount) * 7 * 24 * time.Hour, nil
	default:
		return time.ParseDuration(value)
	}
}

func targetSeries(points []TimeseriesPoint, target float64) []TimeseriesPoint {
	series := make([]TimeseriesPoint, 0, len(points))
	for _, point := range points {
		series = append(series, TimeseriesPoint{Timestamp: point.Timestamp, Value: target})
	}
	return series
}

func writeJSON(w http.ResponseWriter, statusCode int, value any) {
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		slog.Error("write json response", "error", err)
	}
}

func writeError(w http.ResponseWriter, err error) {
	statusCode := http.StatusInternalServerError
	message := "internal server error"

	if apierrors.IsNotFound(err) {
		statusCode = http.StatusNotFound
		message = "resource not found"
	} else if apierrors.IsForbidden(err) || apierrors.IsUnauthorized(err) {
		statusCode = http.StatusForbidden
		message = "forbidden"
	} else if errors.Is(err, ErrInvalidRequest) {
		statusCode = http.StatusBadRequest
		message = err.Error()
	} else {
		slog.Error("api request failed", "error", err)
	}

	writeJSON(w, statusCode, ErrorResponse{Error: message})
}
