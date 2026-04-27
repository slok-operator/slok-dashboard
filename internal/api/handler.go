package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

type SLOStore interface {
	List(r *http.Request) ([]SLOSummary, error)
	Get(r *http.Request, namespace string, name string) (*SLODetail, error)
}

type Handler struct {
	store SLOStore
}

func NewHandler(store SLOStore) *Handler {
	return &Handler{store: store}
}

func (h *Handler) Index(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"name":   "slok-dashboard",
		"status": "running",
		"endpoints": []string{
			"GET /api/healthz",
			"GET /api/slos",
			"GET /api/slos/{namespace}/{name}",
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
