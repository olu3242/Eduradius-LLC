import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withIsolatedDatabase, add, added, edit, edited, act, acted, snapshot, record, awardedSubmission, projectInput, owner } from './helpers/api.mjs';
import { closeoutChecklist } from '../lib/records.ts';
import { operationalReport, addDays } from '../lib/reports.ts';
import { exportBundle } from '../lib/workflow.ts';

withIsolatedDatabase();

async function activeProject(extra = {}) {
  const award = await awardedSubmission();
  let { record: project } = await acted('project.createFromAward', projectInput(award.submission, { deliverables: [{ title: 'Governance framework' }], ...extra }), 201);
  project = (await acted('project.transition', { id: project.id, version: project.version, to: 'Active' })).record;
  const deliverable = (await snapshot()).records.deliverable.find(d => d.projectId === project.id);
  return { ...award, project, deliverable };
}
const verifiedEvidence = (title, category = 'Acceptance') => added('evidence', { title, category, reviewStatus: 'Verified', reviewDate: '2099-12-31' });

test('deliverable versions are preserved; changes need notes; accepted content revises into a new draft', async () => {
  let { deliverable: d } = await activeProject();
  assert.equal((await act('deliverable.submitForReview', { id: d.id, version: d.version })).status, 400, 'needs a draft summary');
  assert.equal((await edit('deliverable', d, { status: 'Accepted' })).status, 400, 'status is action-controlled');
  d = await edited('deliverable', d, { draftSummary: 'Framework v1 — Drive / Delivery / framework-v1.docx' });
  d = (await acted('deliverable.submitForReview', { id: d.id, version: d.version })).record;
  assert.equal(d.status, 'Ready for review');
  assert.equal((await edit('deliverable', d, { draftSummary: 'sneaky edit' })).status, 400, 'locked in review');
  assert.equal((await act('deliverable.requestChanges', { id: d.id, version: d.version })).status, 400, 'notes required');
  d = (await acted('deliverable.requestChanges', { id: d.id, version: d.version, notes: 'Add an escalation path.' })).record;
  const v1 = await record('deliverableVersion', d.latestVersionId);
  assert.equal(v1.status, 'Changes requested'); assert.match(v1.summary, /framework-v1/);
  d = await edited('deliverable', d, { draftSummary: 'Framework v2 with escalation path — framework-v2.docx' });
  d = (await acted('deliverable.submitForReview', { id: d.id, version: d.version })).record;
  d = (await acted('deliverable.accept', { id: d.id, version: d.version, acceptanceKind: 'Internal approval' })).record;
  const v2 = await record('deliverableVersion', d.acceptedVersionId);
  assert.equal(v2.number, 2); assert.equal(v2.acceptanceKind, 'Internal approval'); assert.match(v2.acceptanceAuthority, /not client acceptance/);
  assert.equal((await record('deliverableVersion', v1.id)).summary, 'Framework v1 — Drive / Delivery / framework-v1.docx', 'v1 preserved');
  d = await edited('deliverable', d, { draftSummary: 'Framework v3 — client feedback' });
  assert.equal(d.status, 'Draft'); assert.equal(d.acceptedVersionId, v2.id, 'accepted version preserved while revising');
  assert.equal((await edit('deliverableVersion', v2, { summary: 'tamper' })).status, 400, 'versions immutable');
});

test('client acceptance requires an authority and verified, unexpired evidence', async () => {
  let { deliverable: d } = await activeProject();
  d = await edited('deliverable', d, { draftSummary: 'Final framework' });
  d = (await acted('deliverable.submitForReview', { id: d.id, version: d.version })).record;
  const unverified = await added('evidence', { title: 'Email saying looks good', category: 'Acceptance' });
  const expired = await added('evidence', { title: 'Old acceptance', category: 'Acceptance', reviewStatus: 'Verified', reviewDate: '2020-01-01' });
  for (const body of [{ acceptanceKind: 'Client acceptance', acceptanceEvidenceId: (await verifiedEvidence('Signed acceptance')).id }, { acceptanceKind: 'Client acceptance', acceptanceAuthority: 'Dr. Lee, Superintendent', acceptanceEvidenceId: unverified.id }, { acceptanceKind: 'Client acceptance', acceptanceAuthority: 'Dr. Lee', acceptanceEvidenceId: expired.id }, { acceptanceKind: 'Implied' }]) {
    assert.equal((await act('deliverable.accept', { id: d.id, version: d.version, ...body })).status, 400, JSON.stringify(body));
  }
  const signed = await verifiedEvidence('Signed acceptance form (Dr. Lee)');
  d = (await acted('deliverable.accept', { id: d.id, version: d.version, acceptanceKind: 'Client acceptance', acceptanceAuthority: 'Dr. Lee, Superintendent', acceptanceEvidenceId: signed.id })).record;
  const v = await record('deliverableVersion', d.acceptedVersionId);
  assert.equal(v.acceptanceKind, 'Client acceptance'); assert.equal(v.acceptanceEvidenceId, signed.id); assert.equal(v.reviewedBy, 'token:bearer');
  assert.ok((await snapshot()).evidenceLinks.some(l => l.subjectType === 'deliverable' && l.evidenceId === signed.id));
});

