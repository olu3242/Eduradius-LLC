# Interactive landing page

The public EduRadius landing page retains the existing Next.js 16.4.5 runtime
and owner APIs. It uses TypeScript, Tailwind utilities (without a global reset),
Lucide, Framer Motion, existing shadcn/Radix Sheet components, and lazy-loaded
jsPDF. It does not downgrade the framework to Next.js 14.

The pine-and-cream design includes a fixed translucent header, persistent
page-scoped theme toggle, four-step interactive framework, capability explorer,
keyboard-operated six-stage lifecycle, teaming scope checker, registration status
cards with copy actions, direct PDF draft download, filtered article drawers,
and a two-step briefing wizard. Mobile has a menu drawer and floating action dock.

All public content still loads through `/api/site`. Briefings submit the existing
validated inquiry kinds to `/api/inquiries`; the wizard retains details on error,
prevents repeated submission while saving, validates fields, and confirms a saved
request without promising email or a response time. Teaming selections prefill
scope; sector calls to action preselect the matching sector. Owner workspace and
access control are unchanged. No database migration or production data import is
part of the redesign.

Registration identifiers are never invented. Missing identifiers remain
unverified, classifications remain candidates, and all capability PDFs remain
marked DRAFT FOR REVIEW. The teaming checker expresses potential scope alignment,
not a certification, eligibility decision, capacity promise, or award claim.

## Verification

- Native Next.js production build, including TypeScript: pass.
- Frozen pnpm install: pass. The optional core-js postinstall is explicitly disabled.
- Existing regression suite: 131 tests pass.
- Desktop browser: framework and capability selection, lifecycle panel changes,
  teaming selection and scope handoff, required-field validation, successful local
  briefing submission, category filtering, article drawer and Escape dismissal.
- 390-pixel iframe viewport: mobile layout, dark theme, navigation drawer,
  briefing handoff and floating dock checked. Document width did not exceed viewport.
- PDF download: completed through the browser; parsed as a valid one-page PDF,
  with company name, draft warning and unverified registration labels.
- Reduced motion is respected in Framer Motion and CSS; native cursors are retained
  for coarse pointers. No formal accessibility audit is claimed.

Browser test data was saved only in the isolated local preview database.
