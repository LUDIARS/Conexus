/** Consumer-side transport only: business authorization stays in the calling service. */
export class ConexusClient {
  constructor(private readonly endpoint: string, private readonly token: () => string) {
    const url = new URL(endpoint);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('unsafe_conexus_endpoint');
  }
  async request<T>(path: string, method = 'GET', body?: unknown, idempotencyKey?: string): Promise<T> {
    if (!/^\/v1\/[a-z0-9/-]+$/.test(path)) throw new Error('invalid_api_path');
    const response = await fetch(new URL(path, this.endpoint), { method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${this.token()}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`conexus_http_${response.status}`); }
    return await response.json() as T;
  }
}
