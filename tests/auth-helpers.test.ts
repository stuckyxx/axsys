import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyPasswordReset,
  buildRegisteredUserRecord,
  getPostLoginPath,
  reconcileStoredSessionUser,
} from '../utils/auth.ts';

test('buildRegisteredUserRecord preserva senha, empresa e módulos informados', () => {
  const user = buildRegisteredUserRecord(
    {
      firstName: 'Maria Souza',
      email: 'maria@empresa.com',
      password: 'segredo123',
      role: 'USER',
      companyId: 'comp-001',
      allowedModules: ['administrative', 'financial'],
    },
    'u-test-1',
  );

  assert.equal(user.id, 'u-test-1');
  assert.equal(user.name, 'Maria Souza');
  assert.equal(user.email, 'maria@empresa.com');
  assert.equal(user.password, 'segredo123');
  assert.equal(user.companyId, 'comp-001');
  assert.deepEqual(user.allowedModules, ['administrative', 'financial']);
});

test('applyPasswordReset atualiza somente o usuário alvo', () => {
  const users = [
    buildRegisteredUserRecord(
      {
        firstName: 'Maria Souza',
        email: 'maria@empresa.com',
        password: 'segredo123',
        role: 'USER',
        companyId: 'comp-001',
        allowedModules: ['administrative'],
      },
      'u-1',
    ),
    buildRegisteredUserRecord(
      {
        firstName: 'Pedro Lima',
        email: 'pedro@empresa.com',
        password: 'inicial456',
        role: 'USER',
        companyId: 'comp-001',
        allowedModules: ['administrative'],
      },
      'u-2',
    ),
  ];

  const updatedUsers = applyPasswordReset(users, 'u-2', 'novaSenha789');

  assert.equal(updatedUsers[0].password, 'segredo123');
  assert.equal(updatedUsers[1].password, 'novaSenha789');
});

test('getPostLoginPath direciona super admin para painel global e demais para dashboard', () => {
  assert.equal(getPostLoginPath('SUPER_ADMIN'), '/super-admin');
  assert.equal(getPostLoginPath('COMPANY_ADMIN'), '/dashboard');
  assert.equal(getPostLoginPath('USER'), '/dashboard');
});

test('reconcileStoredSessionUser atualiza companyId e módulos com base no usuário mais recente da base', () => {
  const storedUser = buildRegisteredUserRecord(
    {
      firstName: 'Pedro Guilherme',
      email: 'pguilhermecont@gmail.com',
      password: 'segredo123',
      role: 'USER',
      allowedModules: [],
    },
    'u-pedro',
  );

  const freshUser = buildRegisteredUserRecord(
    {
      firstName: 'Pedro Guilherme',
      email: 'pguilhermecont@gmail.com',
      password: 'segredo123',
      role: 'USER',
      companyId: 'comp-001',
      allowedModules: ['certificates'],
    },
    'u-pedro',
  );

  const reconciled = reconcileStoredSessionUser(storedUser, [freshUser]);

  assert.equal(reconciled?.companyId, 'comp-001');
  assert.deepEqual(reconciled?.allowedModules, ['certificates']);
});

test('reconcileStoredSessionUser retorna null quando o usuário salvo não existe mais na base', () => {
  const storedUser = buildRegisteredUserRecord(
    {
      firstName: 'Pedro Guilherme',
      email: 'pguilhermecont@gmail.com',
      password: 'segredo123',
      role: 'USER',
      companyId: 'comp-001',
      allowedModules: ['certificates'],
    },
    'u-pedro',
  );

  const reconciled = reconcileStoredSessionUser(storedUser, []);

  assert.equal(reconciled, null);
});
