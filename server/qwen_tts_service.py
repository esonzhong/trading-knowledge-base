#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import hashlib
import json
import os
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from socketserver import ThreadingMixIn


ENDPOINT = os.getenv("QWEN_TTS_ENDPOINT", "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation")
API_KEY = os.getenv("DASHSCOPE_API_KEY", "")
MODEL = os.getenv("QWEN_TTS_MODEL", "qwen3-tts-flash")
VOICE = os.getenv("QWEN_TTS_VOICE", "Cherry")
ALLOWED_ORIGIN = os.getenv("TTS_ALLOWED_ORIGIN", "https://esonzhong.github.io")
MAX_TEXT_LEN = int(os.getenv("QWEN_TTS_MAX_TEXT_LEN", "580"))
CACHE_DIR = Path(os.getenv("QWEN_TTS_CACHE_DIR", "/opt/qwen-tts/cache"))


def find_audio_url(value):
    if isinstance(value, dict):
        for key in ("url", "audio_url", "audioUrl"):
            item = value.get(key)
            if isinstance(item, str) and item.startswith(("http://", "https://")):
                return item
        for item in value.values():
            found = find_audio_url(item)
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = find_audio_url(item)
            if found:
                return found
    return None


def cache_key(text):
    raw = "|".join([ENDPOINT, MODEL, VOICE, text])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def is_audio_url_valid(url):
    try:
        expires = urllib.parse.parse_qs(urllib.parse.urlparse(url).query).get("Expires", ["0"])[0]
        return int(expires) > int(time.time()) + 600
    except Exception:
        return False


def read_cache(key):
    path = CACHE_DIR / (key + ".json")
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        audio_url = data.get("audioUrl")
        if audio_url and is_audio_url_valid(audio_url):
            return data
    except Exception:
        return None
    return None


def write_cache(key, data):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / (key + ".json")
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class Handler(BaseHTTPRequestHandler):
    server_version = "QwenTTS/1.1"

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        super().end_headers()

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/health"):
            self.send_json(200, {"status": "ok"})
        else:
            self.send_json(404, {"error": "not_found"})

    def do_POST(self):
        if not self.path.startswith("/tts"):
            self.send_json(404, {"error": "not_found"})
            return
        if not API_KEY:
            self.send_json(500, {"error": "server_missing_api_key"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8-sig"))
            text = str(payload.get("text", "")).strip()
            if not text:
                self.send_json(400, {"error": "empty_text"})
                return
            if len(text) > MAX_TEXT_LEN:
                text = text[:MAX_TEXT_LEN] + "。"

            key = cache_key(text)
            cached = read_cache(key)
            if cached:
                cached["cached"] = True
                self.send_json(200, cached)
                return

            req_body = json.dumps({
                "model": MODEL,
                "input": {
                    "text": text,
                    "voice": VOICE,
                    "language_type": "Chinese"
                }
            }, ensure_ascii=False).encode("utf-8")
            request = urllib.request.Request(
                ENDPOINT,
                data=req_body,
                method="POST",
                headers={
                    "Authorization": "Bearer " + API_KEY,
                    "Content-Type": "application/json"
                },
            )
            with urllib.request.urlopen(request, timeout=90, context=ssl.create_default_context()) as resp:
                result = json.loads(resp.read().decode("utf-8"))
            audio_url = find_audio_url(result)
            status_code = int(result.get("status_code", 200)) if isinstance(result, dict) else 200
            if not audio_url or status_code >= 400:
                self.send_json(502, {"error": "qwen_tts_failed", "detail": result})
                return
            response = {
                "audioUrl": audio_url,
                "deckId": payload.get("deckId"),
                "cardId": payload.get("cardId"),
                "answerOpen": payload.get("answerOpen", False),
                "cached": False
            }
            write_cache(key, response)
            self.send_json(200, response)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")
            self.send_json(502, {"error": "qwen_http_error", "status": exc.code, "detail": detail})
        except Exception as exc:
            self.send_json(500, {"error": "server_error", "detail": str(exc)})

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)


if __name__ == "__main__":
    host = os.getenv("TTS_HOST", "127.0.0.1")
    port = int(os.getenv("TTS_PORT", "8787"))
    ThreadingHTTPServer((host, port), Handler).serve_forever()
