import sys
import requests

# ====== 填写 Worker URL 与 API Key（请替换成真实值） ======
WORKER_URL = "https://your-worker-domain.workers.dev/v2/gemini"
API_KEY = "YOUR_GEMINI_API_KEY"
MODEL = "gemini-2.5-flash"
# ===============================================================

# 确保命令行传入了 question（必须）
if len(sys.argv) < 2:
    print("Usage: python gemini_raft.py \"your question here\"")
    sys.exit(2)

# 把所有参数拼成一个问题（支持不加引号分多词）
question = " ".join(sys.argv[1:]).strip()
if not question:
    print("Error: question is empty.")
    sys.exit(2)

payload = {
    "model": MODEL,
    "messages": [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": question}
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
    # 兼容 Worker 返回的格式：choices[0].message.content
    answer = data.get("choices", [{}])[0].get("message", {}).get("content")
    if answer:
        print(answer)
    else:
        print("No content in response. Full response:")
        print(data)
except requests.Timeout:
    print("Request timed out.")
except requests.HTTPError as e:
    print("HTTP error:", e, "Response:", getattr(e.response, "text", None))
except requests.RequestException as e:
    print("Request failed:", e)
except (KeyError, ValueError):
    print("Unexpected response:", r.text if 'r' in locals() else "no response")