test('only approved change requests update the baseline; the original baseline is preserved', async () => {
  const { project } = await activeProject();
  const base1 = project.activeBaselineId;
  const proposed = await added('changeRequest', { projectId: project.id, title: 'Add a second workshop', requestedChange: 'One more training session', reason: 'Client request', newScope: 'Framework plus two workshops', newPlannedEndDate: '2027-04-30', costImpact: 'About one extra day of effort' });
  assert.equal((await record('project', project.id)).scope, project.scope, 'proposed change does not alter scope');
  assert.equal((await act('changeRequest.decide', { id: proposed.id, version: proposed.version, decision: 'Approved' })).status, 400, 'rationale required');
  const rejected = await added('changeRequest', { projectId: project.id, title: 'Extend by a year', requestedChange: 'x', reason: 'y', newPlannedEndDate: '2028-01-01' });
  await acted('changeRequest.decide', { id: rejected.id, version: rejected.version, decision: 'Rejected', reason: 'Out of scope for this award.' });
  assert.equal((await record('project', project.id)).plannedEndDate, '2027-03-31', 'rejected change leaves the baseline');
  const { record: approved, baselineId } = await acted('changeRequest.decide', { id: proposed.id, version: proposed.version, decision: 'Approved', reason: 'Agreed by email; amendment pending.' });
  assert.equal(approved.status, 'Approved'); assert.equal(approved.resultingBaselineId, baselineId);
  const p = await record('project', project.id), snap = await snapshot();
  assert.equal(p.scope, 'Framework plus two workshops'); assert.equal(p.plannedEndDate, '2027-04-30'); assert.equal(p.activeBaselineId, baselineId);
  const baselines = snap.records.projectBaseline.filter(b => b.projectId === project.id).sort((a, b) => a.number - b.number);
  assert.equal(baselines.length, 2); assert.equal(baselines[0].id, base1); assert.equal(baselines[0].scope, project.scope, 'original baseline preserved');
  assert.equal((await act('changeRequest.decide', { id: approved.id, version: approved.version, decision: 'Rejected', reason: 'x' })).status, 409, 'decided once');
  assert.equal((await edit('changeRequest', approved, { title: 'rewrite history' })).status, 400, 'decided change kept as recorded');
  assert.ok(snap.activity.some(a => a.type === 'changeRequest.approved' && /no agreement is created/.test(a.summary)));
});

test('closeout is blocked by incomplete prerequisites unless an owner exception is recorded', async () => {
  const { project } = await activeProject();
  assert.equal((await act('project.closeout', { id: project.id, version: project.version })).status, 409, 'must be Closing first');
  let p = (await acted('project.transition', { id: project.id, version: project.version, to: 'Closing' })).record;
  await added('projectLog', { projectId: p.id, kind: 'Issue', title: 'Open data-sharing question' });
  const blocked = await act('project.closeout', { id: p.id, version: p.version, lessonsLearned: 'Start data review earlier.', archiveReviewed: true });
  assert.equal(blocked.status, 409);
  const body = await blocked.json();
  assert.deepEqual(body.checklist.filter(c => !c.passed).map(c => c.key).sort(), ['acceptance', 'deliverables', 'issues']);
  const { record: closed } = await acted('project.closeout', { id: p.id, version: p.version, lessonsLearned: 'Start data review earlier.', archiveReviewed: true, exceptionReason: 'Client paused acceptance indefinitely; work delivered and invoiced separately.' });
  assert.equal(closed.status, 'Closed'); assert.match(closed.statusReason, /owner exception/);
  const co = (await snapshot()).records.closeout.find(c => c.projectId === p.id);
  assert.match(co.exceptionReason, /paused acceptance/); assert.equal(co.checklist.find(c => c.key === 'issues').passed, false);
  assert.equal((await add('milestone', { projectId: p.id, title: 'x' })).status, 400, 'closed project locked');
});

