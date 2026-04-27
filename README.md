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
```

### Required RBAC

The ServiceAccount should have read-only access to:

- `servicelevelobjectives.observability.slok.io`
- `prometheusrules.monitoring.coreos.com`
