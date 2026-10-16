// Waitlist product keys, shared by the API route's validation and the forms.
// kyb_* keys are "tell me when Know Your Builder covers my state" signups for
// states outside the NSW + ACT launch scope.
export const WAITLIST_PRODUCTS = [
  'fundsight',
  'retention_trust',
  'kyb_qld',
  'kyb_vic',
  'kyb_wa',
  'kyb_sa',
  'kyb_tas',
  'kyb_nt',
] as const;

export type WaitlistProduct = (typeof WAITLIST_PRODUCTS)[number];