test('normal closeout passes the full checklist; cancellation is not completion; experience follows completion only', async () => {
  let { project, deliverable: d } = await activeProject();
  d = await edited('deliverable', d, { draftSummary: 'Final' });
  d = (await acted('deliverable.submitForReview', { id: d.id, version: d.version })).record;
  const acceptance = await verifiedEvidence('Final acceptance letter');
  await acted('deliverable.accept', { id: d.id, version: d.version, acceptanceKind: 'Client acceptance', acceptanceAuthority: 'Dr. Lee', acceptanceEvidenceId: acceptance.id });
  project = await record('project', project.id);
  assert.equal((await act('experience.createFromProject', { projectId: project.id })).status, 409, 'not closed yet');
  project = (await acted('project.transition', { id: project.id, version: project.version, to: 'Closing' })).record;
  const checklist = closeoutChecklist(project.id, (await snapshot()).records, { finalAcceptanceEvidenceId: acceptance.id, lessonsLearned: 'Plan workshops early.', archiveReviewed: true }, '2026-11-16');
  assert.ok(checklist.every(c => c.passed), JSON.stringify(checklist));
  const { record: closed } = await acted('project.closeout', { id: project.id, version: project.version, finalAcceptanceEvidenceId: acceptance.id, lessonsLearned: 'Plan workshops early.', archiveReviewed: true, actualEndDate: '2027-03-28' });
  assert.equal(closed.status, 'Closed'); assert.equal(closed.actualEndDate, '2027-03-28');

  const cancelled = (await activeProject()).project;
  const c = (await acted('project.transition', { id: cancelled.id, version: cancelled.version, to: 'Cancelled', reason: 'Funding withdrawn' })).record;
  assert.equal((await act('project.closeout', { id: c.id, version: c.version })).status, 409, 'cancelled is not closed out');
  assert.equal((await act('experience.createFromProject', { projectId: c.id })).status, 409, 'no experience from cancelled work');

  assert.equal((await add('experience', { title: 'x' })).status, 400, 'generic create rejected');
  const { record: exp } = await acted('experience.createFromProject', { projectId: project.id }, 201);
  assert.equal(exp.publicationStatus, 'Private'); assert.equal(exp.verifiedDeliverables.length, 1); assert.equal(exp.verifiedDeliverables[0].acceptanceKind, 'Client acceptance');
  assert.equal((await acted('experience.createFromProject', { projectId: project.id })).alreadyCreated, true);
  assert.equal((await act('experience.review', { id: exp.id, version: exp.version, to: 'Approved for capability statement' })).status, 409, 'must go through owner review');
  let e = await edited('experience', exp, { clientLabel: 'A Texas school district', outcomes: '92% of staff completed training (LMS report).' });
  e = (await acted('experience.review', { id: e.id, version: e.version, to: 'Ready for owner review' })).record;
  assert.equal((await act('experience.review', { id: e.id, version: e.version, to: 'Approved for capability statement' })).status, 400, 'outcome evidence and permission required');
  const lms = await verifiedEvidence('LMS completion report', 'Past performance');
  await acted('evidence.link', { evidenceId: lms.id, subjectType: 'experience', subjectId: e.id });
  assert.equal((await act('experience.review', { id: e.id, version: e.version, to: 'Approved for capability statement' })).status, 400, 'permission still required');
  const permission = await verifiedEvidence('Client permission to reference', 'Permission');
  e = await edited('experience', e, { permissionEvidenceId: permission.id });
  assert.equal(e.publicationStatus, 'Ready for owner review');
  e = (await acted('experience.review', { id: e.id, version: e.version, to: 'Approved for capability statement' })).record;
  assert.equal(e.publicationStatus, 'Approved for capability statement');
  assert.equal(e.provenance.projectId, project.id); assert.deepEqual(e.provenance.outcomeEvidenceIds, [lms.id]); assert.equal(e.provenance.permission.evidenceId, permission.id);
  assert.equal(e.provenance.acceptedDeliverables[0].acceptanceEvidenceId, acceptance.id);
  e = await edited('experience', e, { outcomes: '95% of staff completed training.' });
  assert.equal(e.publicationStatus, 'Private', 'edits after approval withdraw it until re-reviewed');
});

