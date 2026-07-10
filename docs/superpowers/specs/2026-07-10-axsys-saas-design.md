# Axsys SaaS — Design funcional, técnico e de segurança

Data: 10 de julho de 2026
Status: aprovado para planejamento
Origem: especificação funcional do Axsys e decisões validadas com o proprietário do produto

## 1. Objetivo

Reconstruir o Axsys como um SaaS multiempresa para fornecedores e prestadores que atendem órgãos públicos. A aplicação deve preservar os fluxos úteis da versão descrita na especificação, corrigir os comportamentos incompletos e substituir a arquitetura insegura baseada em localStorage e coleções JSON por uma aplicação relacional, auditável e testável.

A primeira entrega será executada e validada localmente. Ela usará o mesmo modelo de banco, autenticação, Storage e políticas RLS que poderá ser hospedado posteriormente, evitando uma reescrita para produção.

O objetivo de segurança não é prometer ausência absoluta de falhas. O objetivo verificável é não aceitar vulnerabilidades conhecidas, aplicar defesa em profundidade e demonstrar, por testes automatizados, isolamento de tenant e resistência a RLS bypass, IDOR, XSS, CSRF e manipulação de arquivos.

## 2. Escopo da primeira versão

### 2.1 Incluído

- Login por e-mail e senha.
- Redirecionamento por papel após o login.
- Senha provisória criada pelo administrador, obrigatória troca no primeiro acesso.
- Redefinição de senha pelo administrador e recuperação por e-mail.
- Portal restrito e separado para o Super Admin.
- Empresas, administradores, usuários, módulos e contas bancárias.
- Configuração do perfil e dos dados institucionais.
- Clientes e catálogo de serviços/produtos.
- Propostas, itens, cálculos, status e PDF.
- Contratos, prazos, filtros, anexos e encerramento.
- Receitas, despesas e painel financeiro com dados reais.
- Solicitações de pagamento, rascunho, leitura de nota por IA, formalização e confirmação de pagamento.
- Certidões, versões, validade, histórico e publicação controlada.
- PDFs reais para proposta, solicitação e processo completo.
- Storage privado para todos os arquivos.
- Notificações internas de contratos e certidões.
- Página pública de certidões.
- Auditoria de ações críticas.
- Tema escuro padrão e tema claro opcional.
- Layout responsivo para celular, tablet e desktop.
- Testes de domínio, integração, RLS, segurança e navegador.
- Consistência imediata entre telas, abas e indicadores, sem depender de limpeza manual de cache.

### 2.2 Fora da primeira versão

- Ordens de Fornecimento.
- Assinatura digital ICP-Brasil ou assinatura jurídica de PDFs.
- Importação avançada de XML/NF como recurso independente.
- Página e compartilhamento público de contratos.
- Notificações por WhatsApp ou SMS.
- Migração automática dos dados do sistema legado.

Esses itens serão tratados como ciclos posteriores. Controles simulados correspondentes não aparecerão na interface da primeira versão.

## 3. Decisões aprovadas

1. A aplicação usará Next.js com TypeScript em arquitetura de monólito modular.
2. O ambiente local usará Supabase local via Docker para Auth, PostgreSQL e Storage.
3. Operações sensíveis passarão por uma camada backend/BFF; o navegador não executará operações privilegiadas diretamente.
4. O Super Admin usará o mesmo login, mas será redirecionado automaticamente para um portal separado em /platform.
5. O Super Admin não terá acesso aos dados operacionais das empresas.
6. Usuários empresariais serão redirecionados para o portal operacional em /app.
7. Apenas o Administrador da Empresa gerenciará usuários e permissões. O módulo técnico system_admin será eliminado.
8. O Administrador da Empresa sempre poderá gerenciar usuários e configurações, mas seus módulos operacionais poderão ser limitados.
9. O administrador poderá criar uma senha provisória. Ela expirará, será de uso inicial e obrigará troca imediata.
10. A redefinição por e-mail será real e coexistirá com a redefinição administrativa.
11. A identidade visual fornecida será preservada.
12. O tema escuro será o padrão e haverá alternância para tema claro.
13. A primeira versão incluirá todas as funções ativas selecionadas, integradas antes de ser declarada concluída.

## 4. Perfis e ambientes

### 4.1 Visitante público

Pode acessar login, recuperação de senha e páginas de certidões deliberadamente publicadas. Não recebe acesso anônimo às tabelas privadas nem ao Storage.

### 4.2 Super Admin

Opera exclusivamente o portal /platform. Pode:

