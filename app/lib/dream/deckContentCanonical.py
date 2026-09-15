# [Input] Fixed JSON-only aggregate facts or memory JSON, never SQL/paths/credentials.
# [Output] Exact existing Python deck-content/v1 canonical bytes/hash/diff, with safe failure.
# [Pos] Fixed Admin stdlib codec for domain facts; no SQL, network, service or Runtime execution.
# [Sync] 2026-09-15: preserve canonical bytes, claim equality, memory dictionaries and three capability-set decoders.
import hashlib
import json
import sys


def canonical(value, *, allow_nan=True):
    return json.dumps(value, ensure_ascii=False, allow_nan=allow_nan, separators=(",", ":"), sort_keys=True)


def json_value(raw):
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return raw


def change(scope, label, change_type="modified", fields=None):
    return {"scope": scope, "label": label, "change_type": change_type, "fields": fields or []}


def diff(base, current):
    if base is None:
        changes = [change("deck", "Deck 基础信息", "added"), change("agent_type", "Agent 类型", "added")]
        for key, label in (("agents", "Agents"), ("claude_plugins", "Claude 插件"), ("runtime_binding", "运行绑定")):
            if current.get(key):
                changes.append(change(key, label, "added"))
        return changes
    changes = []
    old = base.get("deck") if isinstance(base.get("deck"), dict) else {}
    new = current.get("deck") if isinstance(current.get("deck"), dict) else {}
    fields = sorted(key for key in set(old) | set(new) if old.get(key) != new.get(key))
    if fields:
        changes.append(change("deck", "Deck 基础信息", fields=fields))
    if base.get("agent_type") != current.get("agent_type"):
        changes.append(change("agent_type", "Agent 类型", fields=["agent_type"]))
    for key, label in (("agents", "Agents"), ("claude_plugins", "Claude 插件"), ("runtime_binding", "运行绑定")):
        if base.get(key) != current.get(key):
            changes.append(change(key, label))
    return changes



def confirmation_envelope(raw_parts, actor):
    try:
        parts = json.loads(raw_parts)
        if not isinstance(parts, list) or len(parts) != 1 or not isinstance(parts[0], dict):
            return {"status": "invalid"}
        if parts[0].get("type") != "text" or not isinstance(parts[0].get("text"), str):
            return {"status": "invalid"}
        envelope = json.loads(parts[0]["text"])
        if not isinstance(envelope, dict) or envelope.get("kind") != "story-workspace-dream-confirmation":
            return {"status": "invalid"}
        command = envelope.get("command")
        if not isinstance(command, dict) or not isinstance(actor, str) or not actor:
            return {"status": "invalid"}
        run, thread, key = (command.get(name) for name in ("storyWorkspaceRunId", "threadId", "idempotencyKey"))
        if not all(isinstance(value, str) and bool(value) for value in (run, thread, key)):
            return {"status": "invalid"}
        command_json = canonical(command, allow_nan=False)
        fingerprint_input = canonical({"actor": actor, "command": command}, allow_nan=False)
        message_input = canonical({"actor": actor, "storyWorkspaceRunId": run, "idempotencyKey": key}, allow_nan=False)
        return {"status": "valid", "story_workspace_run_id": run, "thread_id": thread, "idempotency_key": key,
                "command_json": command_json, "command_fingerprint": "sha256:" + hashlib.sha256(fingerprint_input.encode()).hexdigest(),
                "message_id": "dream_confirm_" + hashlib.sha256(message_input.encode()).hexdigest(),
                "parts_canonical_json": canonical(parts, allow_nan=False)}
    except (ValueError, TypeError):
        return {"status": "invalid"}


def confirmation_claims(left_raw, right_raw):
    try:
        left, right = json.loads(left_raw), json.loads(right_raw)
        if not isinstance(left, dict) or not isinstance(right, dict):
            return {"equal": False}
        left.pop("dispatch_claim_lease_until", None)
        right.pop("dispatch_claim_lease_until", None)
        return {"equal": left == right}
    except (ValueError, TypeError):
        return {"equal": False}


def execute(request):
    if request.get("action") == "plugin-capability-sets":
        try:
            parsed = json.loads(request["json_text"] or "[]")
        except (ValueError, TypeError):
            parsed = None
        context = {item.strip() for item in parsed if isinstance(item, str) and item.strip()} if isinstance(parsed, list) else set()
        approved = set(parsed) if isinstance(parsed, list) and all(isinstance(item, str) for item in parsed) else set()
        try:
            preflight = {item for item in set(parsed) if isinstance(item, str)}
        except TypeError:
            preflight = set()
        return {"context_names": sorted(context), "approved_names": sorted(approved), "preflight_names": sorted(preflight)}
    if request.get("action") == "memory-inspect":
        return {"is_object": isinstance(json_value(request["json_text"]), dict)}
    if request.get("action") == "confirmation-envelope":
        return confirmation_envelope(request["raw_parts_json"], request["actor_id"])
    if request.get("action") == "confirmation-claims":
        return confirmation_claims(request["stored_metadata_json"], request["incoming_metadata_json"])
    if request.get("action") == "canonical":
        value = json.loads(request["json_text"])
        text = canonical(value, allow_nan=False)
        return {"canonical_json": text, "content_hash": "sha256:" + hashlib.sha256(text.encode()).hexdigest()}
    if request.get("action") == "memory":
        left = json_value(request["left"])
        right = json_value(request["right"])
        return {"equal": canonical(left) == canonical(right), "canonical_json": canonical(right)}
    if request.get("action") == "snapshot":
        current = request["facts"]
        for agent in current["agents"]:
            agent["memory_workspace_config"] = json_value(agent.pop("memory_workspace_config_json"))
        base = json_value(request["base_json"])
        if base is not None and not isinstance(base, dict):
            raise ValueError("Invalid snapshot")
        text = canonical(current)
        digest = lambda value: "sha256:" + hashlib.sha256(canonical(value).encode()).hexdigest()
        changes = diff(base, current)
        return {"canonical_json": text, "content_hash": digest(current), "changes": changes, "no_changes": not changes or (base is not None and digest(base) == digest(current))}
    raise ValueError("Unknown action")


if __name__ == "__main__":
    try:
        json.dump(execute(json.load(sys.stdin)), sys.stdout, ensure_ascii=True, separators=(",", ":"))
    except Exception:
        sys.stderr.write("DECK_CANONICAL_FAILED\n")
        sys.exit(1)