test('reopening and re-closing keeps every closeout record', async () => {
  const { project } = await activeProject();
  let p = (await acted('project.transition', { id: project.id, version: project.version, to: 'Closing' })).record;
  p = (await acted('project.closeout', { id: p.id, version: p.version, exceptionReason: 'First close with exception' })).record;
  p = (await acted('project.transition', { id: p.id, version: p.version, to: 'Active', reason: 'Client requested a follow-up session' })).record;
  p = (await acted('project.transition', { id: p.id, version: p.version, to: 'Closing' })).record;
  await acted('project.closeout', { id: p.id, version: p.version, exceptionReason: 'Second close with exception' });
  assert.equal((await snapshot()).records.closeout.filter(c => c.projectId === p.id).length, 2);
});

test('reports: definitions, zero versus no data versus unavailable, and date boundaries', async () => {
  assert.equal(addDays('2026-12-25', 14), '2027-01-08'); assert.equal(addDays('2026-03-01', -1), '2026-02-28'); assert.equal(addDays('2026-11-01', 1), '2026-11-02');
  const empty = operationalReport({ opportunities: [], records: {}, evidenceLinks: [] }, '2026-11-16');
  assert.ok(empty.every(m => m.noData && m.items.length === 0), 'no data is distinguished from zero');
  for (const m of empty) assert.ok(m.definition.length > 20 && m.source.length > 3, m.key);
  const { project } = await activeProject({ startDate: '2026-11-01', plannedEndDate: '2026-11-30' });
  await added('milestone', { projectId: project.id, title: 'Due yesterday', plannedDate: '2026-11-15' });
  await added('milestone', { projectId: project.id, title: 'Due today', plannedDate: '2026-11-16' });
  await added('milestone', { projectId: project.id, title: 'Undated' });
  await added('projectLog', { projectId: project.id, kind: 'Risk', title: 'Staffing', severity: 'High' });
  await added('evidence', { title: 'Certificate expiring', reviewStatus: 'Verified', reviewDate: '2026-12-10' });
  const snap = await snapshot();
  const report = Object.fromEntries(operationalReport(snap, '2026-11-16').map(m => [m.key, m]));
  assert.deepEqual(report['overdue-milestones'].items.map(i => i.title), ['Due yesterday'], 'due today is not overdue');
  assert.equal(report['overdue-milestones'].unavailable, 1, 'undated milestones are not counted as on time');
  assert.equal(report['approaching-closeout'].items.length, 1, 'planned end exactly 14 days out is included');
  assert.equal(operationalReport(snap, '2026-11-15').find(m => m.key === 'approaching-closeout').items.length, 0, '15 days out is excluded');
  assert.equal(report['risks-issues'].items.length, 1);
  assert.equal(report['active-projects'].items.length, 1); assert.equal(report['changes-pending'].noData, true);
  assert.equal(report['submitted-pending'].items.length, 0); assert.equal(report['submitted-pending'].noData, false, 'zero, not no-data');
  assert.ok(report['evidence-review'].items.some(i => i.title === 'Certificate expiring'));
});

test('export includes every record collection; new actions require the owner', async () => {
  await activeProject();
  const bundle = exportBundle({}, await snapshot());
  for (const type of ['organization', 'contact', 'requirement', 'evidence', 'proposal', 'proposalVersion', 'submission', 'teamingPartner', 'project', 'projectBaseline', 'milestone', 'deliverable', 'projectLog', 'deliverableVersion', 'changeRequest', 'closeout', 'experience', 'proposalTemplate']) {
    assert.ok(Array.isArray(bundle.workflow.records[type]), type);
  }
  assert.ok(bundle.workflow.records.project.length === 1 && bundle.workflow.records.projectBaseline.length === 1);
  for (const name of ['deliverable.accept', 'changeRequest.decide', 'project.closeout', 'experience.review', 'project.createFromAward']) {
    assert.equal((await act(name, {}, {})).status, 401, name);
  }
  assert.equal(typeof owner.authorization, 'string');
});
