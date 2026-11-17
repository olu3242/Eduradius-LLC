'use client';
import { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, Check, MoveUpRight, Sparkles } from 'lucide-react';
import { practices } from './content';
export function FrameworkCanvas() {
  const [active, setActive] = useState(0);
  const reduced = useReducedMotion();
  const chosen = practices[active];
  return <div className="er-canvas" aria-label="Explore the four-part EduRadius framework">
    <div className="er-canvas-heading"><span><span className="er-live-dot"/> THE EDURADIUS FRAMEWORK</span><span>01 — 04</span></div>
    <div className="er-orbit-map">
      <svg viewBox="0 0 500 320" aria-hidden="true" className="er-orbit-lines"><ellipse cx="250" cy="160" rx="151" ry="120"/><ellipse cx="250" cy="160" rx="207" ry="71" transform="rotate(-32 250 160)"/><path d="M92 75 L250 160 L410 79 M91 249 L250 160 L410 245"/><circle cx="250" cy="160" r="82"/></svg>
      <div className="er-orbit-core"><img src="/brand/radius-v2/eduradius-symbol.svg" width="66" height="66" alt=""/><span>Human purpose.<br/><strong>Intelligent progress.</strong></span></div>
      {practices.map((p, i) => <button key={p.label} className={`er-orbit-node er-node-${i} ${active === i ? 'is-active' : ''}`} aria-pressed={active === i} onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onClick={() => setActive(i)} aria-controls="framework-preview"><span>0{i + 1}</span><p.icon size={18}/><strong>{p.label}</strong><ArrowUpRight size={13}/></button>)}
    </div>
    <div id="framework-preview" className="er-framework-preview" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}><motion.div key={active} initial={reduced ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .15 }}><div><span className="er-canvas-small">0{active + 1} / {chosen.label.toUpperCase()}</span><h3>{chosen.question}</h3><p>{chosen.detail}</p></div><span className="er-canvas-icon"><chosen.icon size={25}/></span></motion.div></AnimatePresence>
    </div>
    <div className="er-canvas-footer"><span><Sparkles size={13}/> One connected approach</span><span>EXPLORE EACH STEP <MoveUpRight size={13}/></span></div>
  </div>;
}
export function CapabilityExplorer({ descriptions, onRequest }: { descriptions: string[]; onRequest: (index: number) => void }) {
  const [active, setActive] = useState(0);
  const chosen = practices[active];
  return <div className="er-capability-explorer">
    <div className="er-practice-grid" aria-label="Choose a capability">{practices.map((p, i) => <button key={p.name} aria-pressed={active === i} aria-controls="capability-preview" onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onClick={() => setActive(i)} className={`er-practice-card ${active === i ? 'is-active' : ''}`}><div><p.icon size={24}/><span>0{i + 1}</span></div><h3>{p.name}</h3><p>{p.summary}</p><span className="er-card-link">Explore the practice <ArrowUpRight size={17}/></span></button>)}</div>
    <div className="er-capability-detail" id="capability-preview">
      <div className="er-deliverable-visual" aria-hidden="true"><div className="er-document er-document-back"/><div className="er-document"><div className="er-document-top"><chosen.icon size={21}/><span>EDURADIUS / {chosen.label.toUpperCase()}</span></div><h4>{chosen.artifact}</h4><div className="er-diagram-flow">{chosen.nodes.map((n, i) => <div key={n}><span>0{i+1}</span>{n}</div>)}</div><div className="er-document-lines"><i/><i/><i/></div><div className="er-document-stamp"><Check size={13}/>{chosen.metric}</div><span className="er-document-caption">ILLUSTRATIVE ENGAGEMENT DELIVERABLE</span></div></div>
      <div className="er-capability-copy"><span className="er-eyebrow">{chosen.label} / FROM QUESTION TO DIRECTION</span><h3>{chosen.title}</h3><p>{descriptions[active] || chosen.summary}</p><ul>{chosen.deliverables.map(d => <li key={d}><Check size={15}/>{d}</li>)}</ul><button className="er-text-link group" onClick={() => onRequest(active)}>Discuss {chosen.name} <ArrowUpRight className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" size={17}/></button><small>Potential scope. Deliverables are agreed during intake.</small></div>
    </div>
  </div>;
}
