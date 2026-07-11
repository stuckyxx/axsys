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

test('login branding copy matches the approved first screen', () => {
  assert.equal(LOGIN_BRANDING.title, 'Portal do Usuário');
  assert.equal(LOGIN_BRANDING.subtitle, 'Acesse sua conta para gerenciar seu negócio.');
  assert.equal(LOGIN_BRANDING.tagline, 'Technology | Growth | Design');
  assert.equal(LOGIN_BRANDING.securityLabel, 'Ambiente seguro Axsys');
});