- visualizar indicadores da plataforma;
- criar, consultar, atualizar, arquivar e reativar empresas;
- criar o primeiro Administrador da Empresa;
- gerenciar administradores empresariais;
- consultar contas bancárias e dados cadastrais no contexto administrativo;
- consultar auditoria e saúde operacional da plataforma;
- acompanhar uso de armazenamento.

Não pode abrir clientes, propostas, contratos, solicitações, receitas, despesas, certidões privadas ou arquivos operacionais. As políticas do banco não terão uma exceção genérica que conceda ao Super Admin leitura de tabelas de tenant.

### 4.3 Administrador da Empresa

Pertence a exatamente uma empresa ativa. Sempre pode:

- gerenciar usuários da própria empresa;
- definir módulos de usuários subordinados;
- editar dados institucionais;
- consultar as contas bancárias da própria empresa em modo somente leitura;
- editar o próprio perfil.

Também pode operar Administrativo, Financeiro e Certidões conforme os módulos explicitamente concedidos. Não pode transformar a si próprio ou outra pessoa em Super Admin, mover usuários entre empresas ou remover o último administrador ativo.

As contas bancárias são cadastradas, alteradas, definidas como padrão e desativadas somente pelo Super Admin no portal da plataforma. Um usuário com módulo Financeiro pode selecionar, em uma solicitação, uma das contas ativas já cadastradas para sua empresa, mas não pode mudar seus dados.

### 4.4 Usuário comum

Pertence a exatamente uma empresa ativa e acessa somente os módulos concedidos:

- administrative;
- financial;
- certificates.

Pode editar o próprio perfil, mas não seu papel, empresa ou permissões.

## 5. Navegação e rotas funcionais

### 5.1 Área pública

- /login
- /forgot-password
- /reset-password
- /public/certidoes/[identifier]

### 5.2 Portal empresarial

- /app/dashboard
- /app/administrativo/clientes
- /app/administrativo/servicos
- /app/administrativo/propostas
- /app/administrativo/contratos
- /app/financeiro
- /app/financeiro/receitas
- /app/financeiro/despesas
- /app/financeiro/solicitacoes
- /app/certidoes
- /app/usuarios
- /app/configuracoes/perfil
- /app/configuracoes/empresa

### 5.3 Portal da plataforma

- /platform
- /platform/empresas
- /platform/empresas/[companyId]
- /platform/administradores
- /platform/auditoria
- /platform/saude

Cada proteção será aplicada no menu, na rota, no handler do backend, no SQL/RPC e no Storage. Esconder um link nunca será considerado autorização.

## 6. Arquitetura

### 6.1 Componentes

Fluxo principal:

Navegador → Next.js/BFF → Supabase Auth, PostgreSQL/RLS e Storage privado.

Integrações de servidor:

- gerador de PDFs;
- provedor de e-mail;
- Gemini, quando uma chave estiver configurada;
- scanner de arquivos;
- telemetria e auditoria.

O cliente recebe apenas modelos de visualização já autorizados. Segredos, service role, chaves de IA e rotinas privilegiadas permanecem no servidor.

### 6.2 Monólito modular

O projeto será dividido por domínio:

- auth;
- platform;
- companies;
- users;
- administrative;
- proposals;
- contracts;
- finance;
- payment-requests;
- certificates;
- files;
- documents;
- notifications;
- audit.

Cada módulo terá contratos claros para validação, regras de domínio, acesso a dados, handlers de servidor e componentes de interface. Módulos não acessarão tabelas de outros domínios de forma ad hoc; fluxos transversais usarão serviços explícitos e transações.

### 6.3 Acesso ao banco

Requisições empresariais normais usarão a identidade do usuário e continuarão sujeitas à RLS, mesmo quando iniciadas pelo BFF. A service role ficará limitada a serviços internos específicos, como criação administrativa de conta no Auth, e nunca será reutilizada em CRUD comum.

A Data API não será chamada diretamente pelo navegador. Views expostas serão security invoker. Funções privilegiadas ficarão em schema privado, terão search_path fixo e permissão de execução restrita.

### 6.4 Consistência, atualização e cache

O PostgreSQL será a única fonte de verdade para dados de negócio. Sessões, registros empresariais, permissões, totais e estados de fluxo não serão persistidos como cópias autoritativas no localStorage, IndexedDB ou cache do navegador.

