import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withIsolatedDatabase, add, added, edit, edited, act, acted, snapshot, opportunity, rows, record } from './helpers/api.mjs';
import { SECTION_BASIS, emptySections, proposalDocument } from '../lib/records.ts';

withIsolatedDatabase();
const filled = (overrides = {}) => { const s = emptySections(); s.executiveSummary = { body: 'EduRadius will deliver an AI governance framework.', basis: SECTION_BASIS[0], refs: [] }; s.approach = { body: 'Discovery, policy drafting, training.', basis: SECTION_BASIS[1], refs: [] }; return { ...s, ...overrides }; };
async function draftProposal() {
  const opp = await opportunity();
  const { record: proposal } = await acted('proposal.create', { opportunityId: opp.id, title: 'Governance framework proposal' }, 201);
  return { opp, proposal: await edited('proposal', proposal, { sections: filled() }) };
}
const send = p => acted('proposal.submitForReview', { id: p.id, version: p.version });

test('proposals are created through the action, with every section and a stated basis', async () => {
  const opp = await opportunity();
  assert.equal((await add('proposal', { opportunityId: opp.id, title: 'x' })).status, 400, 'generic create rejected');
  assert.equal((await act('proposal.create', { opportunityId: 'missing', title: 'x' })).status, 404);
  const { record: p } = await acted('proposal.create', { opportunityId: opp.id, title: 'Proposal' }, 201);
  assert.equal(p.status, 'Draft'); assert.equal(Object.keys(p.sections).length, 9);
  assert.equal((await edit('proposal', p, { sections: { bogus: { body: '', basis: SECTION_BASIS[0], refs: [] } } })).status, 400);
  assert.equal((await edit('proposal', p, { sections: filled({ experience: { body: 'Past work', basis: SECTION_BASIS[2], refs: [] } }) })).status, 400, 'verified needs evidence');
  assert.equal((await edit('proposal', p, { status: 'Approved' })).status, 400, 'status is action-controlled');
  assert.equal((await acted('proposal.create', { opportunityId: opp.id, title: '' }, 400)).error.length > 0, true);
});

test('owner review: versions are preserved, transitions enforced, changes need a reason', async () => {
  const { proposal } = await draftProposal();
  assert.equal((await act('proposal.approve', { id: proposal.id, version: proposal.version })).status, 409, 'cannot approve a draft');
  assert.equal((await act('proposal.recordSubmission', { id: proposal.id, version: proposal.version, submittedOn: '2026-11-20', method: 'Email' })).status, 409, 'cannot submit unapproved');
  let p = (await send(proposal)).record;
  assert.equal(p.status, 'Internal review');
  assert.equal((await edit('proposal', p, { title: 'Edited during review' })).status, 400, 'locked in review');
  assert.equal((await act('proposal.requestChanges', { id: p.id, version: p.version })).status, 400, 'reason required');
  p = (await acted('proposal.requestChanges', { id: p.id, version: p.version, reason: 'Tighten the approach; add timeline.' })).record;
  assert.equal(p.status, 'Changes requested');
  const v1 = await record('proposalVersion', p.latestVersionId);
  assert.equal(v1.number, 1); assert.equal(v1.status, 'Changes requested'); assert.match(v1.reviewReason, /Tighten/); assert.match(v1.reviewedBy, /owner review/);
  p = await edited('proposal', p, { sections: filled({ approach: { body: 'Discovery (2 weeks), policy drafting (4 weeks), training.', basis: SECTION_BASIS[1], refs: [] } }) });
  p = (await send(p)).record;
  p = (await acted('proposal.approve', { id: p.id, version: p.version })).record;
  assert.equal(p.status, 'Approved');
  const v2 = await record('proposalVersion', p.approvedVersionId);
  assert.equal(v2.number, 2); assert.equal(v2.status, 'Approved'); assert.match(v2.sections.approach.body, /2 weeks/);
  assert.equal((await record('proposalVersion', v1.id)).sections.approach.body, 'Discovery, policy drafting, training.', 'version 1 kept verbatim');
  assert.equal((await edit('proposalVersion', v2, { title: 'tamper' })).status, 400, 'versions are immutable');
});

