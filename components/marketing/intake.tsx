'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Check, CircleCheck, LoaderCircle, LockKeyhole } from 'lucide-react';
import type { InquiryKind } from '../../lib/inquiry';
import { sectors } from './content';
export type BriefingContext = { id: number; kind: InquiryKind; scope?: string; sector?: string } | null;
const objectives: { label: string; kind: InquiryKind }[] = [{ label: 'Project briefing', kind: 'Project briefing' }, { label: 'Teaming inquiry', kind: 'Teaming inquiry' }, { label: 'Governance', kind: 'AI governance briefing' }, { label: 'Training', kind: 'Training and education briefing' }];
type Fields = { name: string; organization: string; email: string; scope: string };
export function IntakeWizard({ ready, loadError, context, onRetry }: { ready: boolean; loadError: boolean; context: BriefingContext; onRetry: () => void }) {
  const [step, setStep] = useState(0), [kind, setKind] = useState<InquiryKind>('Project briefing'), [sector, setSector] = useState(sectors[0].value);
  const [fields, setFields] = useState<Fields>({ name: '', organization: '', email: '', scope: '' });
  const [touched, setTouched] = useState<Record<string, boolean>>({}), [trap, setTrap] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [success, setSuccess] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (context) { setKind(context.kind); if (context.sector) setSector(context.sector); setStep(0); setSuccess(false); setMessage(''); if (context.scope) setFields(f => ({ ...f, scope: f.scope.includes(context.scope!) ? f.scope : f.scope ? f.scope + '\n\n' + context.scope : context.scope! })); title.current?.focus({ preventScroll: true }); } }, [context]);
  const errors: Partial<Record<keyof Fields, string>> = {};
  if (!fields.name.trim()) errors.name = 'Enter your name.';
  if (!fields.organization.trim()) errors.organization = 'Enter your organization.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email.trim())) errors.email = 'Enter a valid email address.';
  if (!fields.scope.trim()) errors.scope = 'Tell us a little about your objective.';
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (busy) return;
    setTouched({ name: true, organization: true, email: true, scope: true });
    if (Object.keys(errors).length) { document.getElementById(`briefing-${Object.keys(errors)[0]}`)?.focus(); return; }
    if (!ready) { setMessage('The briefing service is unavailable. Retry the connection; your details remain here.'); return; }
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/inquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...fields, kind, sector, website: trap }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Unable to save the briefing. Please retry.');
      setSuccess(true); setFields({ name: '', organization: '', email: '', scope: '' }); setTouched({}); setTrap('');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to save your briefing. Your details remain here.'); } finally { setBusy(false); }
  }
  function next() { setStep(1); setTimeout(() => document.getElementById('briefing-name')?.focus(), 0); }
  return <div className="er-wizard"><div className="er-wizard-top"><span>YOUR NEXT STEP STARTS HERE</span><span>0{step + 1} / 02</span></div><div className="er-wizard-progress" aria-hidden="true"><span style={{ width: step ? '100%' : '50%' }}/></div>
    {success ? <div className="er-success" role="status"><CircleCheck size={42}/><h3>Thank you. Let’s move<br/>the conversation forward.</h3><p>Your briefing has been saved for the EduRadius owner to review. No email has been sent, and no response time is promised.</p><button className="er-text-link" onClick={() => { setSuccess(false); setStep(0); }}>Start another briefing <ArrowUpRight size={16}/></button></div> : <form onSubmit={submit} noValidate>
      <h3 ref={title} tabIndex={-1}>{step ? 'A little context. A useful conversation.' : 'What brings you here?'}</h3><p className="er-wizard-intro">{step ? 'Tell us about your team and the challenge you have in mind.' : 'Choose a starting point. We’ll shape the scope together.'}</p>
      {step === 0 ? <><fieldset><legend>01 / Your objective</legend><div className="er-objective-pills">{objectives.map(o => <button type="button" key={o.kind} aria-pressed={kind === o.kind} className={kind === o.kind ? 'is-active' : ''} onClick={() => setKind(o.kind)}>{kind === o.kind && <Check size={13}/>} {o.label}</button>)}{!objectives.some(o => o.kind === kind) && <button type="button" className="is-active" aria-pressed="true"><Check size={13}/>{kind}</button>}</div></fieldset><fieldset><legend>02 / Your sector</legend><div className="er-sector-options">{sectors.map(s => <label key={s.label} className={sector === s.value ? 'is-active' : ''}><input type="radio" name="briefing-sector" value={s.value} checked={sector === s.value} onChange={() => setSector(s.value)}/><span><strong>{s.label}</strong><small>{s.text}</small></span></label>)}</div></fieldset><button type="button" className="er-button er-button-dark er-wizard-next" onClick={next}>Continue to your details <ArrowUpRight size={17}/></button></> : <><div className="er-intake-summary"><span>{kind}</span><span>{sectors.find(s => s.value === sector)?.label}</span></div><div className="er-input-grid">{(['name', 'organization', 'email', 'scope'] as const).map(key => <label key={key} className={key === 'scope' || key === 'email' ? 'er-wide-field' : ''} htmlFor={`briefing-${key}`}>{({ name: 'Your name', organization: 'Organization', email: 'Work email', scope: 'What would you like to work on?' })[key]}{key === 'scope' ? <textarea id={`briefing-${key}`} name={key} rows={4} maxLength={5000} value={fields[key]} placeholder="Your objective, timeline, and any relevant procurement details." onChange={e => setFields(f => ({ ...f, [key]: e.target.value }))} onBlur={() => setTouched(t => ({ ...t, [key]: true }))} aria-invalid={!!(touched[key] && errors[key])} aria-describedby={touched[key] && errors[key] ? `${key}-error` : undefined} required/> : <input id={`briefing-${key}`} name={key} type={key === 'email' ? 'email' : 'text'} autoComplete={{ name: 'name', organization: 'organization', email: 'email' }[key]} maxLength={key === 'email' ? 254 : 160} value={fields[key]} onChange={e => setFields(f => ({ ...f, [key]: e.target.value }))} onBlur={() => setTouched(t => ({ ...t, [key]: true }))} aria-invalid={!!(touched[key] && errors[key])} aria-describedby={touched[key] && errors[key] ? `${key}-error` : undefined} required/>}{touched[key] && errors[key] && <small className="er-field-error" id={`${key}-error`}>{errors[key]}</small>}</label>)}</div><label className="er-honeypot" aria-hidden="true">Website<input name="website" autoComplete="off" tabIndex={-1} value={trap} onChange={e => setTrap(e.target.value)}/></label><div className="er-wizard-actions"><button type="button" className="er-text-link" disabled={busy} onClick={() => setStep(0)}><ArrowLeft size={15}/>Back</button><button type="submit" className="er-button er-button-dark" disabled={busy || !ready}>{busy ? <><LoaderCircle size={16} className="er-spin"/>Saving…</> : <>Send briefing request <ArrowUpRight size={16}/></>}</button></div></>}
      <p className="er-intake-error" role="alert">{message}</p><div className="er-wizard-privacy"><LockKeyhole size={13}/><span>Your details are saved privately for owner review. Please omit confidential or sensitive information.</span></div>{!ready && <p className="er-connection" role="status">{loadError ? <>We couldn’t connect. <button type="button" onClick={onRetry}>Retry connection</button></> : 'Connecting to the briefing service…'}</p>}
    </form>}
  </div>;
}
