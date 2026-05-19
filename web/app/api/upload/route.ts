import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { uploadToR2 } from '@/lib/r2';

const ALLOWED_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid multipart request' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file field is required' }, { status: 400 });
  }

  const fileType = ALLOWED_TYPES[file.type];
  if (!fileType) {
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 415 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File exceeds 10 MB limit' }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const r2Key = `contracts/${randomUUID()}.${fileType}`;

  try {
    await uploadToR2(r2Key, buffer, file.type);
  } catch (err) {
    console.error('[upload] R2 error:', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 502 });
  }

  const warning = file.type.startsWith('image/')
    ? 'Image files may produce less accurate extractions than PDF or DOCX.'
    : undefined;

  return NextResponse.json({ r2Key, fileType, ...(warning ? { warning } : {}) });
}
