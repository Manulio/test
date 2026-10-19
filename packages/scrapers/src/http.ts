export const USER_AGENT = "PreciosUY/0.1 (comparador de precios; +https://github.com/manulio/test)";

export interface HttpOptions {
  /** Pausa mínima entre requests al mismo sitio, para no sobrecargarlo. */
  delayMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cliente HTTP educado: una request a la vez, con pausa entre requests y reintentos con espera creciente. */
export function createHttp({ delayMs = 750, retries = 3, fetchImpl = fetch }: HttpOptions = {}) {
  let last = 0;

  async function getJson<T>(url: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const wait = last + delayMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();

      let res: Response;
      try {
        res = await fetchImpl(url, {
          headers: { "user-agent": USER_AGENT, accept: "application/json" },
        });
      } catch (error) {
        // Error de red (DNS, conexión cortada): se reintenta igual que un 5xx.
        if (attempt >= retries) throw error;
        await sleep(delayMs * 2 ** (attempt + 1));
        continue;
      }
      if (res.ok) return (await res.json()) as T;

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= retries) {
        throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
      }
      await sleep(delayMs * 2 ** (attempt + 1));
    }
  }

  async function getText(url: string): Promise<string | null> {
    const res = await fetchImpl(url, { headers: { "user-agent": USER_AGENT } });
    return res.ok ? res.text() : null;
  }

  return { getJson, getText };
}

export type Http = ReturnType<typeof createHttp>;
