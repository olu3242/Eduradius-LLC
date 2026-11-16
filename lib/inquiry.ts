// Shared by the public form and server validation so CTA values cannot drift.
export const INQUIRY_KINDS = ['Project briefing', 'Teaming inquiry', 'AI consulting briefing', 'AI governance briefing', 'AI adoption briefing', 'Training and education briefing'] as const;
export type InquiryKind = (typeof INQUIRY_KINDS)[number];
export function isInquiryKind(value: unknown): value is InquiryKind {
  return typeof value === 'string' && INQUIRY_KINDS.some(kind => kind === value);
}
export const PRACTICE_INQUIRIES = {
  'AI consulting': 'AI consulting briefing',
  'AI governance': 'AI governance briefing',
  'AI adoption': 'AI adoption briefing',
  'Training and education': 'Training and education briefing',
} as const satisfies Record<string, InquiryKind>;
