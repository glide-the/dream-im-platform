"""Input: synthetic SSE events only. Output: parser/metric contract evidence.
Pos: provider-free tests for the explicit real-stream harness; no HTTP/DB access.
Sync: 2026-10-02 — TTFT skips roles/reasoning and HTTP 200 never overrides stream failure.
"""
import importlib.util
import json
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location("benchmark", Path(__file__).resolve().parent / "benchmark-gateway-stream.py")
BENCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BENCH)


class StreamBenchmarkTest(unittest.TestCase):
    def observe(self):
        observation = BENCH.StreamObservation()
        observation.push(json.dumps({"choices": [{"delta": {"role": "assistant", "content": ""}}]}), 10)
        observation.push(json.dumps({"choices": [{"delta": {"reasoning_content": "synthetic"}}]}), 20)
        observation.push(json.dumps({"choices": [{"delta": {"content": " ".join(BENCH.EXPECTED)}}]}), 100)
        observation.push(json.dumps({"choices": [{"finish_reason": "stop", "delta": {}}], "usage": {
            "prompt_tokens": 30, "completion_tokens": 40, "total_tokens": 70}}), 200)
        observation.push("[DONE]", 220)
        return observation

    def test_ttft_ignores_role_and_reasoning(self):
        fields = self.observe().fields(200)
        self.assertEqual(fields["ttft_ms"], 100)
        self.assertEqual(fields["first_reasoning_ms"], 20)
        self.assertTrue(fields["quality_pass"])

    def test_stream_error_after_200_invalidates_success(self):
        observation = self.observe()
        observation.push('{"error":{"code":"SETTLEMENT_FAILED"}}', 230)
        self.assertFalse(observation.fields(200)["protocol_success"])
        self.assertFalse(observation.fields(200)["quality_pass"])

    def test_transport_failure_after_done_invalidates_success(self):
        fields = self.observe().fields(200, "IncompleteRead")
        self.assertFalse(fields["protocol_success"])
        self.assertFalse(fields["quality_pass"])

    def test_early_eof_and_invalid_json(self):
        observation = self.observe()
        observation.done = False
        self.assertFalse(observation.fields(200)["protocol_success"])
        observation.push("unparseable", 240)
        self.assertEqual(observation.error_code, "INVALID_STREAM_JSON")

    def test_nonempty_wrong_output_fails_quality(self):
        observation = self.observe()
        observation.content = "OK"
        self.assertTrue(observation.fields(200)["nonempty"])
        self.assertFalse(observation.fields(200)["quality_pass"])

    def test_metrics_use_walltime_and_usage_not_concurrency(self):
        row = {**self.observe().fields(200), "status": 200, "e2e_ms": 250, "error_code": None}
        value = BENCH.metrics([row] * 8, 4)
        self.assertEqual(value["effective_qps"], 2)
        self.assertEqual(value["output_tps"], 80)
        self.assertEqual(value["total_tps"], 140)
        self.assertEqual(value["ttft_p95_ms"], 100)
        self.assertIsNone(BENCH.percentile([], .95))
        self.assertEqual(BENCH.percentile([1, 2, 3, 100], .95), 100)


if __name__ == "__main__":
    unittest.main()
