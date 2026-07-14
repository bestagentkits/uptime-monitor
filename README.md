# uptime-monitor

Scheduled GitHub Actions healthz for the AgentKit / ClaudeKit domains. Pings each
target every ~5 minutes, dedupes via a committed state file, and alerts Discord
**only on transitions** (down/degraded once, recover once).

> Public repo → free Actions minutes. The committed `state/status.json` doubles as
> a commit heartbeat, which keeps the scheduled workflow from being auto-disabled
> after 60 days of repo inactivity.

## Targets

Configured in [`targets.json`](./targets.json):

| Target | URL | Mode | Detects |
|---|---|---|---|
| agentkit-prod | agentkit.best/api/health | deep | up/down, dependency, latency |
| agentkit-staging | staging.agentkit.best/api/health | deep | up/down, dependency, latency |
| docs-claudekit | docs.claudekit.cc | http | up/down, latency |
| docs-agentkit | docs.agentkit.best | http | up/down, latency |

- **http** mode: any non-2xx/3xx or timeout → `down`; over `latencyMs` → `degraded`.
- **deep** mode: sends `Authorization: Bearer $HEALTH_CHECK_TOKEN`, parses
  `{status, checks}`. Falls back to `up` on a plain 200 so it works before the
  deep-health endpoint ships in `claudekit-web`.

## Required GitHub Secrets

| Secret | Purpose | Required |
|---|---|---|
| `DISCORD_ALERT_WEBHOOK_URL` | Incident channel webhook | yes |
| `HEALTH_CHECK_TOKEN` | Bearer token for deep `/api/health` | for deep mode |
| `HEALTHCHECKS_URL` | Dead-man's-switch ping URL (e.g. healthchecks.io) | optional |

> ⚠️ Never commit these. Set via `gh secret set <NAME>`. The Discord webhook must
> be **rotated** if it was ever pasted into a chat/log.

## Local run

```bash
node scripts/check.mjs            # dry-run: prints status, logs alerts it WOULD send
DISCORD_ALERT_WEBHOOK_URL=... node scripts/check.mjs   # actually alerts
```

## Runbook (per status)

| Status | Meaning | First action |
|---|---|---|
| `down` (deep, postgres) | App can't serve — critical | Check app pod on DXUP + self-hosted Postgres |
| `degraded` (deep, redis/clickhouse) | Fail-open dep down, app still serves | Check Redis/ClickHouse; lower urgency |
| `down` (http) | URL unreachable / 5xx | Check deploy + SSL (DXUP auto-cert) |
| `down` (docs) | Mintlify page down | Check Mintlify status / DNS |

## Deep-health contract (implement in `claudekit-web`)

`GET /api/health` behind `Authorization: Bearer $HEALTH_CHECK_TOKEN`:

```jsonc
// 200 when postgres ok; 503 when postgres down
{
  "status": "ok | degraded | down",
  "checks": { "postgres": "ok|down", "redis": "ok|down", "clickhouse": "ok|down" }
}
```

Postgres down → `down` (critical). Redis/ClickHouse down → `degraded` (fail-open).
Keep the existing shallow public response for k8s liveness; gate the detailed
body behind the token so dependency state is never public.