- Rotas autenticadas serão renderizadas dinamicamente; handlers de negócio e respostas com dados sensíveis usarão Cache-Control: no-store e não entrarão no Data Cache ou Full Route Cache do framework.
- A primeira versão não usará cache persistente, Service Worker ou modo offline para dados empresariais.
- Recursos estáticos versionados por hash, como JavaScript, CSS e imagens públicas da aplicação, poderão usar cache longo porque a URL muda a cada build.
- Após uma mutação confirmada, a resposta trará o registro persistido e a interface invalidará todas as consultas afetadas, incluindo listas, detalhes, contadores, dashboard e notificações.
- Chaves de consulta sempre incluirão usuário, company_id e filtros. Trocar sessão ou empresa descartará todo estado de consulta anterior.
- Eventos Realtime serão filtrados pela RLS e usados apenas como sinal para buscar novamente o dado autorizado; o cliente não tratará o payload do evento como fonte definitiva.
- Ao recuperar foco, reconectar a rede ou voltar de suspensão, a aplicação buscará novamente os dados visíveis.
- Operações financeiras, permissões, publicação de certidões e demais ações críticas não usarão atualização otimista. A UI aguardará a confirmação transacional do servidor.
- Atualizações comuns poderão usar feedback otimista somente quando houver rollback automático e nenhuma consequência financeira ou de autorização.
- Registros mutáveis terão version ou updated_at. O update enviará a versão conhecida; se outra sessão já tiver alterado o registro, o servidor responderá com conflito 409 e a interface mostrará os dados atuais antes de permitir nova tentativa.
- Rascunhos continuarão salvos no banco, separados por usuário e empresa, e não serão confundidos com cache de leitura.
- Publicação ou revogação de certidão será refletida imediatamente na página pública. A primeira versão usará no-store nessa página e fará o download público atravessar o BFF, que revalida a publicação em cada requisição, para priorizar correção e revogação imediata sobre desempenho.

O critério de experiência é explícito: depois de salvar, arquivar, pagar, publicar, revogar ou alterar uma permissão, a informação correta deve aparecer em todas as telas relacionadas sem o usuário limpar cache, sair da conta ou executar recarga forçada.

## 7. Autenticação e sessão

### 7.1 Login

- E-mail será normalizado e globalmente único, sem diferença entre maiúsculas e minúsculas.
- Senhas serão administradas pelo Supabase Auth, nunca armazenadas em tabelas da aplicação.
- Senhas terão de 12 a 128 caracteres, aceitarão frases com espaços e serão recusadas quando constarem em lista local de senhas comuns ou comprometidas.
- A mensagem de falha será genérica para impedir enumeração de contas.
- Tentativas terão rate limit por IP e conta, atraso progressivo e auditoria.
- A sessão será gerenciada pelo BFF em cookies Secure, HttpOnly e SameSite; tokens não ficarão em localStorage.
- Respostas autenticadas sensíveis usarão Cache-Control: no-store.
- O login redirecionará pelo papel efetivo, não por parâmetro informado pelo navegador.

### 7.2 Senha provisória

O administrador informa uma senha provisória ao criar ou redefinir um usuário. A operação:

1. define a senha via API administrativa executada somente no servidor;
2. grava o sinalizador must_change_password no perfil;
3. define expiração de 24 horas;
4. revoga sessões existentes em uma redefinição;
5. registra o evento na auditoria.

No primeiro login, o usuário é redirecionado exclusivamente para a troca de senha. Nenhuma rota empresarial é liberada antes da conclusão. O administrador nunca consegue consultar a senha atual.

### 7.3 Recuperação por e-mail

- O pedido sempre devolve mensagem neutra.
- O token é único, temporário e invalidado após uso.
- A alteração revoga sessões anteriores.
- O ambiente local usa a caixa de e-mail do Supabase local.

### 7.4 Sessões e ações críticas

- Sem “Lembrar-me”, a sessão expira após oito horas.
- Com “Lembrar-me”, a sessão pode ser renovada por até 30 dias.
- Mudança de e-mail, permissões, conta bancária, arquivamento de empresa e confirmação de pagamento exigem reautenticação recente.
- Desativação do usuário ou da empresa bloqueia novos acessos e revoga sessões.
- MFA será obrigatório para Super Admin antes de qualquer implantação pública.

## 8. Autorização, tenancy e RLS

### 8.1 Fonte de verdade

O tenant e as permissões são derivados da identidade autenticada e da associação ativa no banco. company_id, role, módulos, origem financeira, status protegido e proprietário enviados pelo cliente são ignorados ou rejeitados.

### 8.2 Estrutura

- Usuários empresariais possuem uma associação ativa com exatamente uma empresa.
- Toda tabela de negócio possui company_id NOT NULL.
- Tabelas filhas repetem company_id.
- FKs compostas garantem que filho e pai pertençam ao mesmo tenant.
- Políticas default deny serão criadas separadamente para SELECT, INSERT, UPDATE e DELETE.
- INSERT e UPDATE usarão WITH CHECK para impedir troca de tenant.
- Índices suportarão company_id e predicados das políticas.
- storage.objects também terá RLS; o primeiro segmento do caminho e os metadados serão conferidos contra a associação ativa do usuário.

