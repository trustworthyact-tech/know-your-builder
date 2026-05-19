import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import puppeteer from 'puppeteer';

export async function GET(
  req: NextRequest,
  { params }: { params: { searchId: string } }
) {
  const { searchId } = params;
  const shareToken = req.nextUrl.searchParams.get('shareToken');

  const appUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';

  // Resolve auth and the URL Puppeteer will render
  let targetUrl: string;
  // Cookie to forward to Puppeteer (own-report path only)
  let authCookieName: string | null = null;
  let authCookieValue: string | null = null;

  if (shareToken) {
    const link = await prisma.shareableLink.findUnique({
      where: { token: shareToken },
      select: { searchId: true, expiresAt: true },
    });

    if (!link || link.searchId !== searchId || link.expiresAt < new Date()) {
      return NextResponse.json({ error: 'Invalid or expired share token' }, { status: 403 });
    }

    targetUrl = `${appUrl}/report/share/${shareToken}`;
  } else {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const search = await prisma.search.findFirst({
      where: { id: searchId, userId: session.user.id },
      select: { id: true },
    });

    if (!search) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    // Pass the caller's session cookie to Puppeteer so it renders the authenticated page
    // without creating any DB side-effects
    const secureName = '__Secure-next-auth.session-token';
    const plainName = 'next-auth.session-token';
    const cookie = req.cookies.get(secureName) ?? req.cookies.get(plainName);
    if (cookie) {
      authCookieName = cookie.name;
      authCookieValue = cookie.value;
    }

    targetUrl = `${appUrl}/report/${searchId}`;
  }

  let pdfBytes: Uint8Array;
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });

      if (authCookieName && authCookieValue) {
        const { hostname } = new URL(appUrl);
        await page.setCookie({ name: authCookieName, value: authCookieValue, domain: hostname, path: '/' });
      }

      await page.goto(targetUrl, { waitUntil: 'networkidle0', timeout: 30000 });

      pdfBytes = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '15mm', right: '12mm', bottom: '15mm', left: '12mm' },
      });
    } finally {
      await browser.close();
    }
  } catch (err) {
    console.error('[pdf] Puppeteer error:', err);
    return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 });
  }

  const safeId = searchId.replace(/[^a-zA-Z0-9-]/g, '');
  return new Response(pdfBytes.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="kyb-report-${safeId}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
