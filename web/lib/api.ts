import { BuilderInput, SearchResult } from '@/src/types';

// Set NEXT_PUBLIC_SCRAPING_SERVICE_URL in .env.local when the browser must reach
// the Express server directly (e.g. for streaming). Server-side code uses
// SCRAPING_SERVICE_URL (no NEXT_PUBLIC_ prefix).
export const SERVER_URL =
  process.env.NEXT_PUBLIC_SCRAPING_SERVICE_URL ??
  process.env.SCRAPING_SERVICE_URL ??
  'http://localhost:3001';

export async function runDueDiligence(
  input: BuilderInput,
  onProgress: (result: SearchResult) => void,
  options?: { isDeepCheck?: boolean }
): Promise<SearchResult[]> {
  const response = await fetch(`${SERVER_URL}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, isDeepCheck: options?.isDeepCheck ?? false }),
  });

  if (!response.ok) throw new Error(`Server error: ${response.status}`);

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const accumulated: SearchResult[] = [];
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const result: SearchResult = JSON.parse(trimmed);
        accumulated.push(result);
        onProgress(result);
      } catch {
        // malformed line, skip
      }
    }
  }

  return accumulated;
}

// Retries once before giving up — found live 2026-09-24: a single dropped health-check
// fetch (e.g. a mobile browser resuming from a backgrounded tab, where iOS/Android can
// suspend JS execution and drop an in-flight request, or a brief WiFi/cellular handoff)
// was enough to fail this check even though the real server was fine, sending the user
// straight to the "server unreachable" error screen over a one-off blip. Each attempt is
// bounded by AbortController so a hung request can't stall the check indefinitely.
async function pingHealth(timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${SERVER_URL}/api/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkServer(): Promise<boolean> {
  if (await pingHealth(8_000)) return true;
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  return pingHealth(8_000);
}