### 8.3 Regra de aceite de isolamento

Com empresas A e B, um usuário da empresa A não poderá:

- ler ou inferir existência de registros da empresa B;
- criar vínculo com um ID da empresa B;
- editar, arquivar ou excluir registros da empresa B;
- receber eventos Realtime da empresa B;
- solicitar URL assinada para arquivo da empresa B;
- baixar relatório, documento ou anexo da empresa B;
- usar um link manipulado para atravessar o isolamento.

Isso será testado em UI, API, SQL/RPC, Storage, Realtime e documentos.

### 8.4 Super Admin

O Super Admin usa endpoints administrativos específicos. Ele não recebe uma política universal de bypass nas tabelas empresariais. Operações necessárias para criar ou arquivar um tenant são executadas por serviços internos com allowlist de campos e auditoria.

## 9. Proteções contra vulnerabilidades

### 9.1 IDOR

- Todo recurso é buscado por ID e company_id.
- UUID não substitui autorização.
- Downloads e URLs assinadas revalidam o recurso e o tenant.
- Parâmetros de rota nunca concedem contexto de empresa.
- Relações entre entidades usam constraints compostas.

### 9.2 XSS

- Textos são renderizados por componentes com escaping automático.
- Não será permitido dangerouslySetInnerHTML, document.write ou HTML fornecido pelo usuário.
- Templates de PDF usam escaping e dados estruturados.
- URLs aceitas são validadas por esquema e finalidade.
- SVG enviado por usuário não é aceito.
- A aplicação terá CSP restritiva, object-src none, base-uri none, frame-ancestors e connect-src explícitos.
- Arquivos potencialmente ativos são entregues como anexo por uma rota de download dedicada, com Content-Disposition e Content-Type restritivos. Na hospedagem pública, o Storage usará uma origem separada da aplicação.

### 9.3 CSRF e CORS

- POST, PUT, PATCH e DELETE exigem token CSRF e validação de Origin.
- SameSite é defesa adicional, não única.
- Nenhuma alteração de estado ocorre por GET.
- CORS usa origens explícitas e nunca combina credenciais com curinga.

### 9.4 SSRF, XML e IA

- O servidor não buscará URLs arbitrárias para avatar, PDF ou IA.
- O renderer de PDF não terá acesso livre à rede.
- XML será processado com DTD e entidades externas desativados.
- Redirecionamentos, redes privadas, loopback, metadata cloud e endereços link-local serão bloqueados em qualquer fetch remoto indispensável.
- A saída do Gemini será validada por schema e tratada como entrada não confiável.
- Documentos enviados à IA não concedem ferramentas nem acesso a segredos.
- O usuário sempre revisa a extração antes de salvar.

### 9.5 Segredos e dependências

- Segredos ficam apenas em variáveis de servidor.
- Arquivos de ambiente não entram no Git.
- CI executará secret scanning, auditoria de dependências, lint e checagem de tipos.
- Logs nunca incluem senha, JWT, token de reset, arquivo completo, chave, CPF completo ou conta integral.

## 10. Arquivos e Storage

### 10.1 Modelo

Todo arquivo terá metadados em file_objects:

- company_id;
- bucket e object_path;
- nome original normalizado;
- MIME detectado;
- tamanho;
- SHA-256;
- estado de varredura;
- criador e datas.

O conteúdo fica em bucket privado. Caminhos internos usam identificadores aleatórios e tenant. Base64 não será armazenado nas tabelas principais.

### 10.2 Validação

- Contratos: PDF, DOC, DOCX, JPG e PNG; até 20 MiB.
- Notas: PDF, XML, JPG e PNG; até 15 MiB.
- Certidões: PDF, JPG e PNG; até 10 MiB.
- Timbrado, assinatura e avatar: PNG, JPG ou WebP; até 5 MiB.
- Extensão, MIME declarado e magic bytes precisam concordar.
- Imagens são reencodadas.
- Arquivos ficam em quarentena até a varredura.
- Nomes fornecidos pelo usuário nunca formam o caminho real.

Downloads autenticados passam por autorização antes de gerar URL assinada com validade máxima de 60 segundos. Downloads públicos atravessam o BFF e revalidam a publicação antes de transmitir o arquivo, sem expor uma URL persistente do Storage. Quotas por empresa e rate limits evitam abuso de armazenamento.

## 11. Modelo de dados

### 11.1 Identidade e empresas

- profiles: dados públicos internos do usuário e flags de segurança.
- platform_roles: vínculo exclusivo do Super Admin.
- companies: cadastro, estado ativo/arquivado e configurações fiscais.
- company_memberships: usuário, empresa, papel e estado.
- member_modules: módulos concedidos.
- company_bank_accounts: banco, agência, conta, estado e indicador padrão.

