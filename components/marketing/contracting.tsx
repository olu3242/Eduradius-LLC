'use client';
import { useState } from 'react';
import { ArrowUpRight, Check, CircleCheck, Copy, Download, FileText, LoaderCircle, ShieldCheck } from 'lucide-react';
import type { Workspace } from '../../lib/workspace';
import { practices, scopes } from './content';
export function ContractingCard({ workspace: w }: { workspace: Workspace }) {
  const [copied, setCopied] = useState('');
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('');
  async function copy(code: string) { try { await navigator.clipboard.writeText(code); setCopied(code); setTimeout(() => setCopied(c => c === code ? '' : c), 2200); } catch { setMessage('Copy is unavailable in this browser. Select the displayed code to copy it.'); } }
  async function exportPdf() {
    setExporting(true); setMessage('');
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      const clean = (s: string) => s.replace(/[–—]/g, '-').replace(/→/g, 'to').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7e\n]/g, ' ');
      let y = 24;
      doc.setFillColor(12, 45, 36); doc.rect(0, 0, 210, 49, 'F');
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(26); doc.text('EduRadius LLC', 19, y);
      doc.setFontSize(10); doc.text('CAPABILITY STATEMENT - DRAFT FOR REVIEW', 19, y + 12); y = 62;
      const section = (title: string, body: string) => {
        if (y > 246) { doc.addPage(); y = 22; }
        doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(12, 45, 36); doc.text(title, 19, y); y += 7;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(60, 75, 68);
        for (const line of doc.splitTextToSize(clean(body), 170) as string[]) { if (y > 267) { doc.addPage(); y = 22; } doc.text(line, 19, y); y += 5.2; } y += 9;
      };
      section('CORE COMPETENCIES', [w.profile.summary, ...w.profile.services, w.profile.deliverables || 'Engagement deliverables are agreed during intake.'].join('\n'));
      section('DIFFERENTIATORS', w.profile.differentiators || 'Verified differentiators have not been added.');
      section('PAST PERFORMANCE', w.profile.experience || 'No verified past performance is published.');
      section('COMPANY DETAILS', [w.profile.location, w.profile.contact, w.profile.email, w.profile.website, `Primary NAICS: ${w.primary || 'Not selected'} (${w.primaryStatus})`, ...w.registrations.map(r => `${r.name}: ${r.value || 'Not verified'} - ${r.status}`)].filter(Boolean).join('\n'));
      section('REVIEW NOTICE', 'Draft only. Verify all identifiers, classifications, qualifications and claims before external use. Candidate NAICS codes do not establish eligibility, registration, certification or past performance.');
      for (let i = 1; i <= doc.getNumberOfPages(); i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(100, 110, 105); doc.text(`EDURADIUS LLC / DRAFT FOR REVIEW / ${i} OF ${doc.getNumberOfPages()}`, 19, 287); }
      doc.save('EduRadius-Capability-Statement-Draft.pdf'); setMessage('Capability statement PDF downloaded. Review the draft before sharing.');
    } catch { setMessage('PDF export could not finish. Please retry. Your data has not changed.'); } finally { setExporting(false); }
  }
  return <div className="er-contracting-layout">
    <div className="er-registration-card"><div className="er-card-heading"><ShieldCheck size={22}/><div><h3>Company & procurement details</h3><p>Transparent about what is verified.</p></div></div><div className="er-registration-list">{w.registrations.map(r => <div key={r.name}><span>{r.name}</span><div><strong>{r.value || 'Not yet verified'}</strong><span className={`er-status ${r.value ? 'recorded' : ''}`}>{r.value ? 'Recorded · confirm evidence' : 'Unverified'}</span></div></div>)}</div><div className="er-code-heading"><span className="er-eyebrow">NAICS CANDIDATES</span><span>Subject to scope review</span></div><div className="er-code-grid">{w.codes.filter(c => c.group === 'Core services' && c.code !== '511210').slice(0, 6).map(c => <div key={c.code}><div><strong>{c.code}</strong><button onClick={() => copy(c.code)} aria-label={`Copy NAICS ${c.code}`}>{copied === c.code ? <Check size={14}/> : <Copy size={14}/>}</button></div><p>{c.title}</p></div>)}</div><p className="er-fine-print">Candidate classifications only. SAM registration, identifiers, certifications, and procurement eligibility require official verification.</p><span role="status" className="er-sr-only">{copied ? `NAICS ${copied} copied` : ''}</span></div>
    <div className="er-statement-card"><div className="er-statement-paper"><div className="er-statement-masthead"><span className="er-brand">EduRadius<small>LLC</small></span><FileText size={20}/></div><span className="er-status">DRAFT FOR REVIEW</span><h3>Capability<br/>statement.</h3><p>{w.profile.summary}</p><div className="er-paper-rule"/><span className="er-eyebrow">CORE COMPETENCIES</span>{w.profile.services.map(s => <span className="er-statement-service" key={s}><Check size={12}/>{s}</span>)}<div className="er-statement-meta"><span>{w.profile.location}</span><span>EDURADIUS LLC / 01</span></div></div><div className="er-statement-action"><div><strong>A clear starting point.</strong><p>A reviewable draft of our capabilities.</p></div><button className="er-button er-button-dark" onClick={exportPdf} disabled={exporting}>{exporting ? <LoaderCircle className="er-spin" size={16}/> : <Download size={16}/>} {exporting ? 'Preparing…' : 'Export PDF'}</button></div><p className="er-export-status" role="status">{message}</p><a className="er-text-link" href="/workspace">Open contracting workspace <ArrowUpRight size={16}/></a></div>
  </div>;
}
export function TeamingChecker({ onRequest }: { onRequest: (scope: string) => void }) {
  const [model, setModel] = useState<string>(scopes[0]);
  const [needs, setNeeds] = useState<string[]>(['AI governance']);
  const toggle = (name: string) => setNeeds(n => n.includes(name) ? n.filter(v => v !== name) : [...n, name]);
  return <div className="er-teaming-checker"><div><span className="er-eyebrow">FIND A POTENTIAL FIT</span><h3>What would strengthen<br/> your team?</h3><p>Map your needs to our practices. Use the result to start a focused conversation.</p><div className="er-model-picker" role="group" aria-label="Engagement model">{scopes.map(s => <button key={s} aria-pressed={model === s} className={model === s ? 'is-active' : ''} onClick={() => setModel(s)}>{s}{model === s && <Check size={14}/>}</button>)}</div></div><div className="er-fit-matrix"><div className="er-fit-heading"><span>SELECT YOUR SCOPE</span><span>POTENTIAL ALIGNMENT</span></div>{practices.map(p => <label key={p.name}><span><input type="checkbox" checked={needs.includes(p.name)} onChange={() => toggle(p.name)}/>{p.name}</span><span className={needs.includes(p.name) ? 'er-aligned' : 'er-not-selected'}>{needs.includes(p.name) ? <><CircleCheck size={15}/>Scope to explore</> : 'Select to explore'}</span></label>)}<p className="er-fit-summary" aria-live="polite">{needs.length ? `${needs.length} ${needs.length === 1 ? 'practice' : 'practices'} selected for ${model.toLowerCase()}. Confirm capacity, qualifications, procurement terms, and responsibilities together.` : 'Select at least one practice to build your conversation brief.'}</p><button disabled={!needs.length} className="er-button er-button-lime" onClick={() => onRequest(`Engagement model: ${model}. Practices to explore: ${needs.join(', ')}.`)}>Discuss this scope <ArrowUpRight size={16}/></button></div></div>;
}
