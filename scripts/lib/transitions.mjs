// Alert boundary logic. We only alert when a target crosses the
// healthy <-> unhealthy line, so a site that stays down does NOT re-alert.

export const isHealthy = (s) => s === 'up';

/**
 * @returns {'down'|'degraded'|'recover'|null} alert kind, or null to stay silent.
 */
export function classifyTransition(oldStatus, newStatus) {
  const was = isHealthy(oldStatus);
  const now = isHealthy(newStatus);
  if (was && !now) return newStatus; // healthy → unhealthy: 'down' | 'degraded'
  if (!was && now) return 'recover'; // unhealthy → healthy
  return null; // no boundary crossing (up→up or down→down/down→degraded)
}
