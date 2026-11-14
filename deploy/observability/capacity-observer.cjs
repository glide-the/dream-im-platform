'use strict';
// [Input] Existing ARMS Meter, explicit observation budget, and the actual Node HTTP server.
// [Output] Aggregate capacity metrics without identities, credentials, request bodies or SQL attributes.
// [Pos] Server-owned ARMS adapter; independent of trace sampling and application release internals.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- This adapter is preloaded by Node as CommonJS.
const { AsyncLocalStorage } = require('node:async_hooks');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- This adapter is preloaded by Node as CommonJS.
const { performance } = require('node:perf_hooks');

const OPERATIONS = new Set(['account_lock_wait', 'payload_write', 'payload_queue_wait', 'settlement']);
const POOLS = [
  ['main', '__ink_memory_pg_pool__'], ['auth', '__ink_auth_pool'],
  ['control', '__ink_admin_auth_control_pool'], ['dream', '__ink_dream_data_pool'],
];
const GATEWAY = new Map([
  ['/v1/chat/completions', 'chat'], ['/v1/messages', 'messages'], ['/v1/models', 'models'],
  ['/v1/messages/count_tokens', 'count_tokens'], ['/v1/images/generations', 'images_generations'],
  ['/v1/images/edits', 'images_edits'],
]);

function classify(url) {
  const path = String(url || '').split('?')[0];
  if (GATEWAY.has(path)) return { domain: 'gateway', operation: GATEWAY.get(path) };
  if (path.startsWith('/api/admin/')) return { domain: 'admin', operation: 'api' };
  return null;
}

