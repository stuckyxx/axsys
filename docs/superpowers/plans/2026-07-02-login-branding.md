# Login Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar a nova identidade visual Axsys na tela de login usando marca vetorial desenhada inline.

**Architecture:** Centralizar metadados de branding em `utils/loginBranding.ts`, renderizar a marca em `components/AxsysBrand.tsx`, e manter a tela em `pages/Login.tsx` usando o fluxo de autenticação já existente. O CSS global recebe apenas classes decorativas da tela de login.

**Tech Stack:** React 19, Vite, Tailwind CDN, CSS global, Node test runner.

---

### Task 1: Branding Contract

**Files:**
- Create: `tests/login-branding.test.ts`
- Create: `utils/loginBranding.ts`
- Create: `components/AxsysBrand.tsx`

- [ ] **Step 1: Write the failing test**

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { LOGIN_BRANDING } from '../utils/loginBranding.ts';

test('login branding is drawn inline instead of attached as image assets', () => {
  const loginSource = readFileSync(new URL('../pages/Login.tsx', import.meta.url), 'utf8');

  assert.equal(LOGIN_BRANDING.logoAriaLabel, 'Axsys - Technology, Growth, Design');
  assert.equal(loginSource.includes('<img'), false);
  assert.equal(loginSource.includes('/assets/axsys-logo.png'), false);
  assert.equal(loginSource.includes('/assets/axsys-mark.png'), false);
  assert.equal(loginSource.includes('AxsysFullLogo'), true);
  assert.equal(loginSource.includes('AxsysMarkIcon'), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/login-branding.test.ts`
Expected: FAIL while the login still uses image tags or asset paths for the brand.

- [ ] **Step 3: Add the branding module and inline vector logo**

Create `utils/loginBranding.ts` with the approved copy. Create `components/AxsysBrand.tsx` with `AxsysMarkIcon` and `AxsysFullLogo`, using inline SVG paths, gradients, and HTML text.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/login-branding.test.ts`
Expected: PASS.

### Task 2: Login UI

**Files:**
- Modify: `pages/Login.tsx`
- Modify: `index.css`

- [ ] **Step 1: Replace image-based branding**

Import `AxsysFullLogo` and `AxsysMarkIcon`, remove every `<img>` used for the brand, and render the logo as inline SVG/HTML with accessible labeling.

- [ ] **Step 2: Apply the approved split layout**

Use a dark brand panel on desktop, a light form surface, responsive mobile logo placement, existing inputs, existing submit handler, and a gradient submit button.

- [ ] **Step 3: Add scoped CSS decorations**

Add only login-specific classes for the dark circuit background, logo glow, and subtle form surface grid.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: exit code 0.
