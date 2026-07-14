#!/usr/bin/env node
// Uptime monitor entrypoint.
// Probes every target in targets.json, compares against committed state,
// and emits a Discord alert ONLY when a target crosses the healthy<->unhealthy
// boundary (down/degraded once, recover once). State is persisted to
// state/status.json which doubles as the commit heartbeat that keeps the
// scheduled workflow from being auto-disabled after 60 days of inactivity.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { probe } from './lib/probe.mjs';
import { buildEmbed, sendAlerts } from './lib/discord.mjs';
import { classifyTransition } from './lib/transitions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS_PATH = join(ROOT, 'targets.json');
const STATE_PATH = join(ROOT, 'state', 'status.json');

const webhook = process.env.DISCORD_ALERT_WEBHOOK_URL || '';
const token = process.env.HEALTH_CHECK_TOKEN || '';

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function main() {
  const targets = await readJson(TARGETS_PATH, []);
  const prev = await readJson(STATE_PATH, { targets: {} });
  const prevTargets = prev.targets || {};

  const results = await Promise.all(targets.map((t) => probe(t, { token })));

  const embeds = [];
  const nextTargets = {};
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const r = results[i];
    // Missing previous state defaults to 'up' so a currently-down site alerts on first run.
    const oldStatus = prevTargets[t.name]?.status || 'up';
    const kind = classifyTransition(oldStatus, r.status);
    if (kind) embeds.push(buildEmbed(t, r, kind));

    nextTargets[t.name] = {
      status: r.status,
      http: r.http,
      latencyMs: r.latencyMs,
      error: r.error,
      checkedAt: new Date().toISOString(),
    };

    const tag = kind ? `  <ALERT:${kind}>` : '';
    console.log(`${r.status.padEnd(8)} ${t.name.padEnd(20)} http=${String(r.http ?? '-').padEnd(4)} ${r.latencyMs}ms${r.error ? ` (${r.error})` : ''}${tag}`);
  }

  // Deliver alerts (or log them when no webhook is configured, e.g. local verify).
  if (embeds.length) {
    if (webhook) {
      const { sent } = await sendAlerts(webhook, embeds);
      console.log(`\nSent ${sent} Discord alert(s).`);
    } else {
      console.log(`\n[dry-run] ${embeds.length} alert(s) would be sent (DISCORD_ALERT_WEBHOOK_URL unset):`);
      for (const e of embeds) console.log(`  - ${e.title}`);
    }
  } else {
    console.log('\nNo transitions — no alert.');
  }

  await writeFile(STATE_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), targets: nextTargets }, null, 2) + '\n');
  console.log(`State written → ${STATE_PATH}`);
}

main().catch((err) => {
  // Never hard-fail the workflow: a checker crash must not block the state
  // commit heartbeat. Log and exit 0.
  console.error('check.mjs error:', err?.stack || err?.message || err);
  process.exit(0);
});