function createCapacityObserver({ meter, policy, globals = globalThis, now = Date.now, monotonic = () => performance.now() }) {
  if (!policy || !Number.isSafeInteger(policy.activeWindowMs) || policy.activeWindowMs < 1
      || !Number.isSafeInteger(policy.maxTrackedUsers) || policy.maxTrackedUsers < 1) {
    throw new Error('Explicit capacity observation budget is required');
  }
  const storage = new AsyncLocalStorage();
  const users = new Map(), requests = new Map(), locks = new WeakMap();
  const actorHooks = new Set();
  const startedAt = now();
  let queuedEvents = 0, queuedBytes = 0, lastOverflow = -Infinity, observerErrors = 0;
  let disposed = false;
  const instruments = {};
  const safe = fn => { try { return fn(); } catch { observerErrors += 1; return undefined; } };
  const counter = name => meter.createCounter(name);
  const histogram = name => meter.createHistogram(name, { unit: 's' });
  const completed = counter('ink_requests_completed_total');
  const dropped = counter('ink_observations_dropped_total');
  const operations = counter('ink_gateway_operations_total');
  const duration = histogram('ink_request_duration_seconds');
  const ttft = histogram('ink_gateway_ttft_seconds');
  const operationDuration = histogram('ink_gateway_operation_duration_seconds');
  const lockHold = histogram('ink_gateway_account_lock_hold_seconds');
  const admission = meter.createHistogram('ink_account_inflight_at_admission');
  for (const name of ['ink_users_active','ink_users_inflight','ink_account_inflight_max','ink_account_inflight_peak',
    'ink_requests_inflight','ink_requests_inflight_peak','ink_payload_queue_events','ink_payload_queue_bytes',
    'ink_db_pool_connections','ink_db_pool_waiters','ink_capacity_window_ready','ink_capacity_observation_complete',
    'ink_capacity_observer_errors','ink_capacity_active_window_seconds','ink_capacity_actor_hook_seen']) instruments[name] = meter.createObservableGauge(name);

  function expire() {
    const cutoff = now() - policy.activeWindowMs;
    for (const [key, user] of users) if (!user.inflight && user.lastSeen < cutoff) users.delete(key);
  }
  function sample() {
    expire();
    const result = [];
    const add = (name, value, attrs = {}) => result.push([instruments[name], value, attrs]);
    for (const domain of ['admin', 'gateway']) {
      add('ink_capacity_actor_hook_seen', actorHooks.has(domain) ? 1 : 0, { domain });
      const domainUsers = [...users.values()].filter(u => u.domain === domain);
      add('ink_users_active', domainUsers.length, { domain });
      add('ink_users_inflight', domainUsers.filter(u => u.inflight > 0).length, { domain });
      add('ink_account_inflight_max', domainUsers.reduce((max, u) => Math.max(max, u.inflight), 0), { domain });
      add('ink_account_inflight_peak', domainUsers.reduce((max, u) => Math.max(max, u.peak), 0), { domain });
      for (const user of domainUsers) user.peak = user.inflight;
    }
    for (const state of requests.values()) {
      add('ink_requests_inflight', state.inflight, state.attributes);
      add('ink_requests_inflight_peak', state.peak, state.attributes);
      state.peak = state.inflight;
    }
    add('ink_payload_queue_events', queuedEvents);
    add('ink_payload_queue_bytes', queuedBytes);
    for (const [pool, key] of POOLS) {
      const instance = globals[key];
      if (!instance) continue;
      const total = instance.totalCount, idle = instance.idleCount, waiting = instance.waitingCount;
      if (![total, idle, waiting].every(Number.isFinite)) continue;
      for (const [state, value] of [['total', total], ['idle', idle], ['busy', total - idle]]) {
        add('ink_db_pool_connections', value, { pool, state });
      }
      add('ink_db_pool_waiters', waiting, { pool });
    }
    add('ink_capacity_window_ready', now() - startedAt >= policy.activeWindowMs ? 1 : 0);
    add('ink_capacity_observation_complete', now() - lastOverflow >= policy.activeWindowMs && !observerErrors ? 1 : 0);
    add('ink_capacity_observer_errors', observerErrors);
    add('ink_capacity_active_window_seconds', policy.activeWindowMs / 1_000);
    return result;
  }
  const collect = result => safe(() => { for (const [instrument, value, attrs] of sample()) result.observe(instrument, value, attrs); });
  meter.addBatchObservableCallback(collect, Object.values(instruments));

  function begin(meta, response) {
    const key = meta.domain + ':' + meta.operation;
    let aggregate = requests.get(key);
    if (!aggregate) {
      aggregate = { attributes: meta, inflight: 0, peak: 0 };
      requests.set(key, aggregate);
    }
    aggregate.inflight += 1;
    aggregate.peak = Math.max(aggregate.peak, aggregate.inflight);
    const context = { meta, started: monotonic(), user: null, ended: false };
    const finish = outcome => {
      if (context.ended) return;
      context.ended = true;
      aggregate.inflight -= 1;
      if (context.user) { context.user.inflight -= 1; context.user.lastSeen = now(); }
      safe(() => {
        const attributes = { ...meta, outcome, status_class: String(Math.floor(response.statusCode / 100)) + 'xx' };
        completed.add(1, attributes);
        duration.record((monotonic() - context.started) / 1_000, attributes);
      });
    };
    response.once('finish', () => finish('finished'));
    response.once('close', () => finish(response.writableFinished ? 'finished' : 'cancelled'));
    return { context, finish };
  }

  const observer = {
    firstToken() {
      safe(() => {
        const context = storage.getStore();
        if (!context || context.ended || context.meta.domain !== 'gateway' || context.firstToken) return;
        context.firstToken = true;
        ttft.record((monotonic() - context.started) / 1_000, context.meta);
      });
    },
    authenticated(domain, actorId) {
      safe(() => {
        const context = storage.getStore();
        if (!context || context.ended || context.meta.domain !== domain || context.user) return;
        if (typeof actorId !== 'string' || !actorId || actorId.length > 256) return;
        actorHooks.add(domain);
        const key = domain + ':' + actorId;
        let user = users.get(key);
        if (!user) {
          expire();
          if (users.size >= policy.maxTrackedUsers) {
            lastOverflow = now(); dropped.add(1, { reason: 'actor_budget' }); return;
          }
          user = { domain, inflight: 0, peak: 0, lastSeen: now() };
          users.set(key, user);
        }
        context.user = user;
        user.lastSeen = now(); user.inflight += 1; user.peak = Math.max(user.peak, user.inflight);
        admission.record(user.inflight, { domain });
      });
    },
    operation(name, seconds, outcome) {
      safe(() => {
        if (!OPERATIONS.has(name) || !['success', 'error'].includes(outcome) || !Number.isFinite(seconds) || seconds < 0) return;
        const attrs = { operation: name, outcome };
        operations.add(1, attrs); operationDuration.record(seconds, attrs);
      });
    },
    accountLocked(client) { safe(() => { if (!locks.has(client)) locks.set(client, monotonic()); }); },
    transactionEnded(client) {
      safe(() => {
        const at = locks.get(client);
        if (at !== undefined) { locks.delete(client); lockHold.record((monotonic() - at) / 1_000); }
      });
    },
    queueDelta(events, bytes) {
      safe(() => {
        queuedEvents += events; queuedBytes += bytes;
        if (queuedEvents < 0 || queuedBytes < 0) { queuedEvents = Math.max(0, queuedEvents); queuedBytes = Math.max(0, queuedBytes); observerErrors += 1; }
      });
    },
    install(http) {
      if (globals.__inkCapacityObserverV1 || disposed) throw new Error('Capacity observer already installed or disposed');
      const original = http.Server.prototype.emit;
      function emit(event, ...args) {
        const meta = event === 'request' && classify(args[0]?.url);
        if (!meta) return Reflect.apply(original, this, [event, ...args]);
        let request;
        try { request = begin(meta, args[1]); }
        catch { observerErrors += 1; return Reflect.apply(original, this, [event, ...args]); }
        return storage.run(request.context, () => {
          try { return Reflect.apply(original, this, [event, ...args]); }
          catch (error) { request.finish('error'); throw error; }
        });
      }
      http.Server.prototype.emit = emit;
      globals.__inkCapacityObserverV1 = observer;
      return () => {
        if (http.Server.prototype.emit === emit) http.Server.prototype.emit = original;
        if (globals.__inkCapacityObserverV1 === observer) delete globals.__inkCapacityObserverV1;
        meter.removeBatchObservableCallback(collect, Object.values(instruments));
        storage.disable(); users.clear(); requests.clear(); disposed = true;
      };
    },
  };
  return observer;
}

