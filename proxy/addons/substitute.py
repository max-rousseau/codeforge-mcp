"""
mitmproxy addon: outbound request rewriting.

Four transformations are applied on every request/response pair:

1. HTTP method restriction. Blocks requests whose method appears in the
   per-API restricted_methods list, returning a synthetic 403 before any
   credential substitution or forwarding occurs.
2. Bidirectional, per-host secret substitution. Each API config's credentials
   are scoped to that API's own `domains` list. Outbound requests to an
   unconfigured host receive no substitution — preventing a token literal
   from being swapped to the wrong destination. Inbound reverse substitution
   is likewise scoped to the source host, so the same real value may be
   reused across APIs without ambiguity.
3. PII redaction. Comma-separated strings from REDACTING_STRINGS are replaced
   with "REDACTED" on outbound requests, before credential substitution so a
   real credential value containing a redaction substring cannot be mangled.
   Redaction is global by design — it targets sandbox data, not per-host
   credentials.
4. User-Agent normalization. Overwrites the outbound User-Agent header with
   the value of USER_AGENT from the environment, hiding the sandbox runtime
   (e.g. "Deno/2.3.1") behind a single consistent identity.
"""

import json
import os
import sys
import glob
from datetime import datetime, timezone
from mitmproxy import http


APIS_DIR = os.environ["APIS_DIR"]
USER_AGENT = os.environ["USER_AGENT"]
REDACTING_STRINGS = os.environ["REDACTING_STRINGS"]
DEBUG_MODE = os.environ["DEBUG_MODE"].lower() == "true"


def _log(msg: str) -> None:
    """Bypass mitmproxy's log filtering — print directly to stderr so our addon
    output survives `-q` / `--set termlog_verbosity=warn`."""
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    print(f"[{ts}] {msg}", file=sys.stderr, flush=True)


