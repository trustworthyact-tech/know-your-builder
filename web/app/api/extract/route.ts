import { NextRequest, NextResponse } from 'next/server';
import { extractFromContract } from '@/lib/contractExtractor';
import { deleteFromR2 } from '@/lib/r2';

export async function POST(req: NextRequest) {
  let body: { r2Key: string; fileType: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { r2Key, fileType } = body;
  if (!r2Key || !fileType) {
    return NextResponse.json({ error: 'r2Key and fileType are required' }, { status: 400 });
  }

  let extraction;
  try {
    extraction = await extractFromContract(r2Key, fileType);
  } catch (err) {
    console.error('[extract] Extraction error:', err);
    await deleteFromR2(r2Key).catch(() => {});
    return NextResponse.json({ error: 'Extraction failed' }, { status: 500 });
  }

  // Always delete from R2 after extraction regardless of confidence
  await deleteFromR2(r2Key).catch((err) => {
    console.error('[extract] R2 delete error:', err);
  });

  return NextResponse.json(extraction);
}
