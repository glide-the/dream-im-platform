#!/usr/bin/env python3
"""Input: explicit private Gateway credential file and bounded real-call workload.
Output: redacted per-request streaming timings/usage and phase metrics, never bodies/secrets.
Pos: public production Gateway benchmark harness; no DB/config/service mutation.
Sync: 2026-10-02 — separate content TTFT, concurrency, quality QPS and reported Token TPS.
"""

import argparse
import concurrent.futures
import datetime as dt
import json
import math
import os
import re
import stat
import threading
import time
import urllib.error
import urllib.request
import uuid
from collections import Counter
from pathlib import Path


EXPECTED = [str(n) for n in range(1, 21)]
PROMPT = "Output the integers from 1 to 20, separated by single spaces. Output only the integers, with no explanation."


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def percentile(values, p):
    """Nearest-rank percentile; never average phase percentiles."""
    ordered = sorted(v for v in values if v is not None)
    return round(ordered[max(0, math.ceil(len(ordered) * p) - 1)], 3) if ordered else None


class StreamObservation:
    """Only accumulated synthetic output stays in memory for quality checking."""
    def __init__(self):
        self.content = ""
        self.first_content_ms = None
        self.last_content_ms = None
        self.first_reasoning_ms = None
        self.content_chunks = 0
        self.done = False
        self.finish_reason = None
        self.usage = None
        self.error_code = None

    def push(self, data, elapsed_ms):
        if data.strip() == "[DONE]":
            self.done = True
            return
        try:
            event = json.loads(data)
        except (ValueError, TypeError):
            self.error_code = "INVALID_STREAM_JSON"
            return
        if not isinstance(event, dict):
            self.error_code = "INVALID_STREAM_EVENT"
            return
        if event.get("error"):
            error = event["error"]
            code = error.get("code") if isinstance(error, dict) else None
            self.error_code = safe_code(code, "STREAM_ERROR")
        usage = event.get("usage")
        if isinstance(usage, dict) and all(
            isinstance(usage.get(k), int) and not isinstance(usage[k], bool) and usage[k] >= 0
            for k in ("prompt_tokens", "completion_tokens", "total_tokens")
        ):
            self.usage = {k: usage[k] for k in ("prompt_tokens", "completion_tokens", "total_tokens")}
        for choice in event.get("choices", []):
            if choice.get("index", 0) != 0:
                continue
            if choice.get("finish_reason") is not None:
                self.finish_reason = choice["finish_reason"]
            delta = choice.get("delta") or {}
            content = delta.get("content")
            if isinstance(content, str) and content:
                if self.first_content_ms is None:
                    self.first_content_ms = elapsed_ms
                self.last_content_ms = elapsed_ms
                self.content_chunks += 1
                self.content += content
            reasoning = delta.get("reasoning_content")
            if isinstance(reasoning, str) and reasoning and self.first_reasoning_ms is None:
                self.first_reasoning_ms = elapsed_ms

    def fields(self, http_status, transport_error=None):
        complete = http_status == 200 and self.done and self.error_code is None and transport_error is None and self.finish_reason is not None
        nonempty = bool(self.content.strip())
        quality = complete and self.usage is not None and self.finish_reason == "stop" and self.content.split() == EXPECTED
        return {
            "protocol_success": complete,
            "nonempty": nonempty,
            "quality_pass": quality,
            "ttft_ms": self.first_content_ms,
            "last_content_ms": self.last_content_ms,
            "first_reasoning_ms": self.first_reasoning_ms,
            "content_chunks": self.content_chunks,
            "content_characters": len(self.content),
            "done": self.done,
            "finish_reason": self.finish_reason,
            "usage": self.usage,
            "stream_error_code": self.error_code,
        }


def safe_code(value, fallback):
    return value if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_\-]{1,80}", value) else fallback


