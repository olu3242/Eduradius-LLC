// Owner decisions on legacy re-import conflicts (see detectImportConflicts). Server-only.
// A conflict is never resolved automatically: the owner keeps the current record or applies
// the legacy edit, with a recorded reason. Applying is version-guarded against the record as
// it was when the conflict was detected, so a later edit is never overwritten silently.
import { comparable, legacyInquiry, legacyOpportunity } from '../legacy-rollback';
import { CHECK_KEYS, CHECK_VALUES, mapLegacyInquiryStatus, OPPORTUNITY_DECISIONS, OPPORTUNITY_STAGES, OPPORTUNITY_STATUSES, isIsoDate } from '../workflow';
import { activityStatement, getInquiry, getOpportunity, type StoreResult } from './workflow-store';
import { db, nowIso } from './records-store';

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const parse = (v: unknown) => { try { return JSON.parse(s(v)); } catch { return null; } };
export const toConflict = (r: Row) => ({
  id: s(r.id), sourceSnapshotId: s(r.source_snapshot_id), subjectType: s(r.subject_type), subjectId: s(r.subject_id), legacyItem: parse(r.legacy_item), current: parse(r.baseline),
  fields: parse(r.fields) ?? [], status: s(r.status), decisionReason: s(r.decision_reason), decidedBy: r.decided_by ?? null, decidedAt: r.decided_at ?? null, version: Number(r.version), createdAt: s(r.created_at),
});

export async function listImportConflicts(status: 'Open' | 'all' = 'Open') {
  const rows = (await db().prepare(`SELECT * FROM import_conflicts ${status === 'Open' ? "WHERE status = 'Open'" : ''} ORDER BY created_at DESC, id DESC LIMIT 101`).all<Row>()).results;
  const total = Number((await db().prepare(`SELECT COUNT(*) AS n FROM import_conflicts ${status === 'Open' ? "WHERE status = 'Open'" : ''}`).first<Row>())?.n ?? 0);
  return { items: rows.slice(0, 100).map(toConflict), total };
}

/** Removes the "Assigned: …" / "Next action: …" lines the rollback appended to request notes. */
function legacyNotes(notes: string, appended: string) {
  const extra = appended.split('\n').slice(1).filter(Boolean);
  const lines = notes.split('\n');
  while (extra.length && lines.length && lines[lines.length - 1] === extra[extra.length - 1]) { lines.pop(); extra.pop(); }
  return lines.join('\n');
}

