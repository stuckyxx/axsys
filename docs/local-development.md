# Desenvolvimento local do Axsys

## Pré-requisitos

Node 24.13.0, npm 11.6.2, Docker com pelo menos 7 GiB disponíveis.

Mantenha o Docker em execução durante o uso do Supabase local. O projeto usa as versões fixadas no `package.json` e no lockfile; não substitua `npm ci` por uma atualização de dependências.

## Primeira execução

```bash
npm ci
npm run db:start
npm run db:env
```

`npm run db:env` cria ou atualiza `.env.local` com os valores locais do Supabase e os segredos de aplicação, sem imprimi-los. Preencha somente as variáveis `AXSYS_BOOTSTRAP_SUPER_ADMIN_EMAIL` e `AXSYS_BOOTSTRAP_SUPER_ADMIN_PASSWORD` nesse arquivo. Não copie valores de exemplo, não publique as credenciais e não versione `.env.local`; escolha um e-mail válido e uma senha local exclusiva com pelo menos 12 caracteres, conteúdo visível e no máximo 72 bytes UTF-8.

```bash
npm run bootstrap:local
npm run dev
```

App: http://127.0.0.1:3000

Studio: http://127.0.0.1:54323

Mailpit: http://127.0.0.1:54324

O Mailpit captura apenas os e-mails do ambiente local; nenhuma mensagem é entregue a destinatários reais. O bootstrap cria o acesso inicial de Super Admin exclusivamente na pilha local.

Dados de negócio não usam cache persistente ou compartilhado. As respostas autenticadas e sensíveis são `private, no-store`, e o PostgreSQL permanece como fonte de verdade; não deve ser necessário limpar o cache do navegador para visualizar uma atualização. Somente arquivos estáticos versionados pelo build podem usar cache duradouro.

## Reset e tipos

```bash
npm run db:reset && npm run db:env
npm run db:types
```

O reset recria o banco local e remove os usuários criados anteriormente. Depois dele, confirme as duas variáveis `AXSYS_BOOTSTRAP_*` preservadas em `.env.local` e execute `npm run bootstrap:local` novamente quando precisar do Super Admin local.

## Testes

```bash
npm run test:unit
npm run test:integration
npm run test:rls
npm run test:e2e
npm run test:all
```

O gate adicional abaixo executa o build e valida a aplicação servida por `next start`, incluindo as proteções de produção do navegador:

```bash
npm run test:e2e:production
```

## Regras de migration

Crie arquivos somente com `npx supabase migration new <nome>` e valide com reset, pgTAP, lint e advisors.

```bash
npm run db:reset
npm run test:rls
npm run db:lint
npm run db:advisors
```

Não edite migrations já aplicadas para corrigir o histórico; crie uma nova migration e repita o gate local.

## Gate antes de hospedagem pública

Execute `npm run test:all` e `npm run test:e2e:production` em um ambiente limpo. A hospedagem pública permanece bloqueada até MFA obrigatório para Super Admin, TLS, SMTP real, política de privacidade/retenção/descarte, backup/restauração, rotação de segredos, SAST/DAST, secret scanning, auditoria de dependências e pentest independente.

Credenciais locais de bootstrap, chaves geradas por `db:env` e segredos de teste não são credenciais de produção e nunca devem ser reutilizados ou publicados.
