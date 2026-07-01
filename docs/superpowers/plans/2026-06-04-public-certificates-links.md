# Public Certificates Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a direct public certificates page per company, with slug-based URL, fallback share ID, and copyable link in the internal certificates screen.

**Architecture:** Extend `Company` with public certificate identifiers generated deterministically and normalized on read/save. Add a public route that resolves a company by slug or fallback ID, loads that company's certificates, and renders valid certificates first with an optional expired section.

**Tech Stack:** React 19, React Router, TypeScript, node:test, Vite

---

### Task 1: Public identifiers for companies

**Files:**
- Modify: `types.ts`
- Modify: `services/companyService.ts`
- Test: `tests/company-service.test.ts`

- [ ] Write the failing tests for slug/shareId generation and company lookup by public identifier.
- [ ] Run `node --test tests/company-service.test.ts` and verify the new assertions fail for the missing behavior.
- [ ] Implement the minimal public identifier normalization in `services/companyService.ts` and new fields in `types.ts`.
- [ ] Run `node --test tests/company-service.test.ts` and verify it passes.

### Task 2: Public certificates page

**Files:**
- Create: `pages/PublicCertificates.tsx`
- Modify: `App.tsx`
- Modify: `services/certificateService.ts`

- [ ] Write the minimal helper behavior needed to load certificates for a resolved company and separate valid vs expired records.
- [ ] Implement the public page and route without authentication.
- [ ] Verify the page handles missing company, valid certificates, expired certificates, and missing files gracefully.

### Task 3: Internal sharing UI

**Files:**
- Modify: `pages/Certificates.tsx`

- [ ] Add a share block that shows the direct public link and fallback code for the current company.
- [ ] Add copy-to-clipboard behavior with browser fallback-friendly messaging.
- [ ] Verify the internal screen still supports add/edit/delete and now exposes the public link clearly.

### Task 4: Verification

**Files:**
- Test: `tests/company-service.test.ts`
- Verify: app build

- [ ] Run `node --test tests/company-service.test.ts`.
- [ ] Run `npm run build`.
- [ ] Confirm there are no TypeScript or bundling regressions caused by the new public route.