def metrics(rows, elapsed):
    elapsed = round(elapsed, 6)  # Saved denominator is authoritative for independently reproducible rates.
    good = [r for r in rows if r["quality_pass"]]
    protocol = [r for r in rows if r["protocol_success"]]
    usage_rows = [r for r in protocol if r["usage"] is not None]
    totals = {k: sum(r["usage"][k] for r in usage_rows) for k in ("prompt_tokens", "completion_tokens", "total_tokens")}
    latency_rows = protocol
    ttft_rows = [r for r in protocol if r["ttft_ms"] is not None]
    result = {
        "attempted": len(rows), "http200": sum(r["status"] == 200 for r in rows),
        "protocol_success": len(protocol), "quality_pass": len(good),
        "empty_http200": sum(r["status"] == 200 and not r["nonempty"] for r in rows),
        "quality_failure": len(rows) - len(good),
        "statuses": dict(Counter(str(r["status"]) for r in rows)),
        "errors": dict(Counter(r["error_code"] or r["stream_error_code"] for r in rows if r["error_code"] or r["stream_error_code"])),
        "elapsed_seconds": round(elapsed, 6),
        "attempt_qps": round(len(rows) / elapsed, 4),
        "http200_qps": round(sum(r["status"] == 200 for r in rows) / elapsed, 4),
        "protocol_qps": round(len(protocol) / elapsed, 4),
        "effective_qps": round(len(good) / elapsed, 4),
        "usage_requests": len(usage_rows), "reported_tokens": totals,
        "input_tps": round(totals["prompt_tokens"] / elapsed, 4),
        "output_tps": round(totals["completion_tokens"] / elapsed, 4),
        "total_tps": round(totals["total_tokens"] / elapsed, 4),
        "ttft_samples": len(ttft_rows), "e2e_samples": len(latency_rows),
    }
    for name, sample in (("ttft", [r["ttft_ms"] for r in ttft_rows]), ("e2e", [r["e2e_ms"] for r in latency_rows])):
        for label, rank in (("p50", .50), ("p95", .95), ("p99", .99)):
            result[f"{name}_{label}_ms"] = percentile(sample, rank)
    return result


def call_gateway(base_url, key, model, phase, max_tokens, timeout):
    observation = StreamObservation()
    result = {"model": model, "phase": phase, "idempotency_key": str(uuid.uuid4()),
              "started_at": utc_now(), "status": None, "request_id": None, "error_code": None, "ttfb_ms": None}
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": PROMPT}],
                       "max_tokens": max_tokens, "stream": True, "stream_options": {"include_usage": True}}).encode()
    request = urllib.request.Request(base_url.rstrip("/") + "/chat/completions", data=body,
                                     headers={"Authorization": "Bearer " + key, "Content-Type": "application/json",
                                              "Idempotency-Key": result["idempotency_key"]})
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result["status"] = response.status
            result["request_id"] = response.headers.get("x-request-id")
            result["ttfb_ms"] = (time.perf_counter() - started) * 1000
            lines = []
            # Read to EOF after DONE: Gateway settlement/payload persistence may precede stream close.
            while True:
                raw = response.readline()
                if not raw:
                    break
                line = raw.decode("utf-8").rstrip("\r\n")
                if line.startswith("data:"):
                    lines.append(line[5:].lstrip(" "))
                elif not line and lines:
                    observation.push("\n".join(lines), (time.perf_counter() - started) * 1000)
                    lines = []
            if lines:
                observation.push("\n".join(lines), (time.perf_counter() - started) * 1000)
    except urllib.error.HTTPError as error:
        result["status"] = error.code
        result["request_id"] = error.headers.get("x-request-id")
        try:
            parsed = json.loads(error.read(65536))
            result["error_code"] = safe_code((parsed.get("error") or {}).get("code"), "HTTP_ERROR")
        except (ValueError, AttributeError):
            result["error_code"] = "HTTP_ERROR"
    except Exception as error:
        result["error_code"] = safe_code(type(error).__name__, "CLIENT_ERROR")
    result["e2e_ms"] = (time.perf_counter() - started) * 1000
    result.update(observation.fields(result["status"], result["error_code"]))
    if result["status"] == 200 and not result["protocol_success"] and not result["stream_error_code"] and not result["error_code"]:
        result["error_code"] = "INCOMPLETE_STREAM"
    for k, v in result.items():
        if isinstance(v, float):
            result[k] = round(v, 3)
    return result


def run_phase(base_url, key, model, concurrency, limit, seconds, max_tokens, timeout):
    phase = f"c{concurrency}"
    lock = threading.Lock()
    barrier = threading.Barrier(concurrency + 1)
    rows = []
    submitted = 0
    stop = False
    start = None

    def worker():
        nonlocal submitted, stop
        barrier.wait()
        while True:
            with lock:
                if stop or submitted >= limit or time.perf_counter() - start >= seconds:
                    return
                submitted += 1
            row = call_gateway(base_url, key, model, phase, max_tokens, timeout)
            with lock:
                rows.append(row)
                if not row["quality_pass"]:
                    stop = True

    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:
        jobs = [pool.submit(worker) for _ in range(concurrency)]
        start = time.perf_counter()
        barrier.wait()
        for job in jobs:
            job.result()
    elapsed = time.perf_counter() - start
    result = {"model": model, "concurrency": concurrency, "request_limit": limit, "issue_window_seconds": seconds,
              "stop_reason": "quality_failure" if stop else "request_limit" if submitted >= limit else "time_limit",
              **metrics(rows, elapsed)}
    return rows, result


