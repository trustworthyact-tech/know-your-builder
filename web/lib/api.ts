import { BuilderInput, SearchResult } from '@/src/types';

// Set NEXT_PUBLIC_SCRAPING_SERVICE_URL in .env.local when the browser must reach
// the Express server directly (e.g. for streaming). Server-side code uses
// SCRAPING_SERVICE_URL (no NEXT_PUBLIC_ prefix).
const SERVER_URL =
  process.env.NEXT_PUBLIC_SCRAPING_SERVICE_URL ??
  process.env.SCRAPING_SERVICE_URL ??
  'http://localhost:3001';

export async function runDueDiligence(
  input: BuilderInput,
  onProgress: (result: SearchResult) => void
): Promise<SearchResult[]> {
  const response = await fetch(`${SERVER_URL}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
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

export async function checkServer(): Promise<boolean> {
  try {
    const res = await fetch(`${SERVER_URL}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}
