import Anthropic from '@anthropic-ai/sdk';
import { getPresignedUrl } from '@/lib/r2';
import { ContractExtraction } from '@/src/types';

const EXTRACTION_PROMPT = `You are a legal document analyst specialising in Australian building contracts.

Extract the following information from this contract. Return ONLY a valid JSON object with these exact keys:
- "builderName": the trading or company name of the builder/contractor (string, empty string if not found)
- "abn": the builder's Australian Business Number in "XX XXX XXX XXX" format (string, empty string if not found)
- "licenceNumber": the builder's contractor or builder licence number (string, empty string if not found)
- "contractValue": the total contract price or sum, e.g. "$450,000" (string, empty string if not found)
- "projectAddress": the site or project address (string, empty string if not found)
- "confidence": "high" if 3 or more key fields were found clearly, "medium" if 1–2 fields found, "low" if none found or document quality is poor

Respond with ONLY the JSON object. No markdown fences, no explanation.`;

export async function extractFromContract(
  r2Key: string,
  fileType: string
): Promise<ContractExtraction> {
  // DOCX cannot be natively parsed by the Claude vision/document API
  if (fileType === 'docx') {
    return { builderName: '', abn: '', licenceNumber: '', confidence: 'low' };
  }

  const presignedUrl = await getPresignedUrl(r2Key, 300);
  const fileResponse = await fetch(presignedUrl);
  if (!fileResponse.ok) throw new Error('Failed to fetch contract from storage');

  const base64 = Buffer.from(await fileResponse.arrayBuffer()).toString('base64');

  const client = new Anthropic();

  // DocumentBlockParam is not in the v0.29.0 SDK union type; cast required for PDF support
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fileBlock: any =
    fileType === 'pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : {
          type: 'image',
          source: {
            type: 'base64',
            media_type: fileType === 'jpg' ? 'image/jpeg' : 'image/png',
            data: base64,
          },
        };

  const content: Anthropic.MessageParam['content'] = [
    fileBlock as Anthropic.ImageBlockParam,
    { type: 'text', text: EXTRACTION_PROMPT },
  ];

  const message = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 512,
    messages: [{ role: 'user', content }],
  });

  const text =
    message.content.find((c): c is Anthropic.TextBlock => c.type === 'text')?.text ?? '';

  try {
    const parsed = JSON.parse(text);
    return {
      builderName: String(parsed.builderName ?? ''),
      abn: String(parsed.abn ?? ''),
      licenceNumber: String(parsed.licenceNumber ?? ''),
      contractValue: parsed.contractValue ? String(parsed.contractValue) : undefined,
      projectAddress: parsed.projectAddress ? String(parsed.projectAddress) : undefined,
      confidence: (['high', 'medium', 'low'] as const).includes(parsed.confidence)
        ? (parsed.confidence as ContractExtraction['confidence'])
        : 'low',
    };
  } catch {
    return { builderName: '', abn: '', licenceNumber: '', confidence: 'low' };
  }
}