def read_secret(path):
    target = Path(path)
    info = target.lstat()
    if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600:
        raise ValueError("credential file must be a regular mode-0600 file")
    if stat.S_IMODE(target.parent.stat().st_mode) != 0o700:
        raise ValueError("credential parent must be mode-0700")
    value = json.loads(target.read_text())
    if not value.get("api_key") or not value.get("base_url"):
        raise ValueError("explicit credential and public Gateway URL required")
    return value


def save(path, value):
    target = Path(path)
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    os.replace(temporary, target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--secret-file", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--seconds", type=float, default=30)
    parser.add_argument("--max-tokens", type=int, default=128)
    parser.add_argument("--timeout", type=float, default=90)
    args = parser.parse_args()
    if not 0 < args.seconds <= 30 or not 1 <= args.max_tokens <= 128 or not 0 < args.timeout <= 90:
        parser.error("workload exceeds bounded harness limits")
    secret = read_secret(args.secret_file)
    base_url, key = secret["base_url"], secret["api_key"]
    catalog_request = urllib.request.Request(base_url.rstrip("/") + "/models", headers={"Authorization": "Bearer " + key})
    with urllib.request.urlopen(catalog_request, timeout=args.timeout) as response:
        catalog = json.load(response)
    models = sorted(item["id"] for item in catalog["data"])
    report = {"started_at": utc_now(), "models": models, "requests": [], "phases": [], "calibration": [],
              "method": {"protocol": "OpenAI Chat Completions SSE", "client": "Python urllib HTTP/1.1, per-call connection",
                         "load": "closed-loop, one outstanding request per worker", "levels": [1, 4, 8, 16],
                         "per_phase_limits": [16, 24, 32, 48], "issue_window_seconds": args.seconds,
                         "per_model_request_maximum": 122, "requested_max_tokens": args.max_tokens,
                         "prompt": PROMPT, "quality_rule": "finished stop + DONE + usage + exact whitespace-separated integers 1..20",
                         "automatic_client_retries": 0, "response_bodies_saved": False,
                         "ttft_definition": "request start to first nonempty delta.content; role/empty/reasoning events excluded",
                         "percentiles": "nearest rank", "tps_definition": "reported usage for protocol-success requests / phase elapsed including drain",
                         "phase_stop": "any failed quality check stops new issuance; outstanding calls finish"}}
    save(args.output, report)
    eligible = []
    # All enabled models receive the same quality gate before performance stages.
    for model in models:
        rows = []
        for phase in ("quality_gate", "warmup"):
            row = call_gateway(base_url, key, model, phase, args.max_tokens, args.timeout)
            rows.append(row)
            report["requests"].append(row)
            if not row["quality_pass"]:
                break
        passed = len(rows) == 2 and all(r["quality_pass"] for r in rows)
        report["calibration"].append({"model": model, "eligible": passed, "attempted": len(rows),
                                      "quality_pass": sum(r["quality_pass"] for r in rows),
                                      "ttft_ms": rows[0]["ttft_ms"], "status": rows[0]["status"],
                                      "error_code": rows[0]["error_code"] or rows[0]["stream_error_code"],
                                      "content_characters": rows[0]["content_characters"], "finish_reason": rows[0]["finish_reason"]})
        if passed:
            eligible.append(model)
        save(args.output, report)
        print(json.dumps({"calibration": report["calibration"][-1]}, ensure_ascii=False), flush=True)
    for model in eligible:
        for concurrency, limit in zip((1, 4, 8, 16), (16, 24, 32, 48)):
            rows, phase = run_phase(base_url, key, model, concurrency, limit, args.seconds, args.max_tokens, args.timeout)
            report["requests"].extend(rows)
            report["phases"].append(phase)
            save(args.output, report)
            print(json.dumps({"phase": phase}, ensure_ascii=False), flush=True)
            if phase["quality_failure"]:
                break
    report["finished_at"] = utc_now()
    save(args.output, report)
    print(json.dumps({"finished_at": report["finished_at"], "requests": len(report["requests"]), "phases": len(report["phases"])}), flush=True)


if __name__ == "__main__":
    main()