### 11.2 Comercial e contratos

- clients: município, UF, segmento, CNPJ e dados necessários ao documento.
- catalog_items: serviço ou produto, segmento, nome e descrição.
- proposals: número, cliente, segmento, emissão, status e total.
- proposal_items: snapshot da descrição, tipo, quantidades, valores e total.
- contracts: cliente, número, objeto, período, valor e encerramento.
- contract_attachments: vínculo com file_objects e histórico.

### 11.3 Financeiro

- payment_requests: rascunho ou solicitação, nota, valor, emissão, cliente, contrato, banco, alíquota congelada e status.
- payment_certificate_checks: snapshot das certidões verificadas na formalização.
- incomes: receitas manuais ou originadas de pagamento.
- expenses: despesas manuais ou imposto originado de pagamento.
- financial_reversals: estornos com motivo, ator e vínculo de origem.
- idempotency_keys: proteção contra repetição de operações críticas.

### 11.4 Certidões e documentos

- certificate_types: seis tipos obrigatórios e tipos adicionais.
- certificates: identidade lógica do tipo dentro da empresa.
- certificate_versions: validade, arquivo, criação e estado de publicação.
- generated_documents: tipo, versão, checksum, arquivo e snapshot de dados.
- public_certificate_settings: publicação, slug, token alternativo, revogação e noindex.

### 11.5 Controle

- notification_reads: leitura por usuário e alerta.
- company_settings_drafts: rascunho isolado por usuário e empresa.
- audit_events: trilha append-only separada por eventos de plataforma e eventos de tenant.
- security_events: tentativas negadas, rate limit e sinais de abuso.

O Super Admin consulta somente eventos de plataforma e sinais de segurança agregados. Eventos operacionais de um tenant permanecem visíveis apenas a administradores autorizados daquela empresa e nunca incluem o conteúdo integral de documentos.

### 11.6 Constraints importantes

- IDs são UUIDs gerados no servidor.
- Dinheiro usa numeric com duas casas decimais e valores não negativos.
- Alíquota aceita valores entre 0 e 100.
- Data final não pode preceder data inicial.
- Número de proposta é sequencial e único por empresa.
- E-mail é único global e case-insensitive.
- O CNPJ normalizado de companies é único globalmente.
- O CNPJ normalizado de clients é único dentro de cada company_id, podendo existir em tenants diferentes.
- Uma empresa não pode ficar sem administrador ativo.
- Uma empresa arquivada não aceita novas operações.
- Recursos financeiros automáticos são imutáveis; correções usam estorno.
- Exclusões com impacto histórico usam archive/cancelamento ou RESTRICT.

## 12. Fluxos funcionais

### 12.1 Criação de empresa

1. Super Admin informa razão social, CNPJ, contato e dados do primeiro administrador.
2. O backend valida unicidade e autorização.
3. Empresa, associação, módulos iniciais e conta de Auth são criados como uma unidade lógica compensável.
4. Qualquer falha desfaz ou compensa integralmente a criação.
5. O primeiro administrador recebe senha provisória e troca obrigatória.
6. A ação entra na auditoria.

### 12.2 Gestão de usuários

O Administrador da Empresa pode criar, editar, suspender e redefinir acesso de usuários da própria empresa. Pode conceder somente os três módulos operacionais. Não pode alterar o próprio papel, remover o último administrador ou afetar outro tenant.

### 12.3 Configurações e rascunhos

- Perfil permite nome, e-mail e avatar validado.
- Dados institucionais incluem endereço estruturado, representante, alíquota, timbrado e assinatura.
- O endereço consolidado é recalculado no servidor sem separadores vazios.
- Alterações institucionais não salvas formam um rascunho isolado por usuário e empresa e sobrevivem à navegação.
- Ao salvar com sucesso, o rascunho correspondente é removido.
- Contas bancárias aparecem em modo somente leitura e apontam o contato com o Super Admin para alterações.

### 12.4 Clientes e catálogo

- Clientes oferecem criar, listar, buscar, editar, arquivar e consultar detalhes agregados.
- A exclusão é bloqueada quando existem propostas, contratos ou pagamentos vinculados.
- Itens de catálogo representam serviço ou produto.
- Um item usado em proposta não é apagado; pode ser arquivado.

### 12.5 Propostas

- Número único e sequencial por empresa.
- Segmento filtra cliente e catálogo.
- Serviço: meses multiplicados pelo valor mensal.
- Produto: quantidade multiplicada pelo valor unitário.
- O total é calculado no servidor e confirmado no banco.
- Estados: draft, sent, approved e rejected.
- O PDF usa snapshot da proposta, timbrado, assinatura e dados da empresa.
- Itens emitidos preservam texto e valores mesmo após alteração do catálogo.
- Aprovar uma proposta não cria contrato automaticamente na primeira versão.

