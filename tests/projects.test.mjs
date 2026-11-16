import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withIsolatedDatabase, add, added, edit, edited, act, acted, snapshot, record, awardedSubmission, projectInput } from './helpers/api.mjs';
import { findCycle } from '../lib/records.ts';

withIsolatedDatabase();

test('a project needs a recorded award with evidence and explicit confirmation', async () => {
  const pending = await awardedSubmission({ award: false });
  assert.equal((await act('project.createFromAward', projectInput(pending.submission))).status, 409, 'submission is not an award');
  const { submission, opp, org, notice } = await awardedSubmission();
  assert.equal((await act('project.createFromAward', projectInput(submission, { confirm: false }))).status, 400);
  assert.equal((await act('project.createFromAward', projectInput(submission, { scope: '' }))).status, 400);
  assert.equal((await act('project.createFromAward', projectInput(submission, { plannedEndDate: '2026-01-01' }))).status, 400);
  assert.equal((await add('project', { title: 'x' })).status, 400, 'generic create rejected');
  const { record: project, alreadyCreated } = await acted('project.createFromAward', projectInput(submission, { clientOrganizationId: org.id }), 201);
  assert.equal(alreadyCreated, false);
  assert.equal(project.opportunityId, opp.id); assert.equal(project.submissionId, submission.id); assert.equal(project.proposalVersionId, submission.proposalVersionId);
  assert.equal(project.status, 'Planning'); assert.equal(project.awardEvidenceId, notice.id);
  const snap = await snapshot();
  const baseline = snap.records.projectBaseline.find(b => b.id === project.activeBaselineId);
  assert.equal(baseline.number, 1); assert.equal(baseline.source, 'Award baseline'); assert.equal(baseline.scope, project.scope);
  assert.equal(snap.records.deliverable.filter(d => d.projectId === project.id).length, 2);
  assert.ok(snap.evidenceLinks.some(l => l.subjectType === 'project' && l.subjectId === project.id && l.evidenceId === notice.id));
  assert.equal((await edit('project', project, { scope: 'Expanded scope' })).status, 400, 'baseline scope changes only through approved changes');
  const currentSubmission = await record('submission', submission.id);
  const locked = await act('submission.recordOutcome', { id: submission.id, version: currentSubmission.version, outcome: 'Not awarded' });
  assert.equal(locked.status, 409, 'outcome locked once a project exists');
  assert.match((await locked.json()).error, /project was created/);
});

test('duplicate and concurrent project creation produce exactly one project', async () => {
  const { submission } = await awardedSubmission();
  const results = await Promise.all([act('project.createFromAward', projectInput(submission)), act('project.createFromAward', projectInput(submission))]);
  const bodies = await Promise.all(results.map(r => r.json()));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 201]);
  assert.equal(bodies[0].record.id, bodies[1].record.id);
  const retry = await acted('project.createFromAward', projectInput(submission));
  assert.equal(retry.alreadyCreated, true);
  assert.equal((await snapshot()).records.project.length, 1);
});

test('project status transitions are enforced with reasons; closed only via closeout', async () => {
  const { submission } = await awardedSubmission();
  let { record: p } = await acted('project.createFromAward', projectInput(submission), 201);
  assert.equal((await act('project.transition', { id: p.id, version: p.version, to: 'Closed' })).status, 400);
  assert.equal((await act('project.transition', { id: p.id, version: p.version, to: 'Closing' })).status, 409, 'Planning cannot jump to Closing');
  assert.equal((await act('project.transition', { id: p.id, version: p.version, to: 'Cancelled' })).status, 400, 'reason required');
  p = (await acted('project.transition', { id: p.id, version: p.version, to: 'Active' })).record;
  p = (await acted('project.transition', { id: p.id, version: p.version, to: 'Cancelled', reason: 'Client withdrew funding.' })).record;
  assert.equal(p.status, 'Cancelled'); assert.equal(p.statusReason, 'Client withdrew funding.');
  assert.equal((await add('milestone', { projectId: p.id, title: 'Kickoff' })).status, 400, 'cancelled project is locked');
  assert.equal((await act('project.transition', { id: p.id, version: p.version, to: 'Planning' })).status, 400, 'reopening needs a reason');
  p = (await acted('project.transition', { id: p.id, version: p.version, to: 'Planning', reason: 'Funding restored.' })).record;
  const types = (await snapshot()).activity.map(a => a.type);
  assert.ok(types.includes('project.cancelled') && types.includes('project.reopened'));
});

test('milestone dependencies cannot form cycles or cross projects; completed work is protected', async () => {
  assert.deepEqual(findCycle([{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['c'] }, { id: 'c', dependsOn: ['a'] }]), ['a', 'b', 'c', 'a']);
  const one = await awardedSubmission(), two = await awardedSubmission();
  const { record: p } = await acted('project.createFromAward', projectInput(one.submission), 201);
  const { record: other } = await acted('project.createFromAward', projectInput(two.submission), 201);
  const a = await added('milestone', { projectId: p.id, title: 'Discovery', plannedDate: '2026-12-20', completionCriteria: 'Stakeholder interviews done' });
  let b = await added('milestone', { projectId: p.id, title: 'Draft framework', dependsOn: [a.id] });
  const foreign = await added('milestone', { projectId: other.id, title: 'Elsewhere' });
  assert.equal((await edit('milestone', a, { dependsOn: [b.id] })).status, 400, 'cycle rejected');
  assert.equal((await edit('milestone', a, { dependsOn: [a.id] })).status, 400, 'self dependency rejected');
  assert.equal((await edit('milestone', b, { dependsOn: [foreign.id] })).status, 400, 'cross-project dependency rejected');
  assert.equal((await edit('milestone', b, { status: 'Complete', actualDate: '2027-01-10' })).status, 400, 'dependency must be complete first');
  assert.equal((await edit('milestone', a, { status: 'Complete' })).status, 400, 'actual date required');
  const doneA = await edited('milestone', a, { status: 'Complete', actualDate: '2026-12-19' });
  assert.equal((await edit('milestone', doneA, { title: 'Renamed' })).status, 400, 'completed work locked');
  assert.equal((await edit('milestone', doneA, { status: 'In progress' })).status, 400, 'reopen needs a reason');
  const reopened = await edited('milestone', doneA, { status: 'In progress', changeNote: 'Two interviews rescheduled.' });
  assert.equal(reopened.status, 'In progress');
  b = await record('milestone', b.id);
  assert.equal((await add('deliverable', { projectId: p.id, title: 'x', milestoneId: foreign.id })).status, 400, 'deliverable milestone must be in the same project');
});

test('risk, issue and decision log requires a resolution to close', async () => {
  const { submission } = await awardedSubmission();
  const { record: p } = await acted('project.createFromAward', projectInput(submission), 201);
  const risk = await added('projectLog', { projectId: p.id, kind: 'Risk', title: 'Staff availability in December', severity: 'High' });
  assert.equal((await edit('projectLog', risk, { status: 'Resolved' })).status, 400);
  assert.equal((await edited('projectLog', risk, { status: 'Resolved', resolution: 'Sessions moved to January.' })).status, 'Resolved');
  assert.equal((await add('projectLog', { projectId: p.id, kind: 'Gossip', title: 'x' })).status, 400);
});
