// Static snapshot of the marketing site for a Cloudflare Pages preview.
// Usage: node snapshot.mjs <webDir> <outDir> <port> <liveToolOrigin>
// Expects `next start -p <port>` already serving a build made with the
// NEXT_PUBLIC_STATIC_PREVIEW / NEXT_PUBLIC_KYB_APP_URL preview settings.
import fs from 'node:fs';
import path from 'node:path';

const [webDir, outDir, port, liveTool] = process.argv.slice(2);
const base = `http://localhost:${port}`;

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const write = (rel, data) => {
  const p = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
};

// 1. Pages from the sitemap (marketing pages only) plus /privacy (draft, not in sitemap).
const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((m) => new URL(m[1]).pathname)
  .filter((p) => p !== '/check');
paths.push('/privacy');

const extraAssets = new Set();
for (const p of [...new Set(paths)]) {
  const res = await fetch(base + p);
  if (!res.ok) throw new Error(`${p} -> ${res.status}`);
  const html = await res.text();
  write(p === '/' ? 'index.html' : `${p.slice(1)}.html`, html);
  // Metadata files referenced from <head> (icons, OG image), not under /_next or /brand.
  for (const m of html.matchAll(/(?:href|content|src)="(?:https?:\/\/[^/"]+)?(\/(?:icon|apple-icon|favicon|opengraph-image)[^"?]*)(?:\?[^"]*)?"/g)) {
    extraAssets.add(m[1]);
  }
  console.log('page', p);
}

// 2. Metadata assets.
for (const a of extraAssets) {
  const res = await fetch(base + a);
  if (res.ok) {
    write(a.slice(1), Buffer.from(await res.arrayBuffer()));
    console.log('asset', a);
  }
}

// 3. 404 page.
write('404.html', await (await fetch(`${base}/__snapshot-not-found__`)).text());

// 4. Static build output and public files.
fs.cpSync(path.join(webDir, '.next', 'static'), path.join(outDir, '_next', 'static'), { recursive: true });
fs.cpSync(path.join(webDir, 'public'), outDir, { recursive: true });

// 5. Cloudflare Pages rules: keep the preview out of search, hand the tool to the live app.
write('robots.txt', 'User-agent: *\nDisallow: /\n');
write('_headers', '/*\n  X-Robots-Tag: noindex, nofollow\n');
write('_redirects', [`/check ${liveTool}/ 302`, `/search ${liveTool}/search 302`, `/report/* ${liveTool}/report/:splat 302`].join('\n') + '\n');

const count = fs.readdirSync(outDir, { recursive: true }).length;
console.log(`done: ${count} files in ${outDir}`);