### 12.6 Contratos

- Campos essenciais são obrigatórios e datas são coerentes.
- Status é derivado: encerrado, vencido, a vencer ou ativo.
- Progresso considera o intervalo de vigência.
- Anexos são versionados.
- O contrato pode iniciar um rascunho de solicitação e filtrar pagamentos existentes.
- Contratos com pagamentos não podem ser apagados.
- Encerramento é explícito e auditado.

### 12.7 Solicitações de pagamento

- Rascunho é salvo no servidor e isolado por usuário e empresa.
- Cliente, número da nota, valor, emissão e descrição são obrigatórios.
- Contrato é opcional, mas precisa pertencer ao mesmo cliente e tenant.
- Nota pode ser enviada ao Gemini pelo backend; falha mantém o preenchimento manual disponível.
- Estados: draft → pending → formalized → paid.
- Cancelamento é permitido antes do pagamento.
- Correção após pagamento usa estorno, nunca exclusão.

Na formalização, o servidor verifica as seis certidões obrigatórias. Uma exceção somente pode ser autorizada por um Administrador da Empresa que também possua o módulo Financeiro; exige reautenticação recente, justificativa obrigatória e snapshot das pendências no documento e na auditoria.

Ao confirmar pagamento, uma única transação:

1. bloqueia a solicitação para concorrência;
2. valida que ainda está formalizada;
3. marca como paga;
4. cria exatamente uma receita;
5. calcula imposto com a alíquota congelada;
6. cria exatamente uma despesa de imposto pendente quando aplicável;
7. persiste chave de idempotência e auditoria.

### 12.8 Financeiro

- Entradas totais somam receitas ativas.
- Saídas totais somam somente despesas pagas.
- Saldo é entradas menos saídas pagas.
- Gráficos usam dados reais e período selecionável.
- Receitas e despesas manuais oferecem CRUD com autorização.
- Lançamentos automáticos não são editáveis ou apagáveis diretamente.

### 12.9 Certidões

- Cada upload cria uma nova versão.
- A validade inclui o dia final até 23:59:59.999 na zona definida pela empresa.
- Para cada tipo, a versão atual é a válida mais recente segundo a regra operacional.
- Histórico permanece preservado.
- Somente versões marcadas explicitamente como públicas aparecem na página pública.
- A primeira versão pública mostrará apenas certidões vigentes; histórico é privado.
- Publicação e revogação são auditadas.
- O identificador alternativo público é aleatório, armazenado como hash e pode ser rotacionado.

### 12.10 Notificações

- Contratos alertam com até 45 dias para vencer.
- Certidões alertam com até 5 dias.
- Itens vencidos são críticos.
- Contratos encerrados não alertam.
- Leitura é persistida por usuário no banco.
- Links de alerta respeitam os módulos concedidos.

## 13. Documentos e PDFs

PDFs serão gerados no servidor, não por window.print. O renderer não buscará recursos arbitrários na rede. Imagens e anexos serão lidos de Storage autorizado.

Documentos incluídos:

- proposta comercial;
- solicitação de pagamento isolada;
- processo completo com carta, nota e certidões.

Cada emissão salva:

- tipo e versão do template;
- snapshot dos dados usados;
- checksum;
- arquivo final;
- autor e data.

Ausência de anexo gera indicação explícita no processo, sem quebrar o documento. PDFs emitidos são imutáveis; uma nova geração cria outra versão.

## 14. Página pública de certidões

- Resolve empresa por slug estável ou identificador alternativo aleatório.
- Não consulta diretamente tabelas privadas pelo cliente.
- Mostra somente razão social, código público e versões vigentes publicadas.
- O histórico permanece privado na primeira versão.
- Download é autorizado pelo estado de publicação e usa URL temporária.
- Link pode ser revogado e o identificador alternativo pode ser rotacionado.
- A página usa noindex por padrão.
- Tentativas e downloads ficam sujeitos a rate limit e telemetria sem expor dados pessoais desnecessários.

## 15. Interface e design system

### 15.1 Identidade

O símbolo e a palavra Axsys fornecidos pelo proprietário serão preservados. Serão preparadas variantes compacta, horizontal e monocromática adequadas a fundos claros e escuros.

### 15.2 Temas

- Tema escuro é o padrão.
- Tema claro pode ser escolhido no perfil.
- A preferência é salva por usuário.
- No primeiro acesso sem preferência, o tema escuro é aplicado conforme a decisão aprovada.
- Grafite e azul-marinho formam a base.
- Azul e ciano são cores principais.
- Violeta e laranja aparecem em destaques controlados.
- Estados usam texto, ícone e cor, nunca somente cor.