test('editing approved content creates a new draft; submission is tied to the exact approved version', async () => {
  const { proposal } = await draftProposal();
  let p = (await send(proposal)).record;
  p = (await acted('proposal.approve', { id: p.id, version: p.version })).record;
  const approvedV1 = p.approvedVersionId;
  p = await edited('proposal', p, { title: 'Governance framework proposal (revised)' });
  assert.equal(p.status, 'Draft'); assert.equal(p.approvedVersionId, approvedV1, 'approved version preserved');
  assert.equal((await act('proposal.recordSubmission', { id: p.id, version: p.version, submittedOn: '2026-11-20', method: 'Email' })).status, 409, 'edited draft is not submittable');
  p = (await send(p)).record;
  p = (await acted('proposal.approve', { id: p.id, version: p.version })).record;
  assert.equal((await record('proposalVersion', approvedV1)).status, 'Superseded');
  assert.equal((await act('proposal.recordSubmission', { id: p.id, version: p.version, submittedOn: 'bad', method: 'Email' })).status, 400);
  const { record: sub } = await acted('proposal.recordSubmission', { id: p.id, version: p.version, submittedOn: '2026-11-20', method: 'Procurement portal', reference: 'RFP-2026-114 conf #A1' }, 201);
  assert.equal(sub.proposalVersionId, p.approvedVersionId); assert.equal(sub.outcome, 'Pending');
  const after = await record('proposal', p.id);
  assert.equal(after.status, 'Submitted');
  assert.equal((await record('proposalVersion', p.approvedVersionId)).status, 'Submitted');
  assert.equal((await edit('proposal', after, { title: 'x' })).status, 400, 'submitted proposal locked');
  assert.equal((await act('proposal.recordSubmission', { id: p.id, version: after.version, submittedOn: '2026-11-21', method: 'Email' })).status, 409, 'no duplicate submission');
  const events = (await rows("SELECT summary FROM activity_events WHERE type = 'proposal.submission_recorded'"))[0];
  assert.match(events.summary, /nothing was sent/);
});

test('approval of verified sections requires current evidence', async () => {
  const { proposal } = await draftProposal();
  const stale = await added('evidence', { title: 'Expired reference letter', category: 'Past performance', reviewStatus: 'Verified', reviewDate: '2020-01-01' });
  let p = await edited('proposal', proposal, { sections: filled({ experience: { body: 'Delivered training for X.', basis: SECTION_BASIS[2], refs: [stale.id] } }) });
  p = (await send(p)).record;
  assert.equal((await act('proposal.approve', { id: p.id, version: p.version })).status, 400);
});

test('award outcome needs explicit confirmation, a date and evidence; it is linked to the opportunity', async () => {
  const { opp, proposal } = await draftProposal();
  let p = (await send(proposal)).record;
  p = (await acted('proposal.approve', { id: p.id, version: p.version })).record;
  const { record: sub } = await acted('proposal.recordSubmission', { id: p.id, version: p.version, submittedOn: '2026-11-20', method: 'Email' }, 201);
  const notice = await added('evidence', { title: 'Notice of award', category: 'Award', reviewStatus: 'Verified' });
  for (const body of [{ outcome: 'Awarded', outcomeDate: '2026-12-01', awardEvidenceId: notice.id }, { outcome: 'Awarded', confirmAward: true, awardEvidenceId: notice.id }, { outcome: 'Awarded', confirmAward: true, outcomeDate: '2026-12-01' }, { outcome: 'Won' }]) {
    assert.equal((await act('submission.recordOutcome', { id: sub.id, version: sub.version, ...body })).status, 400, JSON.stringify(body));
  }
  const { record: awarded } = await acted('submission.recordOutcome', { id: sub.id, version: sub.version, outcome: 'Awarded', outcomeDate: '2026-12-01', awardEvidenceId: notice.id, confirmAward: true });
  assert.equal(awarded.outcome, 'Awarded');
  const snap = await snapshot();
  assert.ok(snap.evidenceLinks.some(l => l.evidenceId === notice.id && l.subjectType === 'opportunity' && l.subjectId === opp.id));
  assert.equal(snap.opportunities[0].decision, 'Undecided', 'award does not change decisions automatically');
});

