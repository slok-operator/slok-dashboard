# slok-dashboard

Read-only web dashboard for Slok ServiceLevelObjective resources.

## Backend

The backend is a Go HTTP API that reads Kubernetes resources using the pod ServiceAccount.
There is intentionally no user/auth management in the application. Put it behind an authenticated Ingress, oauth2-proxy, VPN, or internal network when needed.

### Run locally

```bash
make run
```

By default it listens on `:8080` and uses, in order:

1. `--kubeconfig` / `KUBECONFIG`
2. in-cluster config
3. `~/.kube/config`

Optional namespace scope:

```bash
SLOK_NAMESPACE=default make run
```

### API

```text
GET /api/healthz
GET /api/slos
GET /api/slos/{namespace}/{name}
GET /api/slos/{namespace}/{name}/timeseries
```
### SLO trend charts

The dashboard can plot SLO availability trends using Slok recording rules from Prometheus.
Configure the backend with:

```bash
PROMETHEUS_URL=http://prometheus-kube-prometheus-prometheus.monitoring.svc:9090 make run
```

The UI calls:

```text
GET /api/slos/{namespace}/{name}/timeseries?range=6h&step=5m
```

It uses the same base query as the Grafana dashboard:

```promql
100 - (slok:sli_error_rate:5m{objective_id="<slo>/<objective>"} * 100)
```


### Required RBAC

The ServiceAccount should have read-only access to:

- `servicelevelobjectives.observability.slok.io`
- `prometheusrules.monitoring.coreos.com`

## Frontend

A lightweight React + TypeScript + Vite UI lives in `web/`.

### Run locally

```bash
cd web
npm install
npm run dev
```

The Vite dev server proxies `/api` to `http://localhost:8080`.

### Build

```bash
cd web
npm run build
```

## Container images

Published via GitHub Actions to GHCR:

- `ghcr.io/<owner>/slok-dashboard-backend`
- `ghcr.io/<owner>/slok-dashboard-frontend`

On `main`, images are tagged with `latest` and the commit SHA.

test