### 15.3 Responsividade

- Móvel: abaixo de 640 px.
- Tablet: de 640 a 1023 px.
- Desktop: 1024 px ou mais.
- Desktop usa sidebar permanente.
- Tablet usa sidebar recolhível.
- Celular usa drawer com overlay.
- Tabelas operacionais viram cards quando a leitura horizontal prejudicar a tarefa.
- Filtros móveis abrem em painel dedicado e exibem chips ativos.
- Formulários longos usam seções e rodapé de ações fixo.
- Modais pequenos no desktop viram tela cheia ou sheet no celular.
- Alvos de toque têm no mínimo 44 px.

### 15.4 Acessibilidade

- Contraste WCAG AA.
- Navegação completa por teclado.
- Foco visível e preso em dialogs.
- Escape fecha overlays quando seguro.
- O foco retorna ao acionador.
- Labels, descrições e erros são associados aos campos.
- Conteúdo dinâmico relevante usa regiões anunciáveis.

### 15.5 Estados de tela

Toda tela define carregando, vazio, sem resultado, sucesso, erro, acesso negado e indisponibilidade temporária. Uploads também definem seleção, validação, progresso, quarentena, falha e nova tentativa.

## 16. Tratamento de erros e observabilidade

- APIs retornam envelopes de erro consistentes com código estável e correlation ID.
- Mensagens para usuário não expõem SQL, stack trace, segredo ou existência de recurso não autorizado.
- Falhas transacionais revertem todos os efeitos.
- Operações idempotentes podem ser repetidas com segurança.
- E-mail, PDF, IA e scanner têm tentativas controladas e estados visíveis.
- Falha da IA nunca bloqueia o preenchimento manual.
- A aplicação diferencia validação, conflito, acesso negado, recurso inexistente e indisponibilidade.
- Um conflito de versão nunca sobrescreve silenciosamente os dados; a interface preserva a edição local, apresenta a versão atual do servidor e permite comparar antes de tentar novamente.
- Logs estruturados redigem dados pessoais e segredos.
- Auditoria append-only registra ações críticas, ator, tenant, recurso, resultado, motivo, horário UTC e correlation ID.

Eventos auditados incluem login, falha, logout, reset, troca de senha, criação/suspensão de usuário, mudança de módulos, empresa, bancos, financeiro, formalização, exceção de certidões, pagamento, estorno, upload, download, publicação, revogação e geração de documento.

## 17. Proteção de dados e preparação para produção

- Dados reais de clientes não serão copiados para seeds ou testes locais.
- CPF de representante e dados de conta bancária serão mascarados na interface e nos logs e criptografados em nível de aplicação com chave exclusiva do servidor.
- Assinaturas, documentos fiscais e certidões permanecem em buckets privados e nunca entram em telemetria.
- A hospedagem pública exigirá TLS, backups criptografados, teste periódico de restauração e rotação de segredos.
- O acesso a backups, auditoria e chaves será separado do acesso operacional comum.
- Antes da primeira implantação pública, será obrigatório aprovar política de privacidade, retenção por categoria, descarte, resposta a incidentes e relação de subprocessadores. A implantação ficará bloqueada enquanto esse gate de governança não estiver concluído.
- A publicação também exigirá SAST, DAST, secret scanning, análise de dependências e teste de intrusão independente dos fluxos de autenticação, tenancy e arquivos.

## 18. Ambiente local

O ambiente será iniciado por comandos documentados e conterá:

- aplicação Next.js;
- Supabase local com PostgreSQL, Auth e Storage;
- migrations versionadas;
- caixa de e-mail local;
- scanner local de arquivos;
- seeds de desenvolvimento;
- suíte de testes.

O seed não terá senha embutida no repositório. O primeiro Super Admin será criado por comando de bootstrap que exige credencial fornecida por variável local. Arquivos de ambiente terão exemplo sem segredos.

Quando o produto for hospedado, as mesmas migrations, políticas, buckets e testes serão aplicados ao projeto remoto antes da liberação.

## 19. Estratégia de testes

### 19.1 Unitários

- cálculos de proposta;
- imposto e arredondamento;
- status e progresso de contrato;
- validade e seleção de certidões;
- matriz de permissões;
- estados de pagamento;
- formatação de documentos.

### 19.2 Integração

