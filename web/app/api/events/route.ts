import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const ALLOWED_EVENTS = new Set([
  'persona_selected',
  'email_captured',
  'partner_link_clicked',
]);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { event, properties } = body as { event: unknown; properties?: unknown };

    if (typeof event !== 'string' || !ALLOWED_EVENTS.has(event)) {
      return NextResponse.json({ error: 'invalid_event' }, { status: 400 });
    }

    console.log(
      '[analytics]',
      JSON.stringify({ event, properties: properties ?? {}, ts: new Date().toISOString() })
    );

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
}
