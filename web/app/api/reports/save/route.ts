import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getResend } from '@/lib/resend';
import { render } from '@react-email/components';
import { ReportEmail } from '@/emails/ReportEmail';
import { Persona, SearchResult } from '@/src/types';
import { riskGrouper } from '@/lib/riskGrouper';
import { enqueueSequence, type SequenceKey } from '@/lib/queues/emailSequence';

// Matches web/src/types/index.ts's ResultItem/SearchResult shapes. `.passthrough()`
// on the result item since scrapers attach category-specific metadata keys that
// vary by source — only the fields actually read downstream need enforcing here.
const resultItemSchema = z
  .object({
    title: z.string(),
    url: z.string().optional(),
    description: z.string().optional(),
    date: z.string().optional(),
    status: z.string().optional(),
    metadata: z.record(z.string(), z.string()).optional(),
    jurisdiction: z.string().optional(),
    category: z.string().optional(),
    matchedTerm: z.string().optional(),
    isAdjudication: z.boolean().optional(),
  })
  .passthrough();

const searchResultSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    status: z.enum(['idle', 'searching', 'done', 'error']),
    results: z.array(resultItemSchema).optional(),
    licenceResults: z.array(resultItemSchema).optional(),
    adjudicationResults: z.array(resultItemSchema).optional(),
  })
  .passthrough();

const saveBodySchema = z.object({
  entityName: z.string().trim().min(1, 'entityName is required'),
  entityAbn: z.string().trim().optional(),
  persona: z.enum(Persona).optional(),
  projectType: z.enum(['new_build', 'renovation', 'commercial', 'subdivision', 'other']).optional(),
  projectStage: z.enum(['not_signed', 'about_to_sign', 'contracted', 'underway']).optional(),
  projectState: z.string().trim().optional(),
  findings: z.record(z.string(), searchResultSchema),
  isDeepCheck: z.boolean(),
  email: z.string().email().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = saveBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      { status: 400 }
    );
  }

  const {
    entityName,
    entityAbn,
    persona,
    projectType,
    projectStage,
    projectState,
    findings,
    isDeepCheck,
    email,
  } = parsed.data;

  // Re-check entitlement gate — authenticated users only
  if (session?.user?.id) {
    const priorWhere = entityAbn
      ? { userId: session.user.id, entityAbn }
      : { userId: session.user.id, entityName };

    const priorSearch = await prisma.search.findFirst({
      where: priorWhere,
      select: { id: true },
    });

    if (priorSearch) {
      // Atomically consume one freeCheck; updateMany returns count = 0 if none available
      const updated = await prisma.packBalance.updateMany({
        where: { userId: session.user.id, freeChecks: { gt: 0 } },
        data: { freeChecks: { decrement: 1 } },
      });
      if (updated.count === 0) {
        return NextResponse.json(
          { error: 'recheck_required', recheckPrice: 300 },
          { status: 402 }
        );
      }
    }
  }

  const riskGroups = riskGrouper(findings);
  const riskSummary = JSON.stringify(riskGroups);

  let search;
  try {
    search = await prisma.search.create({
      data: {
        userId: session?.user?.id ?? null,
        entityName,
        entityAbn: entityAbn || null,
        persona: persona ?? null,
        projectType: projectType || null,
        projectStage: projectStage || null,
        projectState: projectState || null,
        reportJson: findings as object,
        isDeepCheck,
        riskSummary,
      },
    });
  } catch (err) {
    console.error('[reports/save] DB error:', err);
    return NextResponse.json({ error: 'Failed to save report' }, { status: 500 });
  }

  // Send report email (best-effort — never fail the response if email fails)
  if (email) {
    try {
      const results = Object.values(findings);
      const nonLinkResults = results.filter((r) => r.key !== 'links');
      const totalHits = nonLinkResults.reduce((n, r) => n + (r.results?.length ?? 0), 0);
      const courtHits = results
        .filter((r) => r.key.startsWith('austlii_'))
        .reduce((n, r) => n + (r.results?.length ?? 0), 0);
      const hasFindings = totalHits > 0;

      const appUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
      const reportUrl = `${appUrl}/report/${search.id}`;
      const generatedAt = new Date().toLocaleDateString('en-AU', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });

      const html = await render(
        ReportEmail({
          entityName,
          searchId: search.id,
          totalHits,
          courtHits,
          hasFindings,
          reportUrl,
          generatedAt,
        })
      );

      await getResend().emails.send({
        from: process.env.FROM_EMAIL ?? 'noreply@knowyourbuilder.com.au',
        to: email,
        subject: `Your Know Your Builder report — ${entityName}`,
        html,
      });
    } catch (err) {
      console.error('[reports/save] Email send error:', err);
    }
  }

  // Enqueue email sequences — authenticated users only, best-effort
  if (session?.user?.id) {
    const userId = session.user.id;
    const sequencesToEnqueue: SequenceKey[] = [];

    // Findings vs. clean — mutually exclusive
    if (riskGroups.length > 0) {
      sequencesToEnqueue.push('FINDINGS');
    } else {
      sequencesToEnqueue.push('CLEAN');
    }

    // Persona-based sequences
    if (persona === Persona.SUBCONTRACTOR) {
      sequencesToEnqueue.push('SUBCONTRACTOR');
    }
    if (
      (persona === Persona.HOMEOWNER || persona === Persona.DEVELOPER) &&
      (projectStage === 'not_signed' || projectStage === 'about_to_sign')
    ) {
      sequencesToEnqueue.push('BEFORE_SIGN');
    }
    if (
      (persona === Persona.HOMEOWNER || persona === Persona.DEVELOPER) &&
      (projectStage === 'contracted' || projectStage === 'underway')
    ) {
      sequencesToEnqueue.push('DURING_BUILD');
    }

    // Re-check reminders — contracted/underway homeowners and developers
    if (
      (persona === Persona.HOMEOWNER || persona === Persona.DEVELOPER) &&
      (projectStage === 'contracted' || projectStage === 'underway')
    ) {
      sequencesToEnqueue.push('RECHECK_30D');
      sequencesToEnqueue.push('RECHECK_90D');
    }

    // Re-engagement — all authenticated users (fires 14 days after search if no activity)
    sequencesToEnqueue.push('REENGAGEMENT');

    Promise.all(
      sequencesToEnqueue.map((key) => enqueueSequence(userId, search.id, key)),
    ).catch((err) => console.error('[reports/save] Email sequence enqueue error:', err));
  }

  return NextResponse.json({ searchId: search.id });
}
