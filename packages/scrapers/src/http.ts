export const USER_AGENT = "PreciosUY/0.1 (comparador de precios; +https://github.com/manulio/test)";

export interface HttpOptions {
  /** Pausa mínima entre el inicio de dos requests al mismo sitio, para no sobrecargarlo. */
  delayMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Cliente HTTP educado: espacia el inicio de las requests (aunque haya varias en vuelo)
 * y reintenta errores de red, 429 y 5xx con espera creciente.
 */
export function createHttp({ delayMs = 750, retries = 3, fetchImpl = fetch }: HttpOptions = {}) {
  let next = 0;

  /** Reserva el próximo turno libre, así varias llamadas concurrentes no salen juntas. */
  async function waitTurn() {
    const slot = Math.max(Date.now(), next);
    next = slot + delayMs;
    const wait = slot - Date.now();
    if (wait > 0) await sleep(wait);
  }

  /** Devuelve null si la página no existe (404/410); falla si el error persiste. */
  async function request(url: string, accept: string): Promise<Response | null> {
    for (let attempt = 0; ; attempt++) {
      await waitTurn();

      let res: Response;
      try {
        res = await fetchImpl(url, { headers: { "user-agent": USER_AGENT, accept } });
      } catch (error) {
        // Error de red (DNS, conexión cortada): se reintenta igual que un 5xx.
        if (attempt >= retries) throw error;
        await sleep(delayMs * 2 ** (attempt + 1));
        continue;
      }
      if (res.ok) return res;
      if (res.status === 404 || res.status === 410) return null;

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= retries) {
        throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
      }
      await sleep(delayMs * 2 ** (attempt + 1));
    }
  }

  async function getJson<T>(url: string): Promise<T> {
    const res = await request(url, "application/json");
    if (!res) throw new Error(`GET ${url} → 404 Not Found`);
    return (await res.json()) as T;
  }

  /** Para páginas y sitemaps: null si no existe. */
  async function getHtml(url: string): Promise<string | null> {
    const res = await request(url, "text/html,application/xml;q=0.9,*/*;q=0.8");
    return res ? res.text() : null;
  }

  /** Sin reintentos ni pausa: para robots.txt, que puede no existir. */
  async function getText(url: string): Promise<string | null> {
    const res = await fetchImpl(url, { headers: { "user-agent": USER_AGENT } });
    return res.ok ? res.text() : null;
  }

  return { getJson, getHtml, getText };
}

export type Http = ReturnType<typeof createHttp>;
