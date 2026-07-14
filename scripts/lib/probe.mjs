// HTTP probing + incident classification for each monitored target.
// Pure logic, no side effects other than the network request itself.

const USER_AGENT = 'bestagentkits-uptime-monitor/1.0 (+https://github.com/bestagentkits/uptime-monitor)';

// Map a body-level status string to our canonical health state.
// Accepts both the shallow legacy endpoint ({status:'healthy'}) and the deep
// contract ({status:'ok'|'degraded'|'down'}). Unknown strings fall back to 'up'
// so the monitor keeps working before the deep-health endpoint ships.
function mapBodyStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (s === 'down' || s === 'unhealthy' || s === 'error') return 'down';
  if (s === 'degraded' || s === 'warn' || s === 'warning') return 'degraded';
  return 'up'; // 'ok', 'healthy', '' → healthy baseline
}

// Only ever downgrade a healthy result to 'degraded' on latency; never mask a down.
function applyLatency(status, latencyMs, thresholdMs) {
  if (status === 'up' && thresholdMs && latencyMs > thresholdMs) return 'degraded';
  return status;
}

/**
 * Probe a single target.
 * @returns {{name, status:'up'|'degraded'|'down', http:number|null, latencyMs:number, error:string|null, checks:object|null}}
 */
export async function probe(target, { token, timeoutMs = 10000 } = {}) {
  const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json,*/*' };
  if (target.mode === 'deep' && token) headers.Authorization = `Bearer ${token}`;

  const start = performance.now();
  let res;
  try {
    res = await fetch(target.url, {
      method: 'GET',
      redirect: 'follow',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    const reason = err?.name === 'TimeoutError'
      ? `timeout >${timeoutMs}ms`
      : (err?.cause?.code || err?.message || 'network error');
    return { name: target.name, status: 'down', http: null, latencyMs, error: reason, checks: null };
  }

  const latencyMs = Math.round(performance.now() - start);
  const http = res.status;

  // Try to read the deep-health body regardless of HTTP code (503 still carries JSON).
  let body = null;
  if (target.mode === 'deep') {
    try { body = await res.json(); } catch { /* not JSON → treat via HTTP code below */ }
  }

  let status;
  let checks = null;
  if (body && typeof body === 'object' && 'status' in body) {
    status = mapBodyStatus(body.status);
    checks = body.checks && typeof body.checks === 'object' ? body.checks : null;
  } else if (res.ok) {
    status = 'up';
  } else {
    status = 'down';
  }

  status = applyLatency(status, latencyMs, target.latencyMs);
  const error = status === 'down' ? (body?.status ? `body:${body.status}` : `http ${http}`) : null;
  return { name: target.name, status, http, latencyMs, error, checks };
}
