'use client';
import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Check } from 'lucide-react';
import { lifecycle } from './content';
export function Lifecycle() {
  const [active, setActive] = useState(0);
  const reduced = useReducedMotion();
  const stage = lifecycle[active];
  return <div className="er-lifecycle">
    <div className="er-stepper" role="tablist" aria-label="Engagement lifecycle">
      <motion.div className="er-stepper-line" initial={{ scaleX: reduced ? 1 : 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true, amount: .6 }} transition={{ duration: 1.1 }}/>
      {lifecycle.map((step, i) => <button key={step.title} role="tab" id={`stage-${i}`} aria-controls="stage-panel" aria-selected={active === i} tabIndex={active === i ? 0 : -1} onClick={() => setActive(i)} onKeyDown={e => { let next = i; if (e.key === 'ArrowRight') next = (i + 1) % 6; else if (e.key === 'ArrowLeft') next = (i + 5) % 6; else if (e.key === 'Home') next = 0; else if (e.key === 'End') next = 5; else return; e.preventDefault(); setActive(next); document.getElementById(`stage-${next}`)?.focus(); }} className={active === i ? 'is-active' : ''}><span>0{i + 1}</span><strong>{step.title}</strong><ArrowRight size={14}/></button>)}
    </div>
    <div className="er-stage-panel" id="stage-panel" role="tabpanel" aria-labelledby={`stage-${active}`}><div className="er-stage-number" aria-hidden="true">0{active + 1}</div><div><span className="er-eyebrow">{stage.title} / THE NEXT PRACTICAL STEP</span><h3>{stage.summary}</h3><p>{stage.body}</p></div><div className="er-stage-outputs"><span className="er-eyebrow">WHAT WE EXPLORE TOGETHER</span>{stage.outputs.map(o => <p key={o}><Check size={15}/>{o}</p>)}<small>Proposed framework. Scope and milestones are agreed with you.</small></div></div>
  </div>;
}
