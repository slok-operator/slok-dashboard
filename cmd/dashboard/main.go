package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/slok-operator/slok-dashboard/internal/api"
	"github.com/slok-operator/slok-dashboard/internal/k8s"
	"github.com/slok-operator/slok-dashboard/internal/prometheus"
	"github.com/slok-operator/slok-dashboard/internal/server"
)

func main() {
	var addr string
	var kubeconfig string
	var namespace string
	var prometheusURL string

	flag.StringVar(&addr, "addr", envOrDefault("SLOK_DASHBOARD_ADDR", ":8080"), "HTTP listen address")
	flag.StringVar(&kubeconfig, "kubeconfig", os.Getenv("KUBECONFIG"), "Path to kubeconfig. Empty uses in-cluster config or default kubeconfig.")
	flag.StringVar(&namespace, "namespace", os.Getenv("SLOK_NAMESPACE"), "Optional namespace scope. Empty lists all namespaces allowed by RBAC.")
	flag.StringVar(&prometheusURL, "prometheus-url", os.Getenv("PROMETHEUS_URL"), "Prometheus base URL used for SLO timeseries queries.")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	kubeClient, err := k8s.NewClient(kubeconfig)
	if err != nil {
		logger.Error("create kubernetes client", "error", err)
		os.Exit(1)
	}

	handler := server.NewRouter(api.NewHandler(k8s.NewSLOStore(kubeClient, namespace), prometheus.NewClient(prometheusURL)))
	httpServer := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		logger.Info("starting slok dashboard backend", "addr", addr, "namespace", namespace, "prometheusURLConfigured", prometheusURL != "")
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("serve http", "error", err)
			stop()
		}
	}()

	<-ctx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Error("shutdown http server", "error", err)
		os.Exit(1)
	}
}

func envOrDefault(name string, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