test('templates create new proposals and never overwrite existing ones', async () => {
  const { opp, proposal } = await draftProposal();
  const { record: template } = await acted('proposal.saveTemplate', { id: proposal.id, name: 'Governance template' }, 201);
  assert.equal(template.sections.executiveSummary.body, filled().executiveSummary.body);
  assert.equal(template.sections.approach.basis, SECTION_BASIS[0], 'basis reset for reuse');
  assert.equal((await edit('proposalTemplate', template, { sections: {} })).status, 400, 'template content changes via save action');
  const { record: second } = await acted('proposal.create', { opportunityId: opp.id, title: 'Second proposal', templateId: template.id }, 201);
  assert.equal(second.templateId, template.id); assert.equal(second.sections.executiveSummary.body, filled().executiveSummary.body);
  assert.deepEqual((await record('proposal', proposal.id)).sections, proposal.sections, 'original proposal unchanged');
});

test('teaming partners: organization and contact scoping, agreement reference, uniqueness', async () => {
  const opp = await opportunity();
  const partner = await added('organization', { name: 'Hill Country Analytics', orgType: 'Teaming partner' });
  const other = await added('organization', { name: 'Other Org' });
  const outsider = await added('contact', { name: 'Not their contact', organizationId: other.id });
  assert.equal((await add('teamingPartner', { opportunityId: opp.id })).status, 400, 'organization required');
  assert.equal((await add('teamingPartner', { opportunityId: opp.id, organizationId: partner.id, contactId: outsider.id })).status, 400, 'contact must belong to the partner');
  assert.equal((await add('teamingPartner', { opportunityId: opp.id, organizationId: partner.id, discussionStatus: 'Agreement signed' })).status, 400);
  const tp = await added('teamingPartner', { opportunityId: opp.id, organizationId: partner.id, proposedRole: 'Subcontractor', workPackage: 'Data readiness assessment', capabilityFit: 'Data governance expertise', nextAction: 'Share draft scope', nextActionDue: '2026-11-25' });
  assert.equal(tp.discussionStatus, 'Identified');
  assert.equal((await add('teamingPartner', { opportunityId: opp.id, organizationId: partner.id })).status, 409, 'one record per partner and opportunity');
  const signed = await edited('teamingPartner', tp, { discussionStatus: 'Agreement signed', agreementReference: 'TA-2026-07 (signed 2026-11-18)' });
  assert.equal(signed.discussionStatus, 'Agreement signed');
  const dup = await added('organization', { name: 'Hill Country Analytics Inc' }, { confirmDistinct: true });
  await added('teamingPartner', { opportunityId: opp.id, organizationId: dup.id });
  assert.equal((await act('organization.merge', { sourceId: dup.id, targetId: partner.id, sourceVersion: dup.version })).status, 409, 'merge would duplicate a partner');
});

test('proposal export labels drafts, basis and owner review', () => {
  const sections = filled();
  const draft = proposalDocument({ title: 'P', opportunityTitle: 'O', sections, version: null });
  assert.match(draft, /DRAFT — not approved for submission/); assert.match(draft, /Basis: Illustrative/); assert.match(draft, /\[Not yet written\]/);
  const approved = proposalDocument({ title: 'P', opportunityTitle: 'O', sections, version: { number: 2, status: 'Approved', reviewedAt: '2026-11-18T10:00:00Z' } });
  assert.doesNotMatch(approved, /DRAFT/); assert.match(approved, /owner review; not an independent second review/);
});
