import { env } from 'cloudflare:workers';
export const dynamic = 'force-dynamic';
// This shared workspace is protected by the Site's owner-private access policy.
export async function GET() {
 try { const row = await env.DB!.prepare('SELECT data, revision, updated_at FROM workspaces WHERE id = ?').bind('eduradius').first<{data:string, revision:number, updated_at:string}>();
 return Response.json(row ? {data:JSON.parse(row.data),revision:row.revision,updatedAt:row.updated_at} : {data:null,revision:0}, {headers:{'Cache-Control':'no-store'}}); }
 catch { return Response.json({error:'Workspace could not be loaded. Please retry.'},{status:503}); }
}
export async function PUT(request: Request) {
 if(request.headers.get('sec-fetch-site')==='cross-site') return Response.json({error:'Cross-site request rejected.'},{status:403});
 try {
 const raw = await request.text(); if(raw.length>700000) return Response.json({error:'Workspace exceeds size limit.'},{status:413});
 const {data, revision} = JSON.parse(raw);
 if(!data || typeof data!=='object' || !data.profile || !Array.isArray(data.codes) || !Array.isArray(data.opportunities) || !Array.isArray(data.documents) || !Number.isInteger(revision) || revision<0) return Response.json({error:'Invalid workspace.'},{status:400});
 const now = new Date().toISOString();
 const result = revision===0 ? await env.DB!.prepare('INSERT OR IGNORE INTO workspaces (id,data,revision,updated_at) VALUES (?,?,1,?)').bind('eduradius',JSON.stringify(data),now).run() : await env.DB!.prepare('UPDATE workspaces SET data=?, revision=revision+1, updated_at=? WHERE id=? AND revision=?').bind(JSON.stringify(data),now,'eduradius',revision).run();
 if(!result.meta.changes) return Response.json({error:'This workspace changed in another tab. Export your edits, then reload before saving.'},{status:409});
 return Response.json({revision:revision+1,updatedAt:now});
 }catch{return Response.json({error:'Unable to save. Your edits remain on this page; retry or export a backup.'},{status:503});}
}
