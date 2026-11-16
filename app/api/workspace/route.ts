import { requireOwner } from '../../../lib/server/access';
import { crossSiteRejection, json, logEvent } from '../../../lib/server/http';
import { MAX_WORKSPACE_BYTES, readWorkspace, writeWorkspace } from '../../../lib/server/workspace-store';
export const dynamic = 'force-dynamic';
// Owner-only. Public website data is served by /api/site; public intake by /api/inquiries.
export async function GET(request: Request) {
 const access = await requireOwner(request); if (!access.ok) return access.response;
 try { return json(await readWorkspace()); }
 catch { return json({error:'Workspace could not be loaded. Please retry.'},503); }
}
export async function PUT(request: Request) {
 const rejected = await crossSiteRejection(request); if (rejected) return rejected;
 const access = await requireOwner(request); if (!access.ok) return access.response;
 try {
 const raw = await request.text(); if(raw.length>MAX_WORKSPACE_BYTES) return json({error:'Workspace exceeds size limit.'},413);
 const {data, revision} = JSON.parse(raw);
 if(!data || typeof data!=='object' || !data.profile || !Array.isArray(data.codes) || !Array.isArray(data.opportunities) || !Array.isArray(data.documents) || !Number.isInteger(revision) || revision<0) return json({error:'Invalid workspace.'},400);
 const saved = await writeWorkspace(data, revision);
 if(!saved) return json({error:'This workspace changed in another tab. Export your edits, then reload before saving.'},409);
 logEvent('workspace.saved', { revision: saved.revision, actor: access.owner.mode });
 return json(saved);
 }catch{return json({error:'Unable to save. Your edits remain on this page; retry or export a backup.'},503);}
}
