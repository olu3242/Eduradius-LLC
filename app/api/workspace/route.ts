import { requireOwner } from '../../../lib/server/access';
import { crossSiteRejection, json, logEvent, readJson } from '../../../lib/server/http';
import { MAX_WORKSPACE_BYTES, readWorkspace, writeWorkspace } from '../../../lib/server/workspace-store';
import { importLegacyWorkflow, LEGACY_KEYS } from '../../../lib/server/workflow-store';
export const dynamic = 'force-dynamic';
// Owner-only planning document (profile, codes, registrations, documents, site content).
// Inquiries, opportunities and activity live in workflow tables: see /api/workflow.
// Public website data is served by /api/site; public intake by /api/inquiries.
export async function GET(request: Request) {
 const access = await requireOwner(request); if (!access.ok) return access.response;
 try { await importLegacyWorkflow(); return json(await readWorkspace()); }
 catch (e) { logEvent('workspace.error', { message: String(e) }); return json({error:'Workspace could not be loaded. Please retry.'},503); }
}
export async function PUT(request: Request) {
 const rejected = await crossSiteRejection(request); if (rejected) return rejected;
 const access = await requireOwner(request); if (!access.ok) return access.response;
 try {
 const body = await readJson<{data?: Record<string, unknown>; revision?: number}>(request, MAX_WORKSPACE_BYTES);
 if(body === 'too_large') return json({error:'Workspace exceeds size limit.'},413);
 if(!body || typeof body !== 'object') return json({error:'Invalid workspace.'},400);
 const {data, revision} = body;
 if(!data || typeof data!=='object' || Array.isArray(data) || !data.profile || !Array.isArray(data.codes) || !Array.isArray(data.documents) || typeof revision !== 'number' || !Number.isInteger(revision) || revision<0) return json({error:'Invalid workspace.'},400);
 // Workflow records are authoritative in their own tables; never re-create JSON copies.
 const document = { ...data };
 for (const key of LEGACY_KEYS) delete document[key];
 const saved = await writeWorkspace(document, revision);
 if(!saved) return json({error:'This workspace changed in another tab. Export your edits, then reload before saving.'},409);
 logEvent('workspace.saved', { revision: saved.revision, actor: access.owner.mode });
 return json(saved);
 }catch{return json({error:'Unable to save. Your edits remain on this page; retry or export a backup.'},503);}
}