class SecretSubstitution:
    def __init__(self):
        self.forward_by_host: dict[str, dict[str, str]] = {}
        self.reverse_by_host: dict[str, dict[str, str]] = {}
        self.restricted: dict[str, set[str]] = {}
        self.redact: dict[str, str] = {}

    def load(self, loader):
        self._load_config()
        self._load_redactions()

    def _load_config(self):
        self.forward_by_host = {}
        self.reverse_by_host = {}
        self.restricted = {}

        credential_count = 0
        for config_path in glob.glob(f"{APIS_DIR}/*/config.json"):
            try:
                with open(config_path) as f:
                    config = json.load(f)
                if config.get("active") is False:
                    continue
                credentials = config.get("credentials", {})
                domains = config.get("domains", [])
                for domain in domains:
                    forward = self.forward_by_host.setdefault(domain, {})
                    reverse = self.reverse_by_host.setdefault(domain, {})
                    for token_name, real_value in credentials.items():
                        forward[token_name] = real_value
                        reverse[real_value] = token_name
                credential_count += len(credentials)
                restricted = config.get("restricted_methods")
                if restricted:
                    methods = {m.upper() for m in restricted}
                    for domain in domains:
                        self.restricted.setdefault(domain, set()).update(methods)
            except Exception as e:
                _log(f"[error] Failed to load {config_path}: {e}")

        _log(
            f"Loaded {credential_count} credential(s) across {len(self.forward_by_host)} host(s), "
            f"{len(self.restricted)} host(s) with method restrictions"
        )

    def _load_redactions(self):
        entries = [s.strip() for s in REDACTING_STRINGS.split(",") if s.strip()]
        self.redact = {s: "REDACTED" for s in entries}
        _log(f"Loaded {len(self.redact)} redaction string(s)")

    @staticmethod
    def _ordered(mapping: dict[str, str]) -> list[tuple[str, str]]:
        # Longest source first so prefix-overlapping tokens (e.g. API_KEY vs API_KEY_2)
        # do not partially substitute inside one another.
        return sorted(mapping.items(), key=lambda kv: -len(kv[0]))

    def _sub_bytes(self, data: bytes, mapping: dict[str, str]) -> bytes:
        for src, dst in self._ordered(mapping):
            data = data.replace(src.encode(), dst.encode())
        return data

    def _sub_headers(self, headers, mapping: dict[str, str]):
        ordered = self._ordered(mapping)
        for key in list(headers.keys()):
            val = headers[key]
            for src, dst in ordered:
                val = val.replace(src, dst)
            headers[key] = val

    def _is_text(self, content_type: str | None) -> bool:
        if not content_type:
            return False
        return any(t in content_type for t in ("json", "text", "xml", "html", "javascript", "urlencoded"))

    def _debug_request(self, flow: http.HTTPFlow):
        _log(f"[debug] >>> {flow.request.method} {flow.request.pretty_url}")
        for k, v in flow.request.headers.items():
            _log(f"[debug] >>> {k}: {v}")
        if flow.request.content and self._is_text(flow.request.headers.get("content-type")):
            _log(f"[debug] >>> Body: {flow.request.content.decode(errors='replace')}")

    def _debug_response(self, flow: http.HTTPFlow):
        if not flow.response:
            return
        _log(f"[debug] <<< {flow.response.status_code} {flow.request.pretty_url}")
        for k, v in flow.response.headers.items():
            _log(f"[debug] <<< {k}: {v}")
        if flow.response.content and self._is_text(flow.response.headers.get("content-type")):
            _log(f"[debug] <<< Body: {flow.response.content.decode(errors='replace')}")

    def request(self, flow: http.HTTPFlow):
        # `pretty_host` prefers the Host header / SNI over the URL host, which in
        # transparent mode is the destination IP rather than the hostname.
        host = flow.request.pretty_host
        _log(f"[req] {flow.request.method} {host}{flow.request.path}")
        if DEBUG_MODE:
            self._debug_request(flow)

        restricted = self.restricted.get(host)
        if restricted and flow.request.method in restricted:
            _log(f"[restrict] {flow.request.method} {host} blocked")
            flow.response = http.Response.make(
                403,
                json.dumps({
                    "error": (
                        f"HTTP {flow.request.method} is restricted for {host}. "
                        f"Restricted methods: {', '.join(sorted(restricted))}. "
                        f"This is a permanent configuration restriction, not a transient error."
                    )
                }),
                {"Content-Type": "application/json"},
            )
            return

        # Redact PII before injecting credentials so redaction operates only on
        # sandbox-supplied bytes — otherwise a real credential value containing a
        # redaction substring would be silently mangled on the wire.
        if self.redact:
            orig = flow.request.content
            if flow.request.content:
                flow.request.content = self._sub_bytes(flow.request.content, self.redact)
            self._sub_headers(flow.request.headers, self.redact)
            if flow.request.content != orig:
                _log(f"[redact] {flow.request.method} {host} — PII scrubbed from request")

        forward = self.forward_by_host.get(host, {})
        if forward:
            orig_content = flow.request.content
            if flow.request.content:
                flow.request.content = self._sub_bytes(flow.request.content, forward)
            self._sub_headers(flow.request.headers, forward)
            tokens = ", ".join(sorted(forward.keys()))
            _log(f"[inject] {flow.request.method} {host} — tokens: {tokens}")

        flow.request.headers["User-Agent"] = USER_AGENT

    def response(self, flow: http.HTTPFlow):
        if not flow.response:
            return
        host = flow.request.pretty_host
        reverse = self.reverse_by_host.get(host, {})
        if not reverse:
            if DEBUG_MODE:
                self._debug_response(flow)
            return
        orig = flow.response.content
        if flow.response.content:
            flow.response.content = self._sub_bytes(flow.response.content, reverse)
        self._sub_headers(flow.response.headers, reverse)
        if flow.response.content != orig:
            _log(f"[sanitize] {host} — credentials scrubbed from response")
        if DEBUG_MODE:
            self._debug_response(flow)


addons = [SecretSubstitution()]
