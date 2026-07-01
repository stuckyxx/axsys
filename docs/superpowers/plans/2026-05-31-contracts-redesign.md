# Contracts redesign implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the AXSYS contracts screen into a premium SaaS-style administrative panel while keeping the current React + Vite + local persistence stack.

**Architecture:** Extract contract status, filtering, summary, and pagination logic into a reusable utility module covered by tests. Compose the visual redesign from focused React components so the contracts experience can render its own premium shell inside the administrative module without duplicating business logic.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind via CDN classes, React Router, localStorage persistence, Node built-in test runner for utility coverage

---

### Task 1: Prepare data model and tested contract utilities

**Files:**
- Create: `utils/contracts.ts`
- Create: `tests/contracts-utils.test.ts`
- Modify: `types.ts`

- [ ] Write failing tests for status calculation, upcoming expiry, entity derivation, search/filter behavior, metrics, and pagination.
- [ ] Run the focused test command and confirm the failures come from the missing utility module.
- [ ] Implement the minimal utility functions and type additions required by the tests.
- [ ] Re-run the focused test command and confirm it passes.

### Task 2: Build reusable contracts UI pieces

**Files:**
- Create: `components/contracts/ContractsModuleShell.tsx`
- Create: `components/contracts/AdministrativeTabs.tsx`
- Create: `components/contracts/ContractStatsCards.tsx`
- Create: `components/contracts/ContractsToolbar.tsx`
- Create: `components/contracts/ContractCard.tsx`
- Create: `components/contracts/ContractActionsMenu.tsx`
- Create: `components/contracts/ContractAttachmentModal.tsx`
- Create: `components/contracts/ContractsPagination.tsx`

- [ ] Implement the premium shell, header, top actions, tabs, stats cards, toolbar, and pagination around typed props.
- [ ] Implement the premium contract card and actions menu with accessible buttons, keyboard-safe dropdown behavior, and responsive layout.
- [ ] Implement the attachment modal so contract files can be stored in the current local model.

### Task 3: Rebuild the contracts page around the new components

**Files:**
- Modify: `pages/Contracts.tsx`

- [ ] Replace the current monolithic contract list with the new orchestrated experience.
- [ ] Keep create, edit, delete, attach, close, public-link, and download flows wired to the local data model.
- [ ] Add premium empty state, real search, filters, and pagination.

### Task 4: Adjust administrative integration

**Files:**
- Modify: `pages/Administrative.tsx`

- [ ] Prevent duplicated module chrome when the contracts screen renders its own premium shell.
- [ ] Pass the active tab context and tab-switch handlers needed by the redesigned contracts experience.

### Task 5: Verify the redesign

**Files:**
- Verify only

- [ ] Run the focused contract utility tests.
- [ ] Run the production build.
- [ ] Review the resulting diff for scope safety before reporting completion.
