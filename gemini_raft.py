#!/usr/bin/env python3
# filename: neo_gemini.py
# Run: WORKER_URL="https://your-worker.workers.dev/v2/gemini" API_KEY="xxx" python3 neo_gemini.py

import os
import sys
import requests

WORKER_URL = os.environ.get("WORKER_URL")
API_KEY = os.environ.get("API_KEY")
MODEL = "gemini-2.5-flash"

if not WORKER_URL or not API_KEY:
    print("Please set WORKER_URL and API_KEY environment variables.")
    sys.exit(2)

payload = {
    "model": MODEL,
    "messages": [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "What is the meaning of life?"}
    ],
    "temperature": 0.7,
    "top_p": 1,
    "max_tokens": 1024,
    "top_logprobs": 32
}

try:
    r = requests.post(
        WORKER_URL,
        json=payload,
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
        timeout=30
    )
    r.raise_for_status()
    data = r.json()
    print(data["choices"][0]["message"]["content"])
except requests.Timeout:
    print("Request timed out.")
except requests.HTTPError as e:
    print("HTTP error:", e, "Response:", getattr(e.response, "text", None))
except requests.RequestException as e:
    print("Request failed:", e)
except (KeyError, ValueError):
    print("Unexpected response:", r.text if 'r' in locals() else "no response")