// A single separately budgeted read-only pool avoids queueing a monitoring query in the business pool.
function startBacklogSampler({ meter, policy, createPool, now = Date.now }) {
  if (!Number.isSafeInteger(policy.backlogIntervalMs) || policy.backlogIntervalMs < 1) throw new Error('Explicit backlog interval required');
  const gauges = Object.fromEntries(['ink_gateway_unsettled_requests','ink_gateway_oldest_unsettled_age_seconds',
    'ink_gateway_backlog_sample_success','ink_gateway_backlog_last_success_timestamp_seconds']
    .map(name => [name, meter.createObservableGauge(name)]));
  const failed = meter.createCounter('ink_capacity_backlog_sample_failures_total');
  let pool, busy = false, stopped = false, last, success = false;
  const collect = result => {
    result.observe(gauges.ink_gateway_backlog_sample_success, success ? 1 : 0);
    if (!last) return;
    result.observe(gauges.ink_gateway_unsettled_requests, last.count, { state: 'settlement_failed' });
    result.observe(gauges.ink_gateway_oldest_unsettled_age_seconds, last.oldest ? Math.max(0, now() / 1_000 - last.oldest) : 0, { state: 'settlement_failed' });
    result.observe(gauges.ink_gateway_backlog_last_success_timestamp_seconds, last.at / 1_000);
  };
  meter.addBatchObservableCallback(collect, Object.values(gauges));
  async function sample() {
    if (busy || stopped) return;
    busy = true;
    try {
      pool ??= createPool();
      const result = await pool.query(`SELECT count(*)::int AS count,
        extract(epoch FROM min(COALESCE(completed_at, created_at)))::double precision AS oldest
        FROM gateway_requests WHERE status = 'settlement_failed' AND settled_at IS NULL`);
      if (!stopped) { last = { count: Number(result.rows[0].count), oldest: Number(result.rows[0].oldest) || null, at: now() }; success = true; }
    } catch {
      success = false;
      try { failed.add(1); } catch { /* Do not log database errors or credentials. */ }
    } finally { busy = false; }
  }
  const timer = setInterval(() => { void sample(); }, policy.backlogIntervalMs);
  timer.unref();
  return async () => {
    stopped = true; clearInterval(timer);
    meter.removeBatchObservableCallback(collect, Object.values(gauges));
    if (pool) await pool.end();
  };
}

module.exports = { createCapacityObserver, startBacklogSampler };
