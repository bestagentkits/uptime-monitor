// Discord alert formatting + delivery. Only transition alerts reach here.

const COLORS = { down: 0xe01e5a, degraded: 0xf2a900, recover: 0x2eb67d };
const EMOJI = { down: '🔴', degraded: '🟠', recover: '🟢' };

// kind: 'down' | 'degraded' | 'recover'
export function buildEmbed(target, result, kind) {
  const titleWord = kind === 'recover' ? 'RECOVERED' : kind.toUpperCase();
  const fields = [
    { name: 'Status', value: `\`${result.status}\``, inline: true },
    { name: 'HTTP', value: `\`${result.http ?? 'n/a'}\``, inline: true },
    { name: 'Latency', value: `\`${result.latencyMs}ms\``, inline: true },
  ];
  if (result.checks) {
    const deps = Object.entries(result.checks).map(([k, v]) => `${k}:${v}`).join(', ');
    fields.push({ name: 'Dependencies', value: `\`${deps}\``, inline: false });
  }
  if (result.error) fields.push({ name: 'Detail', value: `\`${result.error}\``, inline: false });

  return {
    title: `${EMOJI[kind]} ${target.name} is ${titleWord}`,
    description: target.url,
    color: COLORS[kind],
    fields,
    timestamp: new Date().toISOString(),
    footer: { text: 'bestagentkits uptime-monitor' },
  };
}

// Send embeds in batches of 10 (Discord per-message limit).
export async function sendAlerts(webhookUrl, embeds) {
  if (!embeds.length) return { sent: 0 };
  let sent = 0;
  for (let i = 0; i < embeds.length; i += 10) {
    const batch = embeds.slice(i, i + 10);
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Uptime Monitor', embeds: batch }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Discord webhook failed: HTTP ${res.status}`);
    sent += batch.length;
  }
  return { sent };
}