export async function resolveImportConflict(body: Row, actor: string): Promise<StoreResult<unknown>> {
  const row = await db().prepare('SELECT * FROM import_conflicts WHERE id = ?').bind(s(body.id)).first<Row>();
  if (!row) return { status: 404, body: { error: 'Conflict not found.' } };
  const c = toConflict(row);
  if (!Number.isInteger(body.version) || body.version !== c.version) return { status: 409, body: { error: 'This conflict changed. Reload and review it again.', current: c } };
  if (c.status !== 'Open') return { status: 409, body: { error: `This conflict was already decided (${c.status}).`, current: c } };
  const decision = s(body.decision), reason = s(body.reason).trim();
  if (!['keep-current', 'apply-legacy'].includes(decision)) return { status: 400, body: { error: 'Choose keep-current or apply-legacy.' } };
  if (!reason || reason.length > 1000) return { status: 400, body: { error: 'Record the reason for this decision (up to 1,000 characters).' } };
  const at = nowIso(), kind = c.subjectType as 'inquiry' | 'opportunity', table = kind === 'inquiry' ? 'inquiries' : 'opportunities';
  const record = kind === 'inquiry' ? await getInquiry(c.subjectId) : await getOpportunity(c.subjectId);
  if (!record) return { status: 404, body: { error: 'The record no longer exists.' } };
  const statements = [];
  let summary = `Kept the current ${kind}; the legacy edit to ${c.fields.join(', ')} was not applied`;
  if (decision === 'apply-legacy') {
    // Apply only if the record is still exactly what the conflict was detected against.
    const projection = (kind === 'inquiry' ? legacyInquiry(record as never) : legacyOpportunity(record as never)) as unknown as Row;
    const stillSame = JSON.stringify(comparable(kind, projection)) === JSON.stringify(comparable(kind, c.current ?? {}));
    if (!stillSame) return { status: 409, body: { error: 'The record was edited after this conflict was found. Review the current record, then decide again or keep it.', current: c } };
    const item = c.legacyItem as Row, sets: string[] = [], args: unknown[] = [];
    for (const field of c.fields as string[]) {
      if (kind === 'inquiry') {
        if (field === 'status') {
          if ((record as { status: string }).status === 'Converted') return { status: 409, body: { error: 'A converted request cannot change status; keep the current record and edit the opportunity instead.' } };
          const mapped = mapLegacyInquiryStatus(item.status); sets.push('status = ?', 'legacy_status = ?'); args.push(mapped.status, s(item.status));
        } else if (field === 'notes') { sets.push('notes = ?'); args.push(legacyNotes(s(item.notes), s(projection.notes)).slice(0, 8000)); }
        else { sets.push(`${field} = ?`); args.push(s(item[field]).slice(0, 4000)); }
      } else {
        const value = item[field];
        if (field === 'stage' && !(OPPORTUNITY_STAGES as readonly unknown[]).includes(value)) return { status: 400, body: { error: 'The legacy stage is not valid.' } };
        if (field === 'decision' && !(OPPORTUNITY_DECISIONS as readonly unknown[]).includes(value)) return { status: 400, body: { error: 'The legacy decision is not valid.' } };
        if (field === 'status' && !(OPPORTUNITY_STATUSES as readonly unknown[]).includes(value)) return { status: 400, body: { error: 'The legacy status is not valid.' } };
        if (field === 'deadline' && value && !isIsoDate(value)) return { status: 400, body: { error: 'The legacy deadline is not a valid date.' } };
        if (field === 'checks') {
          const raw = value && typeof value === 'object' ? value as Row : {}, checks = { ...(record as { checks: Row }).checks };
          for (const k of CHECK_KEYS) if ((CHECK_VALUES as readonly unknown[]).includes(raw[k])) checks[k] = raw[k];
          sets.push('checks = ?'); args.push(JSON.stringify(checks));
        } else { sets.push(`${field} = ?`); args.push(s(value).slice(0, field === 'notes' ? 8000 : 1000)); }
      }
    }
    statements.push(db().prepare(`UPDATE ${table} SET ${sets.join(', ')}, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`).bind(...args, at, record.id, record.version));
    summary = `Applied the legacy edit to ${c.fields.join(', ')} (rollback-window change)`;
  }
  // Applying also requires the record to still be at the version read above (same transaction),
  // so the conflict is only marked applied when the record update happens too.
  const recordGuard = decision === 'apply-legacy' ? ` AND EXISTS (SELECT 1 FROM ${table} WHERE id = ? AND version = ?)` : '';
  statements.unshift(db().prepare(`UPDATE import_conflicts SET status = ?, decision_reason = ?, decided_by = ?, decided_at = ?, version = version + 1 WHERE id = ? AND version = ? AND status = 'Open'${recordGuard}`)
    .bind(decision === 'apply-legacy' ? 'Applied legacy' : 'Kept current', reason, actor, at, c.id, c.version, ...(recordGuard ? [record.id, record.version] : [])));
  statements.push(activityStatement(actor, at, kind, c.subjectId, { type: decision === 'apply-legacy' ? 'import.conflict_applied' : 'import.conflict_kept', summary, details: { conflictId: c.id, fields: c.fields } },
    'SELECT 1 FROM import_conflicts WHERE id = ? AND decided_at = ?', [c.id, at]));
  const results = await db().batch(statements);
  if (!results[0].meta.changes) {
    // The conflict or the record changed concurrently; every statement was guarded, so nothing applied.
    return { status: 409, body: { error: 'This conflict or record changed while deciding. Reload and review it again.' } };
  }
  const updated = await db().prepare('SELECT * FROM import_conflicts WHERE id = ?').bind(c.id).first<Row>();
  return { status: 200, body: { conflict: toConflict(updated!), record: kind === 'inquiry' ? await getInquiry(c.subjectId) : await getOpportunity(c.subjectId) } };
}
