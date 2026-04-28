package server

import (
	"net/http"

	"github.com/slok-operator/slok-dashboard/internal/api"
)

func NewRouter(handler *api.Handler) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", handler.Index)
	mux.HandleFunc("GET /api/healthz", handler.Healthz)
	mux.HandleFunc("GET /api/slos", handler.ListSLOs)
	mux.HandleFunc("GET /api/slos/{namespace}/{name}", handler.GetSLO)
	mux.HandleFunc("GET /api/slos/{namespace}/{name}/timeseries", handler.GetSLOTimeseries)

	return withCORS(withJSON(mux))
}

func withJSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		next.ServeHTTP(w, r)
	})
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
