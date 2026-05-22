#!/usr/bin/env node
/**
 * Testing tool: adds free re-check and deep-check credits to a user account.
 * Run from web/ directory:
 *   node scripts/add-test-credits.js [email] [freeChecks] [deepChecks]
 *
 * Defaults: trustworthy.act@gmail.com, 999 free, 99 deep
 */

const { PrismaClient } = require('@prisma/client');

const db = new PrismaClient();

async function main() {
  const email = process.argv[2] || 'trustworthy.act@gmail.com';
  const freeChecks = parseInt(process.argv[3] ?? '999', 10);
  const deepChecks = parseInt(process.argv[4] ?? '99', 10);

  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user found for email: ${email}`);
    process.exit(1);
  }

  const balance = await db.packBalance.upsert({
    where: { userId: user.id },
    update: { freeChecks, deepChecks },
    create: { userId: user.id, freeChecks, deepChecks },
  });

  console.log(`✓ ${email}: freeChecks=${balance.freeChecks}, deepChecks=${balance.deepChecks}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