- handlers e validação;
- transações de empresa e pagamento;
- constraints e FKs compostas;
- uploads, quarentena e downloads;
- geração e versionamento de PDFs;
- recuperação de senha e expiração da senha provisória.
- invalidação de listas, detalhes, contadores e dashboards após cada mutação;
- detecção de conflito 409 em duas atualizações concorrentes;
- troca de usuário ou tenant sem reaproveitar estado da sessão anterior;
- reconexão e eventos Realtime seguidos de nova leitura autorizada.

### 19.3 RLS e segurança

- duas empresas e todos os perfis;
- SELECT, INSERT, UPDATE e DELETE por tabela;
- troca maliciosa de company_id;
- referência cruzada entre tenants;
- URL assinada e caminho de Storage;
- eventos Realtime;
- payloads de IDOR em APIs e relatórios;
- payloads XSS em UI e PDFs;
- CSRF, Origin e CORS;
- rate limit e enumeração de contas;
- tipos de arquivo falsificados, XML com entidade externa e arquivos maliciosos de teste.

### 19.4 E2E e visual

- jornadas completas de Visitante, Super Admin, Administrador da Empresa e Usuário;
- temas escuro e claro;
- celular, tablet e desktop;
- login, troca obrigatória, reset e logout;
- CRUDs, bloqueios de integridade e acesso direto sem módulo;
- proposta até PDF;
- contrato até solicitação;
- formalização, pagamento, receita e imposto;
- publicação e download de certidão.
- atualização entre duas abas sem recarga forçada;
- alteração de permissão refletida imediatamente no menu, rota e API;
- pagamento refletido simultaneamente na solicitação, receita, imposto e dashboard;
- publicação e revogação refletidas imediatamente na página pública.

## 20. Ordem de implementação

1. Repositório, ferramentas, design system e ambiente Supabase local.
2. Autenticação, sessão, senha provisória, reset e tenancy.
3. RLS, Storage base, auditoria e testes cross-tenant.
4. Portal do Super Admin, empresas e administradores.
5. Usuários empresariais, configurações e bancos.
6. Clientes e catálogo.
7. Propostas, itens e PDF.
8. Contratos, anexos e notificações.
9. Certidões, versões e página pública.
10. Financeiro e solicitações.
11. Formalização, pagamento transacional e estornos.
12. Processo completo, integração Gemini configurável, fallback manual e documentos finais.
13. Testes E2E, segurança, responsividade e endurecimento.

A implementação será incremental, mas a primeira versão só será declarada concluída depois da integração e validação de todos os itens incluídos no escopo.

## 21. Critérios de aceite

### 21.1 Segurança

- Sessões e senhas não aparecem no localStorage ou nas tabelas da aplicação.
- O bundle não contém segredos.
- A matriz RLS passa integralmente para dois tenants.
- Manipular IDs não atravessa tenant nem módulo.
- PDFs não executam conteúdo de campos controlados pelo usuário.
- Operações mutáveis rejeitam CSRF e origens inválidas.
- Uploads inválidos não chegam ao bucket operacional.
- Service role não é usada em CRUD empresarial comum.
- Super Admin não acessa tabelas operacionais.
- Dados empresariais autenticados não são servidos por cache compartilhado ou persistente.

### 21.2 Funcional

- Login redireciona corretamente para /platform ou /app.
- Senha provisória obriga troca e reset por e-mail funciona.
- Empresas e usuários respeitam transações e proteção do último administrador.
- Clientes e catálogo oferecem CRUD e bloqueios corretos.
- Propostas calculam os dois tipos de item e geram PDF real.
- Contratos calculam status e progresso, recebem anexos e iniciam solicitações.
- Financeiro usa dados reais e saldo ignora despesas pendentes.
- Formalização verifica as seis certidões.
- Pagamento gera receita e imposto exatamente uma vez.
- Certidões preservam histórico e validade inclusiva.
- Página pública mostra somente versões vigentes publicadas.
- Timbrado, assinatura e conta escolhida aparecem nos documentos.
- Toda mutação atualiza listas, detalhes, totais e indicadores relacionados sem limpar cache ou recarregar manualmente.
- Edições concorrentes são detectadas e não sobrescrevem silenciosamente alterações mais novas.

### 21.3 Experiência

- Todos os fluxos principais funcionam em celular, tablet e desktop.
- Tema escuro é inicial e tema claro persiste por usuário.
- A interface é navegável por teclado e mantém contraste AA.
- Estados de carregamento, vazio, erro e acesso negado são claros.
- Nenhum botão visível promete uma função simulada.

## 22. Resultado esperado

Ao final, o Axsys será um SaaS localmente executável, com backend e frontend integrados, isolamento multiempresa verificável, portal separado para o Super Admin, módulos empresariais completos, arquivos privados, documentos reais, auditoria e base preparada para conexão a um projeto Supabase hospedado sem trocar a arquitetura.
