// Cloudflare Workers AI API 代理脚本
// 核心功能：解析请求，代理到指定AI供应商，支持缓存（v2）

function parseKey(headers) {
    // 从headers提取API密钥，确保安全解析（避免泄露）
    const auth = headers.get("authorization") ?? "";
    return auth.startsWith("Bearer ") ? auth.slice(7) : "";
  }
  
  async function sha256(message) {
    // 使用CF内置crypto计算SHA256哈希，用于缓存键（高效、安全）
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  
  class BaseInference {
    constructor(supplier, endpoint) {
      this.supplier = supplier;
      this.endpoint = endpoint;
    }
  
    async handle(req) {
      const apiKey = parseKey(req.headers);
      if (!apiKey) {
        return new Response(JSON.stringify({ error: "Missing API key" }), { status: 401 });
      }
      const body = await req.json();
      const stream = body.stream ?? false;
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        return new Response(JSON.stringify({ error: "API request failed" }), { status: response.status });
      }
      return stream ? new Response(response.body, { headers: { "Content-Type": "text/event-stream" } }) 
                    : new Response(await response.text(), { headers: { "Content-Type": "application/json" } });
    }
  }
  
  class GeminiInference extends BaseInference {
    constructor() {
      super("gemini", "https://generativelanguage.googleapis.com/v1beta/models");
      this.fallback = "https://generativelanguage.googleapis.com/v1beta/models"; // 用官方备用，确保无外部依赖
    }
  
    async prepareData(body) {
      // Gemini特定输入格式化（角色映射、配置），确保兼容
      const messages = body.messages.map(msg => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }]
      }));
      if (messages[0]?.role !== "user") messages.shift();
      return {
        contents: messages,
        generationConfig: {
          temperature: body.temperature ?? 0.9,
          maxOutputTokens: body.max_tokens ?? 4096,
          topP: body.top_p ?? 0.95,
          topK: body.top_logprobs ?? 32
        }
      };
    }
  
    async handle(req) {
      try {
        const body = await req.json();
        const model = body.model ?? "gemini-1.5-flash";
        const key = parseKey(req.headers);
        if (!key) return new Response(JSON.stringify({ error: "Missing API key" }), { status: 401 });
        const input = await this.prepareData(body);
        let response = await this.tryEndpoint(`${this.endpoint}/${model}:generateContent?key=${key}`, input);
        if (!response) response = await this.tryEndpoint(`${this.fallback}/${model}:generateContent?key=${key}`, input);
        if (!response) return new Response(JSON.stringify({ error: "Endpoints failed" }), { status: 500 });
        const data = await response.json();
        if (response.status !== 200) return new Response(JSON.stringify(data), { status: response.status });
        const reformatted = { choices: [{ message: { content: data.candidates?.[0]?.content?.parts?.[0]?.text ?? "No content available", role: "model" } }] };
        return new Response(JSON.stringify(reformatted), { headers: { "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: "Internal processing error" }), { status: 500 });
      }
    }
  
    async tryEndpoint(url, input) {
      try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
        return res.ok ? res : null;
      } catch {
        return null;
      }
    }
  }
  
  async function cachedFetch(req, infer, ctx) {
    // v2缓存逻辑，使用SHA256哈希作为键，缓存成功响应（高效，避免重复请求）
    const bodyText = await req.clone().text();
    const hash = await sha256(bodyText);
    const url = new URL(req.url);
    const cacheUrl = new URL(`/post${url.pathname}/${url.searchParams.get("supplier") ?? "openai"}/${hash}`, url.origin);
    const cache = caches.default;
    let response = await cache.match(cacheUrl);
    if (!response) {
      response = await infer.handle(req);
      if (response.status === 200) {
        const cachedRes = new Response(response.clone().body, {
          status: response.status,
          headers: { "Content-Type": "application/json", "Cache-Control": "max-age=300" }
        });
        ctx.waitUntil(cache.put(cacheUrl, cachedRes));
      }
    }
    return response;
  }
  
  export default {
    async fetch(req, env, ctx) {
      if (req.method !== "POST") return new Response("Only POST allowed.", { status: 405 });
      const url = new URL(req.url);
      const version = url.pathname.split("/")[1];
      const supplier = url.pathname.split("/")[2] ?? req.headers.get("supplier") ?? "openai";
      let infer;
      switch (supplier) {
        case "openai": infer = new BaseInference("openai", "https://api.openai.com/v1/chat/completions"); break;
        case "groq": infer = new BaseInference("groq", "https://api.groq.com/openai/v1/chat/completions"); break;
        case "mistral": infer = new BaseInference("mistral", "https://api.mistral.ai/v1/chat/completions"); break;
        case "gemini": infer = new GeminiInference(); break;
        default: return new Response("Unsupported supplier", { status: 404 });
      }
      // 根据版本分发，v2带缓存，v1直连（现代路由逻辑）
      return version === "v2" ? await cachedFetch(req, infer, ctx) : await infer.handle(req);
    }
  };
