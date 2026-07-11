# Especificacao funcional completa do Axsys

## 1. Objetivo e escopo

Este documento descreve o comportamento encontrado no codigo-fonte atual do Axsys para permitir a reconstrucao do produto em outra tecnologia, como PHP, Node.js ou outra stack web. O levantamento cobre:

- arquitetura atual;
- rotas e paginas;
- perfis, modulos e permissoes;
- navegacao global;
- formularios, campos, botoes, links, filtros e modais;
- operacoes de criar, consultar, editar, excluir, anexar, baixar, imprimir e compartilhar;
- regras de negocio, calculos, status e validacoes;
- entidades e campos de dados;
- persistencia local, sincronizacao remota e isolamento por empresa;
- integracoes externas;
- relatorios e documentos gerados;
- componentes existentes mas nao utilizados;
- simulacoes, limitacoes, inconsistencias e funcoes incompletas do sistema atual;
- requisitos minimos para uma reimplementacao fiel.

O inventario considera o estado presente da arvore de trabalho em 9 de julho de 2026. Uma funcao marcada como **ativa** esta ligada a uma rota ou componente renderizado. Uma funcao marcada como **dormente** existe no codigo, mas nao esta acessivel pelo fluxo atual. Uma funcao marcada como **incompleta** aparece na interface, mas nao entrega integralmente o comportamento indicado pelo texto do controle.

## 2. Visao geral do produto

O Axsys e um ERP web multiempresa voltado a prestadores de servicos que atendem orgaos publicos. O produto concentra cinco areas funcionais:

1. gestao global de empresas, contas bancarias, usuarios e permissoes;
2. modulo administrativo com clientes, servicos, propostas e contratos;
3. modulo financeiro com receitas, despesas e solicitacoes de pagamento;
4. gestao de certidoes fiscais, trabalhistas e de regularidade;
5. configuracoes de perfil e dados institucionais usados em documentos.

Os vinculos centrais sao:

- uma empresa possui usuarios e contas bancarias;
- um usuario pertence opcionalmente a uma empresa e recebe modulos de acesso;
- clientes e servicos alimentam propostas;
- clientes alimentam contratos;
- contratos podem originar solicitacoes de pagamento;
- solicitacoes de pagamento consultam certidoes antes da formalizacao;
- uma solicitacao marcada como paga gera receita e pode gerar despesa de imposto;
- dados, timbrado, assinatura e conta bancaria da empresa alimentam propostas e solicitacoes impressas;
- certidoes vigentes podem ser disponibilizadas em uma pagina publica.

## 3. Arquitetura existente

### 3.1 Stack

- Frontend: React 19 com TypeScript.
- Build e desenvolvimento: Vite 6.
- Roteamento: React Router 7 com `HashRouter`.
- Estilos: classes utilitarias presentes diretamente no JSX e CSS global.
- Persistencia primaria percebida pela interface: `localStorage`.
- Persistencia remota e sincronizacao: Supabase, tabela generica `app_state` e Realtime.
- Leitura de nota fiscal por IA: Google Gemini via `@google/genai`.
- Hospedagem configurada: Vercel, projeto `axys`.
- Testes: `node:test` sobre funcoes de dominio e persistencia.

### 3.2 Inicializacao

1. `App` chama `initializeRemotePersistence()` antes de montar a autenticacao.
2. Enquanto a inicializacao remota nao termina, a tela mostra um indicador de carregamento.
3. Sem usuario autenticado, somente as colecoes globais de usuarios e empresas sao carregadas.
4. Depois do login, a persistencia e reinicializada com o escopo da empresa do usuario.
5. A sessao e lida de `sgi_user_v2` no `localStorage`.
6. O usuario salvo e reconciliado com a base atual de usuarios; se tiver sido excluido, a sessao e encerrada.
7. Alteracoes remotas na tabela `app_state` sao recebidas por Supabase Realtime e espelhadas no navegador.

### 3.3 Dados criados no primeiro uso

Quando as colecoes globais ainda nao existem, o frontend cria:

- uma empresa demonstrativa `comp-001`, com endereco de exemplo, uma conta do Banco do Brasil, representante generico e aliquota de 5%;
- dois usuarios `SUPER_ADMIN`, sem `companyId`, com os quatro modulos liberados e avatares externos;
- senhas iniciais embutidas no codigo-fonte e armazenadas em texto puro.

As credenciais demonstrativas nao devem ser copiadas para uma nova implementacao. O comportamento equivalente seguro e um comando de instalacao que crie o primeiro administrador com senha fornecida fora do codigo.

### 3.4 Ausencias arquiteturais importantes

- Nao existe backend proprio no repositorio.
- Nao existem controllers, APIs REST, GraphQL, filas ou jobs do Axsys.
- Nao existem migrations SQL nem definicao versionada da tabela `app_state`.
- Nao existe autenticacao Supabase integrada aos usuarios do Axsys.
- Nao existe emissao ou validacao de JWT.
- Nao existe armazenamento dedicado de arquivos; anexos sao convertidos para Base64.
- A dependencia `localforage` esta instalada, mas nao e utilizada pelo codigo.

## 4. Perfis, modulos e controle de acesso

### 4.1 Perfis

| Perfil | Codigo | Finalidade atual |
|---|---|---|
| Super administrador | `SUPER_ADMIN` | Acessa a gestao global de empresas e pode operar modulos liberados em `allowedModules`. |
| Administrador da empresa | `COMPANY_ADMIN` | Gerencia usuarios da propria empresa e pode operar modulos liberados. |
| Usuario comum | `USER` | Opera os modulos presentes em `allowedModules`. |

### 4.2 Modulos liberaveis

| Modulo | Codigo | Conteudo |
|---|---|---|
| Administrativo | `administrative` | Cadastros, propostas e contratos. |
| Financeiro | `financial` | Painel financeiro, receitas, despesas e solicitacoes de pagamento. |
| Certidoes | `certificates` | Cadastro, historico, download e compartilhamento de certidoes. |
| Administracao do sistema | `system_admin` | Link para gestao de usuarios da empresa. |

### 4.3 Comportamento efetivo das permissoes

- O menu lateral e os cards do painel escondem modulos ausentes de `allowedModules`.
- `hasAccess` apenas verifica se o modulo esta no array `allowedModules`; o perfil por si so nao libera todos os modulos.
- A rota de gestao de usuarios aceita `COMPANY_ADMIN` e `SUPER_ADMIN` mesmo sem o modulo `system_admin`.
- A rota de cadastro de usuario aplica a mesma regra por perfil.
- As rotas `/administrative`, `/finance`, `/certificates` e `/settings` exigem apenas autenticacao. Um usuario sem o modulo pode abrir a URL diretamente.
- A restricao atual e, portanto, parcialmente visual. Uma reimplementacao deve aplicar autorizacao tambem no servidor e em cada endpoint.
- Em Configuracoes, podem editar dados da empresa: `SUPER_ADMIN`, `COMPANY_ADMIN` ou qualquer usuario com modulo administrativo.
- Um usuario com modulo financeiro, mesmo sem administrativo, pode visualizar os dados da empresa em modo somente leitura.
- Apenas `SUPER_ADMIN` pode acessar `/super-admin`.

## 5. Rotas e paginas

| Rota | Pagina | Protecao atual | Situacao |
|---|---|---|---|
| `#/login` | Login | Publica; usuario autenticado e redirecionado | Ativa |
| `#/dashboard` | Painel Principal | Qualquer usuario autenticado | Ativa |
| `#/admin/permissions` | Gestao de Usuarios | `COMPANY_ADMIN` ou `SUPER_ADMIN` | Ativa |
| `#/admin/create-user` | Cadastro de Usuario | `COMPANY_ADMIN` ou `SUPER_ADMIN` | Ativa, escondida do menu direto |
| `#/super-admin` | Gestao de Empresas | Somente `SUPER_ADMIN` | Ativa |
| `#/administrative` | Modulo Administrativo | Qualquer usuario autenticado | Ativa |
| `#/finance` | Modulo Financeiro | Qualquer usuario autenticado | Ativa |
| `#/certificates` | Certidoes | Qualquer usuario autenticado | Ativa |
| `#/public/certidoes/:identifier` | Certidoes Publicas | Publica | Ativa |
| `#/settings` | Configuracoes | Qualquer usuario autenticado | Ativa |
| qualquer outra | Redirecionamento | Redireciona para `/dashboard` | Ativa |

Paginas compostas dentro de outras telas:

- `Proposals` e renderizada na aba Propostas do modulo Administrativo.
- `Contracts` e renderizada na aba Contratos do modulo Administrativo.
- `Registrations` e renderizada na aba Cadastros do modulo Administrativo.
- `PaymentProcessManager` e renderizado na aba Solicitacoes de Pagamento do modulo Financeiro.

Pagina sem rota:

- `Orders`, intitulada Ordens de Fornecimento, existe no codigo, mas nao e importada pelo roteador nem por outra pagina.

## 6. Navegacao global e comportamento comum

### 6.1 Menu lateral

Controles ativos:

- **Painel Principal**: abre `/dashboard`.
- **Gestao de Empresas**: aparece somente para `SUPER_ADMIN` e abre `/super-admin`.
- **Gestao Geral**: aparece com modulo administrativo e abre `/administrative`.
- **Controle Financeiro**: aparece com modulo financeiro e abre `/finance`.
- **Certidoes**: aparece com modulo de certidoes e abre `/certificates`.
- **Gestao de Usuarios**: aparece com modulo `system_admin`, exceto para `SUPER_ADMIN`, e abre `/admin/permissions`.
- bloco com avatar, nome e perfil: abre `/settings`.
- **Sair**: remove a sessao local, encerra o escopo Realtime e volta ao fluxo publico.
- no celular, o botao de menu abre a barra lateral e o fundo escurecido fecha a barra ao ser clicado.

### 6.2 Cabecalho

- No desktop, mostra sino de notificacoes e bloco da sessao com nome e avatar.
- O bloco da sessao abre Configuracoes.
- No celular, mostra marca, sino e botao para abrir o menu.

### 6.3 Sino de notificacoes

- Abre e fecha um painel flutuante.
- Fecha ao clicar fora ou pressionar `Escape`.
- Ao abrir, marca todos os alertas atuais como vistos no dia.
- O contador mostra no maximo `9+`.
- O estado de leitura e separado por usuario e por data local.
- Um alerta de contrato abre o modulo Administrativo e grava a aba `contracts` como ativa.
- Um alerta de certidao abre `/certificates`.
- Sem permissao visual para o modulo, o alerta permanece informativo e nao vira link.
- Contratos entram em alerta com 45 dias ou menos para vencer.
- Certidoes entram em alerta com 5 dias ou menos para vencer.
- Itens vencidos sao criticos; itens ainda no prazo sao avisos.
- Contratos encerrados nao geram alertas.
- Para cada tipo de certidao, apenas a versao operacional relevante participa do alerta.

## 7. Pagina de Login

### 7.1 Campos

- **E-mail corporativo**: tipo e-mail, obrigatorio.
- **Senha**: tipo senha, obrigatorio.
- **Lembrar-me**: checkbox visual.

### 7.2 Botoes e acoes

- **Entrar no Sistema**: valida senha com pelo menos 3 caracteres, procura o e-mail sem diferenciar maiusculas e minusculas e compara a senha.
- **Esqueceu a senha?**: controle visivel sem manipulador de clique; nao abre recuperacao.
- **Lembrar-me**: nao altera a duracao da sessao; a sessao ja e sempre persistida no `localStorage`.

### 7.3 Resultado do login

- `SUPER_ADMIN` e enviado para `/super-admin`.
- Demais perfis sao enviados para `/dashboard`.
- E-mail inexistente mostra "Credenciais invalidas. Usuario nao encontrado."
- Senha incorreta mostra "Credenciais invalidas. Senha incorreta."
- Senha com menos de 3 caracteres e bloqueada antes da consulta.
- O botao exibe estado de carregamento durante a tentativa.

### 7.4 Identidade visual

- Layout dividido no desktop e compacto no celular.
- Marca Axsys desenhada no proprio codigo.
- Textos de seguranca e conexao sao definidos em `utils/loginBranding.ts`.

## 8. Painel Principal

### 8.1 Conteudo

- Titulo "Painel Principal".
- Saudacao personalizada com o nome do usuario.
- Cards dos modulos liberados.

### 8.2 Cards e botoes

- Card **Financeiro** com botao **Acessar** para `/finance`.
- Card **Administrativo** com botao **Acessar** para `/administrative`.
- Card **Certidoes** com botao **Acessar** para `/certificates`.
- Se nenhum dos tres modulos estiver liberado, mostra orientacao para contatar o administrador.

Nao ha indicadores de negocio reais no painel principal. Os alertas ficam apenas no sino global.

## 9. Modulo Administrativo

### 9.1 Abas principais

- **Cadastros**.
- **Propostas & Orcamentos**.
- **Contratos**.

A aba selecionada e salva em `adminActiveTab`. Valores invalidos retornam para `registrations`. A antiga aba de pagamentos nao e mais aceita nesse modulo.

## 10. Cadastros

### 10.1 Subaba Clientes

#### Listagem

Exibe:

- municipio;
- segmento;
- CNPJ;
- acoes.

No desktop usa tabela. No celular usa cards. Quando vazia, mostra "Nenhum cliente cadastrado".

#### Criar cliente

Botao **+ Novo Cliente** abre o formulario com:

- **Municipio**;
- **Segmento**: `Prefeitura` ou `Camara`;
- **CNPJ**.

Botoes:

- **Cancelar**: fecha e limpa o formulario;
- **Salvar**: cria o cliente quando municipio e CNPJ estiverem preenchidos.

O identificador e gerado com `Math.random().toString()`.

#### Editar cliente

- Botao **Editar** carrega municipio, segmento e CNPJ no mesmo formulario.
- **Salvar** substitui o registro de mesmo identificador.
- O campo tecnico `used`, se existente, e preservado.

#### Excluir cliente

- Botao **Excluir** remove imediatamente, sem modal de confirmacao.
- A exclusao e bloqueada se o cliente estiver ligado a qualquer contrato, proposta ou solicitacao de pagamento.
- A mensagem informa que o cliente esta vinculado a propostas ou contratos, embora a verificacao tambem considere solicitacoes de pagamento.

#### Ver detalhes

Botao **Ver Detalhes** ou **Ver detalhes** abre uma visao dedicada do cliente com:

- cabecalho contendo municipio, CNPJ e segmento;
- botao de seta para voltar;
- card de contratos vinculados, com numero, valor e objeto;
- card de propostas vinculadas, com numero, status e valor;
- card de solicitacoes de pagamento, com nota, status, descricao e valor;
- contagem de registros em cada grupo;
- estados vazios separados por grupo.

Nao ha edicao dentro da visao de detalhes.

### 10.2 Subaba Servicos

#### Listagem

Exibe:

- nome do servico;
- segmento;
- descricao do objeto;
- acoes.

No desktop usa tabela. No celular usa cards.

#### Criar servico

Botao **+ Novo Servico** abre:

- **Nome do Servico**;
- **Segmento**: `Prefeitura` ou `Camara`;
- **Descricao do Objeto**.

Botoes:

- **Cancelar**: fecha e limpa;
- **Salvar**: cria somente quando nome e descricao estiverem preenchidos.

#### Editar servico

- **Editar** carrega os campos no formulario.
- **Salvar** substitui o registro.
- O campo tecnico `used`, se existente, e preservado.

#### Excluir servico

- **Excluir** remove sem confirmacao quando nao houver uso.
- A exclusao e bloqueada se alguma proposta possuir item com o `serviceId` correspondente.
- Contratos nao guardam `serviceId`; por isso nao participam diretamente dessa verificacao.

## 11. Propostas e Orcamentos

### 11.1 Listagem

Cada proposta mostra:

- numero;
- data;
- municipio do cliente;
- segmento;
- status;
- valor total.

Status visiveis:

- `draft` = Rascunho;
- `sent` = Enviada;
- `approved` = Aprovada;
- `rejected` = Rejeitada.

Botoes por proposta:

- **Excluir**: pede confirmacao e remove;
- **Editar**: abre o editor;
- **Gerar PDF**: abre a visualizacao imprimivel.

Botao do cabecalho:

- **+ Nova Proposta**: inicia uma proposta vazia.

### 11.2 Criacao de proposta

Ao criar:

- numero sugerido: `PROP-ANO-NUMERO_ALEATORIO`;
- data: dia atual;
- status: Rascunho;
- segmento: Prefeitura;
- itens: vazio;
- total: zero.

Nao existe garantia de unicidade para o numero sugerido.

### 11.3 Editor da proposta

Controles de cabecalho:

- seta voltar: sai sem salvar;
- **Cancelar**: sai sem salvar;
- **Salvar Proposta**: cria ou atualiza.

Campos da proposta:

- **Segmento**: Prefeitura ou Camara; ao mudar, limpa o cliente;
- **Cliente**: lista apenas clientes do segmento selecionado;
- **Data de Emissao**;
- **Status**: Rascunho, Enviada, Aprovada ou Rejeitada.

Validacao ao salvar:

- cliente e data sao obrigatorios;
- itens nao sao obrigatorios;
- numero nao e editavel na interface;
- uma proposta pode ser salva com valor zero.

### 11.4 Itens da proposta

Tipos:

- rotulo do controle: **Tipo de Item**;
- **Servico (Mensalidade)**;
- **Produto (Quantidade x Valor Unitario)**.

Campos comuns:

- **Servico / Produto**: usa o cadastro de servicos filtrado pelo segmento da proposta;
- **Descricao do Objeto**: preenche automaticamente com a descricao do servico e pode ser alterada.

Campos para servico:

- **Meses de Vigencia**, padrao 12;
- **Valor Mensal (R$)**;
- total do item = meses x valor mensal.

Campos para produto:

- **Quantidade**, padrao 1;
- **Valor Unitario (R$)**;
- total do item = quantidade x valor unitario.

Botoes:

- **Adicionar**: exige um servico/produto selecionado e inclui o item;
- icone de lixeira por item: remove o item.

O total global e recalculado ao adicionar ou remover itens.

### 11.5 Documento da proposta

A visualizacao inclui:

- timbrado da empresa como fundo, quando cadastrado;
- titulo "PROPOSTA DE PRECO";
- destinatario baseado no segmento e municipio;
- tabela com item, descricao, unidade, quantidade, valor unitario/mensal e total;
- valor global;
- prazo de execucao fixo de 12 meses;
- validade fixa de 90 dias;
- cidade do cliente e data da proposta;
- assinatura, razao social, CNPJ e representante da empresa.

Botoes:

- **Fechar**;
- **Imprimir Proposta**.

O sistema usa um `iframe` temporario e chama a impressao do navegador. Nao gera um arquivo PDF em backend. O botao "Gerar PDF" depende do usuario escolher salvar como PDF na caixa de impressao.

Inconsistencia atual: o documento tenta ler `state` do cliente, mas a entidade `Client` nao possui esse campo. O fallback exibido e `MA`.

## 12. Contratos

### 12.1 Listagem e filtros

Cada card mostra:

- cliente/orgao;
- numero do contrato;
- status derivado;
- objeto;
- valor total;
- data inicial e final;
- barra de progresso da vigencia;
- percentual decorrido;
- dias restantes ou informacao de encerramento.

Filtros:

- **Buscar**: pesquisa cliente, numero e objeto;
- **Status**: Todos, Ativo, A vencer, Vencido ou Encerrado;
- **Orgao**: Todos, Prefeitura, Camara ou Empresa.

A classificacao do orgao e inferida pelo texto de `clientName`. Se contiver "prefeitura", vira Prefeitura; se contiver "camara", vira Camara; o restante vira Empresa.

A pagina mostra seis contratos por vez e possui:

- **Anterior**;
- indicador de pagina atual;
- **Proxima**.

### 12.2 Status de contrato

- **Encerrado**: possui `closedAt`.
- **Vencido**: data atual posterior a data final.
- **A vencer**: faltam 30 dias ou menos, incluindo o dia do vencimento.
- **Ativo**: faltam mais de 30 dias.

Progresso:

- 0% antes ou na data inicial;
- 100% na data final, depois dela ou se encerrado manualmente;
- entre as datas, percentual arredondado do tempo transcorrido.

### 12.3 Criar contrato

Botao **+ Novo Contrato** abre modal com:

- **Cliente / Orgao**;
- **Numero do contrato**;
- **Valor total (R$)**;
- **Objeto contratado**;
- **Data inicial**;
- **Data final**.

Ao escolher o cliente, `clientName` e montado como "SEGMENTO Municipal de CIDADE".

Botoes do modal:

- X para fechar;
- **Cancelar**;
- **Criar contrato**.

Nao ha validacao obrigatoria no modal. O sistema permite criar contrato com cliente, numero, objeto ou datas vazios e valor zero.

### 12.4 Editar contrato

- Botao **Editar** abre o mesmo modal com os dados atuais.
- **Salvar alteracoes** mescla os novos campos no contrato.
- Anexo, link publico e `closedAt` sao preservados porque o formulario parte do contrato completo.

### 12.5 Excluir contrato

- Botao **Excluir** pede confirmacao com numero ou cliente.
- A exclusao remove o contrato.
- Nao verifica solicitacoes de pagamento vinculadas e nao executa cascata; solicitacoes podem ficar com `contractId` orfao.

### 12.6 Menu de acoes do contrato

O botao de tres pontos abre um menu, fecha ao clicar fora ou pressionar `Escape`, e oferece:

1. **Ver detalhes**: abre modal com numero, orgao, datas, valor, status, objeto, nome do anexo e codigo do link publico.
2. **Anexar contrato**: abre seletor de arquivo.
3. **Gerar solicitacao de pagamento**: cria um rascunho com cliente, contrato e objeto, seleciona a aba financeira de pagamentos e navega para `/finance`.
4. **Ver pagamentos**: aplica filtro pelo contrato, seleciona a aba financeira de pagamentos e navega para `/finance`.
5. **Ver certidoes**: navega para `/certificates`.
6. **Gerar link publico**: cria `publicShareId`, monta uma URL e copia para a area de transferencia.
7. **Baixar PDF**: baixa o anexo existente usando o nome original.
8. **Encerrar contrato**: pede confirmacao e grava `closedAt`; fica desabilitado depois do encerramento.

O modal **Ver detalhes** possui X no cabecalho e botao **Fechar** no rodape.

### 12.7 Anexo de contrato

Formatos aceitos:

- PDF;
- DOC;
- DOCX;
- JPG;
- JPEG;
- PNG.

O modal mostra o anexo atual, quando existe, e possui:

- campo **Arquivo do contrato**;
- X para fechar;
- **Cancelar**;
- **Salvar anexo**, habilitado apenas com arquivo selecionado.

O arquivo e convertido para Base64 e armazenado dentro do contrato com nome, conteudo, MIME type e data de anexo.

### 12.8 Link publico de contrato

A acao gera uma URL no formato `#/administrative?contractShare=CODIGO`. Essa funcao e **incompleta**:

- `/administrative` continua sendo rota privada;
- nenhum componente le o parametro `contractShare`;
- nao existe pagina publica de contrato;
- o link apenas aponta para a tela administrativa normal.

## 13. Modulo Financeiro

### 13.1 Abas

- **Painel**;
- **Receitas**;
- **Despesas**;
- **Solicitacoes de Pagamento**.

A aba selecionada e persistida em `financeActiveTab`. Valor invalido volta para o Painel.

### 13.2 Painel financeiro

Indicadores:

- **Entradas Totais**: soma de todas as receitas;
- **Saidas Totais**: soma apenas despesas cujo `isPaid` nao seja `false`;
- **Saldo em Caixa**: entradas menos saidas pagas.

Grafico:

- titulo "Fluxo de Caixa (Previsao Semestral)";
- seis barras para Out, Nov, Dez, Jan, Fev e Mar;
- valores fixos e simulados: 40, 60, 45, 80, 55 e 70;
- nao e calculado a partir de receitas ou despesas.

### 13.3 Receitas

#### Listagem

Colunas:

- descricao;
- categoria;
- data;
- origem;
- valor;
- acoes.

Origem:

- `manual` = Manual;
- `payment_request` = Automatico.

#### Criar receita

Botao **+ Nova Receita** abre:

- **Descricao**;
- **Data**;
- **Categoria**: Servicos, Produtos, Investimentos, Reembolsos ou Outros;
- **Valor (R$)**.

O botao de confirmacao usa um icone quando e nova receita. Descricao e valor diferente de zero sao obrigatorios. A data padrao e o dia atual.

#### Editar receita

- **Editar** abre os mesmos campos.
- Botao **Salvar** substitui descricao, valor, data e categoria, preservando identificador, origem e vinculo com solicitacao.

#### Excluir receita

- **Excluir** pede confirmacao e remove.
- Receitas originadas de solicitacao tambem podem ser editadas ou excluidas sem atualizar a solicitacao.

#### Importar XML/NF

Botao **Importar XML/NF** e **simulado**. Ele nao pede arquivo e sempre inclui uma receita fixa:

- descricao: "Recebimento ref. NF #4021 (Importado)";
- valor: R$ 2.500,00;
- categoria: Faturamento;
- origem: solicitacao de pagamento;
- data: dia atual.

### 13.4 Despesas

#### Listagem

Colunas:

- descricao e categoria;
- tipo;
- data;
- status;
- valor;
- acoes.

Tipos:

- `fixed` = Custo Fixo;
- `variable` = Custo Variavel.

Status:

- `isPaid === false` = Pendente;
- qualquer outro valor = Pago.

#### Criar despesa

Botao **+ Nova Despesa** abre:

- **Descricao**;
- **Data**;
- **Tipo de Custo**: Fixo (Recorrente) ou Variavel (Pontual);
- **Valor (R$)**.

Regras:

- descricao e valor diferente de zero sao obrigatorios;
- categoria nova e sempre `Operacional`;
- `isPaid` novo e sempre `true`;
- data padrao e o dia atual.

#### Editar e excluir

- **Editar** abre os mesmos campos; a categoria existente e preservada, mas nao pode ser alterada na tela.
- **Salvar** atualiza o registro.
- **Excluir** pede confirmacao e remove.

#### Marcar como paga

- Despesa pendente mostra **Marcar como Pago**.
- O botao pede confirmacao e muda `isPaid` para `true`.
- Nao existe acao inversa para voltar uma despesa a pendente.

## 14. Solicitacoes de Pagamento

### 14.1 Listagem

Colunas:

- documento base/NFS-e;
- tomador, descricao, contrato e cliente;
- valor;
- validacao/status;
- acoes.

Status exibidos:

- `pending` = Aguardando Formalizacao;
- `formalized` = Formalizacao Feita;
- `paid` = Pago.

O tipo `approved` existe no modelo, mas nenhum fluxo atual o define.

### 14.2 Filtros

- **Filtrar por Contrato**;
- **Filtrar por Entidade**, usando segmentos dos clientes;
- **Filtrar por Cliente**, usando cidades dos clientes;
- **Limpar Filtros**, visivel quando algum filtro esta aplicado.

O filtro de contrato recebido da tela de contratos e salvo em uma chave global. Limpar os filtros altera apenas o estado da tela e nao remove essa chave persistida; depois de remontar a tela, o filtro antigo pode reaparecer.

### 14.3 Nova solicitacao

Botao **Nova Solicitacao** abre modal. Se existir rascunho salvo, o modal abre automaticamente e restaura os campos.

Campos:

- **Cliente (Tomador)**, obrigatorio;
- **Vincular Contrato (Opcional)**, habilitado depois do cliente e filtrado pelos contratos desse cliente;
- **Numero da Nota Fiscal**, obrigatorio;
- **Valor (R$)**, obrigatorio e diferente de vazio;
- **Data de Emissao**, obrigatoria;
- **Objeto / Descricao**, obrigatorio;
- **Anexo da Nota Fiscal (Opcional)**, aceita PDF, XML, JPG e PNG.

Botoes:

- X: fecha, limpa o formulario e apaga o rascunho;
- **Ler Nota Fiscal**: envia o arquivo para o Gemini e tenta preencher os campos;
- **Cancelar**: fecha, limpa e apaga o rascunho;
- **Salvar e Iniciar Processo**: cria a solicitacao quando todos os campos obrigatorios estiverem presentes.

O rascunho e salvo automaticamente enquanto o modal esta aberto.

### 14.4 Leitura de nota fiscal por IA

O Gemini recebe o arquivo em Base64 e extrai:

- numero da NFS-e;
- valor liquido;
- descricao/discriminacao dos servicos;
- data de emissao;
- nome ou razao social do tomador.

Depois da extracao:

- a data e normalizada para `yyyy-mm-dd`;
- o sistema tenta encontrar cliente comparando o nome do tomador com cidade ou segmento;
- numero, valor, descricao, data, arquivo e cliente encontrado preenchem o rascunho;
- erro de leitura exibe alerta e permite preenchimento manual.

O modelo configurado e `gemini-3-flash-preview`.

### 14.5 Dados criados automaticamente

Ao salvar, a solicitacao recebe:

- UUID;
- nome do arquivo ou "Inclusao Manual";
- conteudo Base64 opcional;
- prestador fixo "G N MACHADO EMPREENDIMENTOS";
- tomador montado como "SEGMENTO de CIDADE";
- cliente e contrato opcionais no modelo, embora o cliente seja exigido pela tela;
- codigo de verificacao aleatorio com oito caracteres;
- status `pending`;
- data/hora de criacao.

`providerName` e `verificationCode` nao sao exibidos nem usados por outro fluxo.

### 14.6 Editar solicitacao

Botao **Editar**, indisponivel depois de paga, transforma a linha em formulario com:

- nome do tomador;
- descricao;
- data de emissao;
- contrato opcional;
- valor.

Ao selecionar contrato, o cliente e atualizado. Se o tomador estiver vazio ou for "Tomador nao identificado", o nome e preenchido pelo cliente do contrato.

Botoes:

- **Salvar**;
- **Cancelar**.

Numero da nota, arquivo e status nao podem ser editados nessa linha.

### 14.7 Formalizar processo

Botao **Formalizar Processo**:

1. carrega as certidoes atuais, preferindo a versao remota;
2. verifica as seis certidoes obrigatorias;
3. identifica ausentes e vencidas;
4. sem pendencias, muda status para `formalized` e abre a escolha de relatorio;
5. com pendencias, abre modal de aviso.

Certidoes obrigatorias:

1. Certidao Federal;
2. Certidao Trabalhista;
3. Certificado de Regularidade do FGTS;
4. Certidao Estadual (Debitos);
5. Certidao Estadual (Divida Ativa);
6. Certidao Municipal.

Modal de pendencias:

- lista certidoes ausentes;
- lista certidoes vencidas e suas datas;
- **Cancelar** interrompe;
- **Gerar Mesmo Assim** formaliza mesmo com pendencias.

### 14.8 Relatorio da solicitacao

Depois da formalizacao, o usuario escolhe:

- **Carta, nota fiscal e certidoes**: processo completo;
- **Apenas a solicitacao**: somente a carta;
- **Fechar**: cancela a escolha.

Na visualizacao, ainda e possivel alternar entre:

- **Somente Solicitacao**;
- **Processo Completo**.

Outros botoes:

- **Fechar**;
- **Baixar Somente Solicitacao** ou **Baixar Processo Completo**.

O download abre uma nova janela e chama `window.print()`. Pop-ups precisam estar liberados, e o usuario escolhe salvar em PDF.

### 14.9 Conteudo do processo de pagamento

Pagina 1, solicitacao:

- timbrado da empresa, quando cadastrado;
- logo e dados textuais quando nao ha timbrado;
- razao social e CNPJ;
- destinatario/tomador;
- objeto;
- contrato vinculado, quando houver;
- numero e data da nota;
- valor em reais;
- primeira conta bancaria da empresa;
- cidade/UF e data atual por extenso;
- assinatura;
- endereco, e-mail, representante e CPF no rodape quando nao ha timbrado.

Processo completo acrescenta:

- pagina da nota fiscal, usando `embed` para PDF ou `img` para imagem;
- uma pagina para cada certidao operacional relevante;
- mensagens de indisponibilidade quando um arquivo nao estiver presente.

### 14.10 Informar pagamento

Quando a solicitacao esta formalizada, aparece "Nota Paga?" com:

- **Sim**: marca como paga e gera lancamentos financeiros;
- **Nao**: apenas mostra o alerta "Aguardando pagamento...".

Ao escolher **Sim**:

1. status muda para `paid`;
2. cria receita no valor total da nota, categoria Servicos e origem `payment_request`;
3. le a aliquota padrao da empresa;
4. calcula imposto = valor da nota x aliquota / 100;
5. se o imposto for maior que zero, cria despesa variavel, categoria Impostos e pendente;
6. mostra confirmacao.

Nao existe chave de idempotencia. A interface normalmente esconde o botao apos a mudanca de status, mas o modelo de dados nao impede duplicacao em chamadas concorrentes.

### 14.11 Excluir solicitacao

- **Excluir** pede confirmacao e remove qualquer solicitacao, inclusive paga.
- A exclusao nao remove receita ou despesa de imposto ja geradas.
- Isso pode deixar lancamentos financeiros orfaos.

## 15. Certidoes

### 15.1 Painel e indicadores

Indicadores:

- **Vigentes atuais**: uma versao valida por tipo;
- **Historico**: versoes que nao sao a vigente atual;
- **Vencidas**: todos os registros vencidos;
- **Total salvo**: todas as versoes.

### 15.2 Filtros

Filtro **Exibicao**:

- Vigentes atuais;
- Somente vencidas;
- Historico completo.

Filtro **Tipo de certidao**:

- todos os tipos;
- seis tipos obrigatorios;
- tipos adicionais encontrados nos dados.

A tela informa a quantidade de registros exibidos.

### 15.3 Criar certidao ou nova versao

Botoes que abrem o mesmo modal:

- **+ Adicionar Nova Certidao**;
- **Adicionar agora** no estado vazio;
- **Nova versao** em um card, com tipo preselecionado.

Campos:

- **Tipo de Certidao**;
- **Data de Validade**;
- **Arquivo (PDF/Imagem)**, aceita PDF, JPG, PNG e JPEG.

Botoes:

- X;
- **Cancelar**;
- **Salvar nova certidao**.

Data e arquivo sao obrigatorios. Cada envio recebe novo UUID e `createdAt`; uma nova versao nao sobrescreve a anterior.

### 15.4 Regra de versoes

Para cada nome/tipo:

- os registros sao ordenados por `createdAt`; sem `createdAt`, usa-se a validade;
- a visao atual usa a primeira versao ainda valida;
- se nenhuma estiver valida, a versao mais recente permanece relevante para alertas e formalizacao;
- as demais versoes entram no historico;
- uma certidao e valida ate 23:59:59.999 da data de validade.

### 15.5 Acoes por certidao

- **Baixar**: baixa o Base64 com nome baseado no tipo;
- **Nova versao**: abre o modal com o tipo atual;
- **Excluir registro**: pede confirmacao e remove somente aquela versao.

Nao existe edicao de validade ou substituicao do arquivo de um registro. A operacao equivalente e criar nova versao e, se desejado, excluir a antiga.

### 15.6 Compartilhamento publico

Quando o usuario pertence a uma empresa, a tela mostra:

- URL principal baseada no slug;
- codigo de fallback;
- URL alternativa baseada no `shareId`;
- **Copiar Link Publico**;
- **Abrir Pagina Publica**.

O slug e derivado da razao social, sem acentos, em minusculas e com hifens. Slugs duplicados recebem sufixos `-2`, `-3` e posteriores. O fallback segue `cert-public-ID_DA_EMPRESA`.

## 16. Pagina Publica de Certidoes

### 16.1 Resolucao da empresa

A rota aceita como `identifier`:

- `publicCertificatesSlug`;
- `publicCertificatesShareId`.

Se nenhum corresponder, mostra "Pagina nao encontrada".

### 16.2 Conteudo

- razao social da empresa;
- quantidade de certidoes validas atuais;
- quantidade no historico;
- codigo publico;
- cards das certidoes vigentes;
- estado vazio quando nao existe certidao valida.

Cada card mostra tipo, status, validade e:

- **Baixar certidao**, quando existe arquivo;
- "Arquivo indisponivel", quando nao existe.

Se houver historico:

- **Mostrar historico (N)** exibe as versoes anteriores;
- **Ocultar historico** recolhe a secao.

Essa pagina nao usa o layout autenticado e nao exige login.

## 17. Configuracoes

### 17.1 Aba Meu Perfil

Campos:

- **Nome Completo**;
- **E-mail de Acesso**;
- **URL do Avatar (Opcional)**.

Acoes:

- clicar no icone sobre a foto ou em **Alterar foto** abre upload de imagem;
- upload converte a imagem para Base64 e apenas atualiza o formulario;
- **Salvar Alteracoes** atualiza nome, e-mail e avatar do usuario;
- se for o usuario da sessao, atualiza imediatamente o contexto e o `localStorage`.

Nao ha validacao de formato ou unicidade de e-mail alem do comportamento nativo do campo quando aplicavel.

Essa aba nao possui rascunho. Nome, e-mail ou avatar alterados e ainda nao salvos desaparecem ao desmontar a pagina.

Inconsistencia visual: o subtitulo verifica o perfil inexistente `ADMIN`; por isso os perfis reais tendem a aparecer como "Cliente Corporativo".

### 17.2 Aba Dados da Empresa

Visibilidade:

- edicao para super admin, admin da empresa ou usuario com modulo administrativo;
- somente leitura para usuario com modulo financeiro;
- oculta para quem nao tem nenhuma dessas condicoes.

Campos:

- **Razao Social**;
- **CNPJ**;
- **Rua**;
- **Numero**;
- **Bairro**;
- **CEP**;
- **Municipio**;
- **UF**;
- **Representante Legal**;
- **CPF do Representante**;
- **Timbrado (Imagem)**;
- **Contas Bancarias (Gerenciadas pelo Administrador do Sistema)**, lista somente leitura;
- **Aliquota Padrao de Imposto (%)**;
- **Imagem da Assinatura (PNG com fundo transparente)**.

Acoes:

- **Escolher arquivo** do timbrado;
- **Escolher arquivo** da assinatura;
- **Salvar Dados da Empresa**.

Comportamento do endereco:

- a cada digitacao, o formulario inteiro e salvo como rascunho local por empresa;
- ao sair e voltar, o rascunho e restaurado;
- ao salvar, o endereco consolidado e recalculado com rua, numero, bairro, municipio, UF e CEP;
- apos sucesso, o rascunho e removido.

Formato do endereco consolidado:

`Rua, Numero - Bairro, Municipio - UF, CEP`, omitindo partes vazias sem deixar separadores soltos.

As contas bancarias nao podem ser alteradas nessa pagina; o texto informa que sao gerenciadas pelo administrador do sistema.

## 18. Gestao de Usuarios da Empresa

### 18.1 Escopo da listagem

- `COMPANY_ADMIN` ve usuarios da propria empresa, exceto a si mesmo.
- `SUPER_ADMIN` ve todos os usuarios, inclusive super administradores e a propria conta.
- Usuario comum recebe mensagem de acesso negado se o componente for alcancado.

### 18.2 Card de usuario

Mostra:

- avatar;
- nome;
- e-mail;
- identificador tecnico;
- switches de modulo administrativo, financeiro e certidoes.

O modulo `system_admin` nao aparece nessa tela.

### 18.3 Botoes por usuario

- icone **Editar Dados**: abre nome e e-mail;
- icone **Redefinir Senha**: abre campo de nova senha;
- icone **Excluir Usuario**: abre confirmacao;
- switches: alteram somente o estado local do card;
- **Salvar Permissoes**: persiste os tres modulos exibidos.

### 18.4 Modal Editar Dados

Campos:

- **Nome Completo**;
- **E-mail**.

Botoes:

- **Cancelar**;
- **Salvar Alteracoes**.

### 18.5 Modal Redefinir Senha

- Campo **Nova Senha** e exibido como texto, nao como senha.
- Minimo efetivo de 3 caracteres.
- **Cancelar**;
- **Alterar Senha**.

### 18.6 Modal Excluir Usuario

- **Cancelar**;
- **Sim, Excluir**.

A mensagem afirma que dados associados serao perdidos, mas a exclusao remove somente o registro de usuario. Dados empresariais sao escopados por empresa, nao por usuario.

### 18.7 Novo usuario

Botao **+ Novo Usuario** abre a rota `/admin/create-user`.

Campos:

- **Nome Completo**;
- **E-mail**;
- **Senha Provisoria**;
- switches de Administrativo, Financeiro e Certidoes.

Comportamento:

- modulo administrativo vem selecionado;
- o novo perfil e sempre `USER`;
- o usuario e vinculado a empresa do administrador atual;
- **Cancelar e Sair** volta para a gestao de usuarios;
- **Criar Usuario** exige os tres campos e volta para a gestao apos sucesso.

O placeholder informa minimo de 6 caracteres, mas o codigo exige apenas que a senha nao esteja vazia.

## 19. Gestao de Empresas do Super Admin

### 19.1 Visao Geral

Indicadores:

- total de empresas;
- total de usuarios;
- total de contas bancarias.

Botao **Ver todas as empresas** seleciona a aba Empresas Cadastradas.

### 19.2 Empresas Cadastradas

Cada card mostra:

- razao social;
- CNPJ;
- e-mail;
- quantidade de usuarios vinculados.

Botoes:

- **Nova Empresa**;
- **Gerenciar Empresa**;
- icone de lixeira para excluir.

### 19.3 Criar empresa

Modal com:

- **Nome da Empresa (Razao Social)**;
- **CNPJ**;
- **E-mail de Contato**;
- **Senha do Administrador**.

Botoes:

- **Cancelar**;
- **Salvar Empresa**.

Regras:

- razao social, CNPJ, e-mail e senha sao obrigatorios;
- identificador da empresa e `comp-TIMESTAMP`;
- endereco, representante, CPF, imposto e imagens nascem vazios/zero;
- contas bancarias nascem vazias;
- slug e codigo publico de certidoes sao normalizados automaticamente;
- e criado um `COMPANY_ADMIN` chamado "Admin - RAZAO SOCIAL";
- esse administrador recebe os quatro modulos.

A empresa e salva antes da criacao do administrador. Se o cadastro do usuario falhar, a empresa permanece criada sem rollback e o erro aparece apenas no console.

Na edicao, o objeto reconstruido nao preserva explicitamente o slug publico. A normalizacao gera o slug novamente a partir da razao social, portanto alterar o nome pode mudar a URL publica principal das certidoes. O `shareId` e reconstituido de forma estavel a partir do identificador da empresa.

### 19.4 Excluir empresa

- Pede confirmacao informando que usuarios perderao acesso.
- Remove apenas o registro da empresa.
- Nao remove usuarios vinculados.
- Nao remove colecoes escopadas da empresa.
- Usuarios remanescentes ainda possuem `companyId` e podem autenticar; a integridade precisa ser corrigida numa reimplementacao.

### 19.5 Detalhes da empresa

Botao **Gerenciar Empresa** abre a visao com seta voltar e tres abas:

- **Dados da Empresa**;
- **Usuarios & Permissoes**;
- **Contas Bancarias**.

### 19.6 Dados da Empresa

Mostra:

- razao social;
- CNPJ;
- e-mail;
- representante;
- endereco completo.

Botao **Editar Dados** abre modal com apenas razao social, CNPJ e e-mail. Os demais campos existentes sao preservados, mas nao podem ser alterados nesse modal.

### 19.7 Usuarios & Permissoes

Mostra usuarios vinculados, perfil e modulos.

Botoes:

- **Novo Usuario**;
- **Editar** por usuario;
- icone de lixeira por usuario.

Modal de usuario:

- **Nome Completo**;
- **E-mail**;
- **Senha Provisoria**, somente na criacao;
- **Nivel de Acesso**: Usuario Padrao ou Administrador da Empresa;
- switches dos quatro modulos;
- **Cancelar**;
- **Salvar Usuario**.

Na edicao, nome, e-mail, perfil e modulos sao atualizados. A senha nao pode ser alterada por esse modal.

### 19.8 Contas Bancarias

Cada conta mostra banco, agencia e conta.

Botoes:

- **Adicionar Conta**;
- icone de lixeira para excluir.

Modal:

- **Nome do Banco**;
- **Agencia**;
- **Conta Corrente**;
- **Cancelar**;
- **Salvar Conta**.

Os tres campos sao obrigatorios. O handler suporta atualizar uma conta quando recebe `currentBank.id`, mas a interface nao possui botao de editar nem define esse identificador. Na pratica, a tela oferece apenas criar e excluir.

## 20. Ordens de Fornecimento - pagina dormente

O arquivo `pages/Orders.tsx` implementa uma tela que nao possui rota.

### 20.1 Dados iniciais

Tres documentos estaticos sao carregados em memoria: dois pendentes e um assinado. Nada e salvo em `localStorage` ou Supabase.

### 20.2 Acoes existentes

- **Upload de Arquivos**: aceita selecao multipla e adiciona somente nome, data e status pendente;
- checkbox geral: seleciona todos os pendentes;
- checkbox por linha: seleciona ou remove da selecao; assinados ficam desabilitados;
- **Assinar Selecionados (N)**: espera dois segundos e muda o status local para assinado;
- **Editar**: permite renomear;
- **Salvar** e **Cancelar** durante renomeacao;
- **Excluir**: pede confirmacao e remove da memoria;
- **Baixar** em documentos assinados: aponta para `#`, sem arquivo real.

A assinatura digital e uma simulacao; nao existe backend Python, certificado digital, hash, carimbo de tempo ou PDF assinado.

## 21. Componentes dormentes e alternativas nao montadas

Os seguintes componentes existem, mas nao sao usados pela interface ativa:

### 21.1 Redesenho alternativo de contratos

- `ContractsModuleShell`: cabecalho executivo com empresa, usuario, notificacoes e configuracoes rapidas.
- `AdministrativeTabs`: alternativa visual para as tres abas administrativas; apenas seu tipo TypeScript e reutilizado.
- `ContractStatsCards`: cards de ativos, a vencer, vencidos e valor total.
- `ContractsToolbar`: busca, status, orgao, ordenacao, tamanho de pagina, filtro somente com anexo e somente com link.
- `ContractCard`: alternativa de card com badges de entidade, anexo e link publico.
- `ContractsPagination`: paginacao com numeros de pagina.

Esses componentes descrevem funcionalidades adicionais de filtro e apresentacao, mas nao devem ser consideradas ativas ate serem integradas.

Controles presentes nessa alternativa:

- `ContractsModuleShell`: botao de notificacoes sem callback, botao de configuracoes rapidas e abas Cadastros, Propostas & Orcamentos e Contratos;
- `ContractsToolbar`: busca, seletores de status e orgao, botao **Filtros Avancados**, ordenacao por vencimento/valor/atualizacao, tamanho de pagina 4/6/8, checkbox somente com anexo e checkbox somente com link;
- `ContractCard`: **Editar**, **Excluir** e o mesmo menu de oito acoes da tela ativa;
- `ContractsPagination`: **Anterior**, um botao para cada pagina e **Proxima**;
- `ContractStatsCards`: somente indicadores, sem acao.

### 21.2 Componentes alternativos de alerta

- `DeadlineAlertsBanner`: banner com resumo, ate dois alertas e links para contratos/certidoes.
- `DeadlineAlertsCard`: card de painel com ate quatro alertas.

O unico componente de alerta montado atualmente e `NotificationBell`.

Controles dormentes:

- `DeadlineAlertsBanner`: **Ver contratos** e **Ver certidoes**;
- `DeadlineAlertsCard`: **Abrir contratos**, **Abrir certidoes** ou texto sem acao **Acompanhar com administrador**, conforme categoria e permissao.

## 22. Dicionario de dados

### 22.1 Usuario (`User`)

| Campo | Tipo | Obrigatorio no modelo | Uso |
|---|---|---|---|
| `id` | string | Sim | Identificador. |
| `name` | string | Sim | Nome exibido. |
| `email` | string | Sim | Login e contato. |
| `password` | string | Nao | Senha em texto puro. |
| `role` | enum | Sim | `SUPER_ADMIN`, `COMPANY_ADMIN` ou `USER`. |
| `companyId` | string | Nao | Empresa vinculada. |
| `avatarUrl` | string | Nao | URL ou Base64. |
| `allowedModules` | array | Sim | Modulos liberados. |

### 22.2 Empresa (`Company`)

| Campo | Tipo | Uso |
|---|---|---|
| `id` | string | Identificador. |
| `corporateName` | string | Razao social e base do slug. |
| `publicCertificatesSlug` | string opcional | URL publica amigavel. |
| `publicCertificatesShareId` | string opcional | Identificador publico alternativo. |
| `cnpj` | string | Documento da empresa. |
| `street` | string | Rua. |
| `number` | string | Numero. |
| `neighborhood` | string | Bairro. |
| `zipCode` | string | CEP. |
| `city` | string | Municipio e local dos documentos. |
| `state` | string | UF. |
| `address` | string | Endereco consolidado para documentos. |
| `representative` | string | Representante legal. |
| `cpf` | string | CPF do representante. |
| `email` | string | Contato e rodape. |
| `taxRate` | number | Aliquota usada ao pagar nota. |
| `banks` | array de `BankAccount` | Contas para solicitacao de pagamento. |
| `logoUrl` | string opcional | Logo; nao ha campo ativo de upload nas Configuracoes atuais. |
| `letterheadUrl` | string opcional | Timbrado Base64. |
| `signatureUrl` | string opcional | Assinatura Base64. |

### 22.3 Conta bancaria (`BankAccount`)

| Campo | Tipo | Uso |
|---|---|---|
| `id` | string | Identificador. |
| `name` | string | Nome do banco. |
| `agency` | string | Agencia. |
| `account` | string | Conta corrente. |

### 22.4 Cliente (`Client`)

| Campo | Tipo | Uso |
|---|---|---|
| `id` | string | Identificador. |
| `city` | string | Municipio/nome operacional do cliente. |
| `segment` | string | Prefeitura ou Camara pela interface. |
| `cnpj` | string | CNPJ. |
| `used` | boolean opcional | Preservado, mas nao atualizado nem usado para bloqueio. |

### 22.5 Servico (`Service`)

| Campo | Tipo | Uso |
|---|---|---|
| `id` | string | Identificador. |
| `name` | string | Nome. |
| `segment` | string | Prefeitura ou Camara. |
| `description` | string | Objeto sugerido na proposta. |
| `used` | boolean opcional | Preservado, mas nao atualizado. |

### 22.6 Item de proposta (`ProposalItem`)

| Campo | Tipo | Uso |
|---|---|---|
| `id` | string | Identificador. |
| `serviceId` | string | Servico/produto selecionado. |
| `serviceDescription` | string opcional | Descricao congelada/editavel. |
| `type` | `service` ou `product` | Regra de calculo. |
| `validityMonths` | number opcional | Quantidade de meses. |
| `monthlyValue` | number opcional | Valor mensal. |
| `quantity` | number opcional | Quantidade de produto. |
| `unitValue` | number opcional | Valor unitario. |
| `total` | number | Total calculado. |

### 22.7 Proposta (`Proposal`)

| Campo | Tipo | Uso |
|---|---|---|
| `id` | string | Identificador. |
| `number` | string | Numero comercial. |
| `clientId` | string | Cliente. |
| `segment` | string | Segmento. |
| `date` | string | Data de emissao. |
| `status` | enum | Rascunho, enviada, aprovada ou rejeitada. |
| `totalValue` | number | Soma dos itens. |
| `items` | array | Itens da proposta. |

### 22.8 Contrato (`Contract`)

| Campo | Tipo | Uso |
|---|---|---|
| `id` | string | UUID. |
| `clientId` | string | Cliente vinculado. |
| `clientName` | string | Nome congelado para exibicao e classificacao. |
| `contractNumber` | string | Numero. |
| `object` | string | Objeto. |
| `startDate` | string | Inicio. |
| `endDate` | string | Final. |
| `totalValue` | number | Valor. |
| `fileUrl` | string | Conteudo/URL legado; novos contratos iniciam com `#`. |
| `attachment` | objeto opcional | Arquivo estruturado. |
| `publicShareId` | string opcional | Codigo do link pretendido como publico. |
| `closedAt` | string opcional | Data/hora de encerramento manual. |

`ContractAttachment` contem `name`, `content`, `mimeType` e `attachedAt`.

### 22.9 Solicitacao de pagamento (`PaymentRequest`)

| Campo | Tipo | Uso |
|---|---|---|
| `id` | string | UUID. |
| `invoiceFile` | string | Nome do arquivo. |
| `invoiceFileContent` | string opcional | Base64. |
| `providerName` | string opcional | Prestador fixo atual. |
| `takerName` | string opcional | Tomador. |
| `invoiceNumber` | string | Numero da nota. |
| `verificationCode` | string opcional | Codigo aleatorio sem uso posterior. |
| `description` | string | Objeto. |
| `amount` | number | Valor. |
| `issueDate` | string opcional | Emissao. |
| `status` | enum | `pending`, `approved`, `formalized` ou `paid`. |
| `createdAt` | string | Criacao. |
| `contractId` | string opcional | Contrato. |
| `clientId` | string opcional | Cliente. |

### 22.10 Receita (`Income`)

| Campo | Tipo | Uso |
|---|---|---|
| `id` | string | UUID. |
| `description` | string | Descricao. |
| `amount` | number | Valor. |
| `date` | string | Data. |
| `origin` | `payment_request` ou `manual` | Origem. |
| `paymentRequestId` | string opcional | Solicitacao geradora. |
| `category` | string opcional | Categoria. |

### 22.11 Despesa (`Expense`)

| Campo | Tipo | Uso |
|---|---|---|
| `id` | string | UUID. |
| `description` | string | Descricao. |
| `amount` | number | Valor. |
| `type` | `fixed` ou `variable` | Tipo de custo. |
| `date` | string | Data. |
| `category` | string | Categoria. |
| `isPaid` | boolean opcional | Pago ou pendente. |

### 22.12 Certidao (`Certificate`)

| Campo | Tipo | Uso |
|---|---|---|
| `id` | string | UUID. |
| `name` | string | Tipo. |
| `validUntil` | string | Validade. |
| `fileUrl` | string | Base64 do PDF/imagem. |
| `createdAt` | string opcional | Ordenacao das versoes. |

### 22.13 Ordem (`Order`)

| Campo | Tipo | Uso |
|---|---|---|
| `id` | string | Identificador. |
| `fileName` | string | Nome do documento. |
| `uploadDate` | string | Data. |
| `status` | `pending` ou `signed` | Status simulado. |
| `signedUrl` | string opcional | Link simulado. |

### 22.14 Estado tecnico de autenticacao

`AuthState` contem:

- `user`: usuario atual ou `null`;
- `isAuthenticated`: indicador de sessao valida;
- `isLoading`: indicador de operacao de autenticacao.

`LoginResponse` define `token` e `user`, mas nao e utilizado pelo login atual. `loginMock` devolve diretamente um `User`, e nenhum token e criado.

## 23. Matriz CRUD consolidada

| Recurso | Criar | Consultar | Editar | Excluir | Observacao |
|---|---|---|---|---|---|
| Empresa | Super Admin | Super Admin e Configuracoes | Super Admin/usuarios autorizados | Super Admin | Exclusao sem cascata. |
| Conta bancaria | Super Admin | Super Admin e Configuracoes | Handler existe, UI nao | Super Admin | Primeira conta vai para o relatorio. |
| Usuario | Admin da empresa e Super Admin | Administradores | Dados, perfil e modulos | Administradores | Senha em texto puro. |
| Perfil proprio | Nao | Proprio usuario | Nome, e-mail e avatar | Nao | Nao troca senha. |
| Cliente | Modulo Administrativo | Modulo Administrativo | Modulo Administrativo | Modulo Administrativo | Bloqueia exclusao com vinculos. |
| Servico | Modulo Administrativo | Modulo Administrativo | Modulo Administrativo | Modulo Administrativo | Bloqueia exclusao se usado em proposta. |
| Proposta | Modulo Administrativo | Modulo Administrativo | Modulo Administrativo | Modulo Administrativo | Status e manual. |
| Item de proposta | Dentro da proposta | Dentro da proposta | Nao edita item existente | Dentro da proposta | Para alterar, remover e adicionar novamente. |
| Contrato | Modulo Administrativo | Modulo Administrativo | Modulo Administrativo | Modulo Administrativo | Sem validacao obrigatoria e sem cascata. |
| Anexo de contrato | Menu do contrato | Detalhes/download | Substitui por novo anexo | Nao ha botao isolado | Fica embutido no contrato. |
| Solicitacao de pagamento | Modulo Financeiro | Modulo Financeiro | Parcial, antes de paga | Sempre | Pode deixar financeiro orfao. |
| Receita | Modulo Financeiro ou pagamento | Modulo Financeiro | Modulo Financeiro | Modulo Financeiro | Edicao nao sincroniza solicitacao. |
| Despesa | Modulo Financeiro ou imposto | Modulo Financeiro | Modulo Financeiro | Modulo Financeiro | Pendente pode virar paga. |
| Certidao | Modulo Certidoes | Privado e publico | Nova versao, nao edicao | Por registro | Historico preservado. |
| Ordem | Pagina dormente | Pagina dormente | Renomear | Pagina dormente | Apenas memoria e simulacao. |

## 24. Regras de integridade e vinculos

- Cliente nao pode ser excluido se estiver em contrato, proposta ou solicitacao de pagamento.
- Servico nao pode ser excluido se estiver em item de proposta.
- Proposta pode ser excluida sem verificar qualquer conversao ou vinculo posterior.
- Contrato pode ser excluido mesmo com solicitacoes vinculadas.
- Solicitacao paga pode ser excluida sem remover receita e imposto.
- Receita automatica pode ser editada ou excluida sem alterar a solicitacao.
- Despesa de imposto pode ser editada ou excluida sem alterar a solicitacao.
- Empresa pode ser excluida sem remover usuarios, clientes, servicos, contratos, propostas, financeiro, pagamentos ou certidoes.
- Usuario pode ser excluido sem transferir propriedade porque os dados pertencem a empresa, nao ao usuario.
- Nao ha chaves estrangeiras reais; os vinculos sao strings dentro de arrays JSON.

## 25. Persistencia e sincronizacao

### 25.1 Chaves globais

| Chave | Conteudo |
|---|---|
| `axsys_users_db_v3` | Usuarios. |
| `axsys_companies_db_v2` | Empresas e contas bancarias embutidas. |
| `sgi_user_v2` | Sessao atual; nao e sincronizada como colecao de negocio. |

### 25.2 Colecoes escopadas por empresa

Formato fisico: `company:COMPANY_ID:CHAVE`.

| Chave base | Conteudo |
|---|---|
| `axsys_clients_db_v2` | Clientes. |
| `axsys_services_db_v2` | Servicos. |
| `axsys_income_db_v2` | Receitas. |
| `axsys_expense_db_v2` | Despesas. |
| `axsys_contracts_db_v2` | Contratos. |
| `axsys_proposals_db_v2` | Propostas. |
| `axsys_payment_requests_v2` | Solicitacoes de pagamento. |
| `axsys_certificates_db_v2` | Certidoes. |

Usuario sem `companyId`, incluindo super admin global, usa o escopo `global`.

### 25.3 Chaves locais auxiliares

| Chave | Conteudo | Escopo atual |
|---|---|---|
| `adminActiveTab` | Aba administrativa ativa | Global no navegador |
| `financeActiveTab` | Aba financeira ativa | Global no navegador |
| `axsys_payment_request_draft_v1` | Rascunho de nova solicitacao | Global no navegador |
| `axsys_payment_requests_contract_filter_v1` | Contrato filtrado | Global no navegador |
| `axsys_company_settings_draft_v1:COMPANY_ID` | Rascunho dos dados da empresa | Por empresa |
| `axsys_notification_reads_v1:USER_ID:AAAA-MM-DD` | Alertas vistos no dia | Por usuario e dia |

Nenhuma dessas chaves auxiliares e sincronizada com Supabase. O rascunho de pagamento, o filtro de contrato e os estados de aba nao sao isolados por usuario ou empresa. O rascunho da empresa e local ao navegador, embora use o identificador da empresa, e a leitura de notificacoes tambem e local ao navegador.

### 25.4 Tabela remota esperada

O codigo espera a tabela `public.app_state` com, no minimo:

| Coluna | Uso |
|---|---|
| `key` | Chave unica e alvo de `upsert`. |
| `value` | JSON da colecao. |
| `updated_at` | Data/hora ISO usada na recuperacao. |

### 25.5 Algoritmo de sincronizacao

- O sistema intercepta `localStorage.setItem` e `removeItem`.
- Chaves rastreadas sao enviadas por `upsert` ao Supabase.
- A inscricao Realtime escuta alteracoes em toda a tabela e filtra as chaves relevantes no cliente.
- Eventos internos avisam componentes para recarregar quando uma colecao muda.
- Foco da janela e retorno de visibilidade tambem provocam recarga.
- Dados legados sem prefixo de empresa sao copiados para o escopo atual.
- No bootstrap, arrays remotos e locais identificaveis por `id` sao mesclados.
- Em conflito de mesmo `id`, o registro local substitui o remoto durante a mesclagem.
- Registros existentes apenas no remoto ou apenas no local sao preservados.
- A colecao mesclada pode ser reenviada ao Supabase.

### 25.6 Recuperacao especial

Contratos:

- usa cache local se houver;
- sem cache, procura snapshots remoto escopado e legado;
- prioriza o snapshot escopado da empresa;
- tenta gravar o recuperado localmente, mas retorna os dados mesmo se o cache falhar.

Certidoes:

- pode preferir explicitamente o remoto;
- procura escopo da empresa, escopo global e chave legada;
- prioriza empresa, depois global, depois qualquer snapshot nao vazio;
- se o remoto estiver vazio durante refresh, preserva o cache local.

## 26. Inventario das funcoes de servico e dominio

### 26.1 Autenticacao e usuarios

- `getAllUsers`: carrega todos os usuarios com atraso simulado.
- `loginMock`: procura e-mail e compara senha.
- `registerMock`: cria usuario e avatar externo.
- `updateUserModulesMock`: substitui modulos.
- `updateUserDetailsMock`: mescla dados do usuario.
- `resetUserPasswordMock`: substitui senha.
- `deleteUserMock`: remove usuario.
- `buildRegisteredUserRecord`: normaliza registro novo.
- `applyPasswordReset`: atualiza apenas o alvo.
- `getPostLoginPath`: escolhe destino depois do login.
- `reconcileStoredSessionUser`: atualiza ou invalida sessao salva.

### 26.2 Empresas

- `buildCompanyAddress`: monta endereco consolidado.
- `getCompanies`: carrega, normaliza endereco, slug e shareId.
- `getCompanyById`: busca por identificador.
- `getCompanyByPublicCertificatesIdentifier`: busca por slug ou shareId.
- `saveCompany`: cria ou substitui e normaliza.
- `deleteCompany`: remove empresa.
- `getCompanySettings`: escolhe empresa da sessao ou primeira empresa.
- `saveCompanySettings`: mescla configuracoes na empresa atual.
- `fileToBase64`: converte arquivo.

### 26.3 Clientes e servicos

- `getClients`, `saveClient`, `deleteClient`.
- `getServices`, `saveService`, `deleteService`.

### 26.4 Propostas

- `getProposals`.
- `saveProposal`.
- `saveProposals`.
- `deleteProposal`.

### 26.5 Financeiro

- `getIncomes`, `saveIncome`, `deleteIncome`.
- `getExpenses`, `saveExpense`, `deleteExpense`.

### 26.6 Contratos

- `getContracts`: cache, recuperacao remota e fallback.
- `deriveContractEntity`: classifica orgao pelo nome.
- `getContractStatus`: deriva status.
- `getContractProgress`: calcula percentual.
- `getContractDaysRemaining`: calcula prazo.
- `summarizeContracts`: soma contagens e valor.
- `filterContracts`: aplica busca, status e orgao.
- `paginateContracts`: recorta pagina.
- `formatContractCurrency`, `formatContractDate`.
- `persistRecoveredContractsSafely`: mantem retorno mesmo com falha de cache.

### 26.7 Certidoes

- `getCertificates`, `saveCertificate`, `deleteCertificate`, `fileToBase64`.
- `isCertificateValid`.
- `buildCertificateCollections`.
- `getCertificateStatus`.
- `buildPublicCertificatesSections`.
- `splitPublicCertificates`.
- `formatCertificateDate`.
- `buildPublicCertificatesUrl`.
- `resolveCertificatesForLoad`.
- `selectCertificateSnapshot`.
- `persistRecoveredCertificatesSafely`.

### 26.8 Pagamentos e relatorios

- `evaluatePaymentRequestCertificates`: calcula ausentes e vencidas.
- `getPaymentLetterLayoutRules`: regras fisicas da carta.
- `getPaymentReportSections`: secoes por modo.
- `hasPaymentReportAttachments`: informa se ha anexos.
- `getPaymentReportTitle`: titulo por modo.
- `getPaymentReportPrintLabel`: texto do botao.

### 26.9 Notificacoes

- `buildDeadlineAlerts`: cria alertas.
- `summarizeDeadlineAlerts`: agrega contagens.
- `getDeadlineAlertsSnapshot`: carrega contratos e certidoes.
- `formatNotificationReadsDay`.
- `buildNotificationReadsStorageKey`.
- `mergeReadNotificationIds`.
- `computeUnreadNotificationIds`.

### 26.10 Escopo e sincronizacao

- `getStoredSessionUser`, `getScopeCompanyId`.
- `registerStorageSyncHandler`.
- `getScopedStorageKey`, `resolveCompanyScopedKey`.
- `readCompanyScopedValue`, `writeCompanyScopedValue`.
- `isCompanyScopedBaseKey`, `getCompanyScopedBaseKey`.
- `isKeyTrackedForPersistence`, `requestTrackedStorageSync`.
- `dispatchCompanyStorageUpdatedEvent`, `dispatchTrackedStorageUpdatedEvent`.
- `initializeRemotePersistence`, `resetRemotePersistenceScope`.
- `getRelevantRemoteStateKeys`, `getLocalStorageKeysForRemoteStateRow`.
- `mergeRecordArraysById`, `mergeRemoteBootstrapCollection`, `shouldMergeRemoteBootstrapKey`.
- `buildTrackedStorageKeys`, `matchesCompanyStorageUpdate`.

### 26.11 Rascunho de configuracoes

- `buildCompanySettingsDraftKey`.
- `readCompanySettingsDraft`.
- `saveCompanySettingsDraft`.
- `clearCompanySettingsDraft`.
- `applyCompanySettingsDraft`.

### 26.12 Estado de abas, contexto, hooks e componentes exportados

Funcoes de estado de abas:

- `getSafeAdministrativeTab`;
- `getSafeFinanceTab`.

Contexto e hooks:

- `AuthProvider`;
- `useAuth`;
- `useTrackedStorageRefresh`;
- `useDeadlineAlerts`;
- `useDailyDeadlineNotifications`.

Componentes fundamentais:

- `Layout`;
- `Button`;
- `Input`;
- `Switch`;
- `AxsysMarkIcon`;
- `AxsysFullLogo`;
- `Registrations`;
- `NotificationBell`;
- `DeadlineAlertsBanner`;
- `DeadlineAlertsCard`.

Componentes de contratos:

- `AdministrativeTabs`;
- `ContractsModuleShell`;
- `ContractStatsCards`;
- `ContractsToolbar`;
- `ContractCard`;
- `ContractsPagination`;
- `ContractFormModal`;
- `ContractAttachmentModal`;
- `ContractDetailsModal`;
- `ContractActionsMenu`.

Icones exportados de `ContractIcons.tsx`, sem regra de negocio propria:

- `BellIcon`, `SettingsIcon`, `SearchIcon`, `FilterIcon`;
- `BuildingIcon`, `FileTextIcon`, `SparkIcon`, `ClockIcon`, `BadgeIcon`, `MoneyIcon`;
- `CalendarIcon`, `MoreIcon`, `PaperclipIcon`, `DownloadIcon`, `LinkIcon`;
- `ArrowRightIcon`, `TrashIcon`, `PencilIcon`, `EyeIcon`, `XIcon`.

## 27. Integracoes externas

### 27.1 Supabase

Variaveis:

- `VITE_SUPABASE_URL`;
- `VITE_SUPABASE_PUBLISHABLE_KEY` ou `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY`.

Usos:

- `upsert` de estado JSON;
- leitura de snapshots;
- Realtime por `postgres_changes`.

O repositorio nao informa politicas RLS. Como a chave publica fica no navegador e nao ha Supabase Auth, a protecao efetiva da tabela precisa ser auditada antes de reutilizar o desenho.

### 27.2 Google Gemini

Variavel:

- `GEMINI_API_KEY`.

O Vite injeta essa chave em `process.env.GEMINI_API_KEY` no bundle do navegador. Isso expoe a chave ao cliente e deve ser substituido por chamada de backend na nova implementacao.

### 27.3 APIs do navegador

- `FileReader`: Base64 de imagens, notas, contratos e certidoes.
- `navigator.clipboard`: links publicos.
- `window.print`: propostas e processos de pagamento.
- `window.open`: janela de impressao do pagamento.
- `crypto.randomUUID`: identificadores.
- `localStorage`: sessao, dados, rascunhos e estado de interface.

### 27.4 Servicos externos de avatar

- `i.pravatar.cc` para usuarios iniciais.
- `ui-avatars.com` para usuarios criados e fallback visual.

## 28. Funcoes incompletas, simulacoes e riscos

### 28.1 Seguranca

- Senhas ficam em texto puro no navegador e no JSON remoto.
- Nao ha hash, salt, politica de senha, bloqueio de tentativas ou segundo fator.
- A sessao e um objeto de usuario no `localStorage`, sem token assinado.
- Permissoes de modulo podem ser contornadas abrindo rotas diretamente.
- A chave Gemini e enviada ao navegador.
- Realtime escuta a tabela inteira e filtra no cliente; sem RLS adequada, ha risco multiempresa.
- Certidoes publicas usam conteudo Base64 retornado pela mesma camada generica de estado.

### 28.2 Controles sem funcao integral

- **Lembrar-me** nao faz nada.
- **Esqueceu a senha?** nao faz nada.
- **Importar XML/NF** cria registro fixo e nao importa arquivo.
- **Gerar link publico** de contrato cria link sem pagina publica.
- **Baixar PDF** de contrato baixa qualquer anexo, nao necessariamente PDF.
- **Nao** em "Nota Paga?" apenas mostra alerta.
- `Orders` simula assinatura e download.
- Componentes avancados de contratos e alertas nao estao montados.

### 28.3 Integridade de dados

- Nao ha banco relacional nem chaves estrangeiras.
- Exclusao de empresa nao executa cascata nem bloqueio.
- Exclusao de contrato pode orfanar pagamentos.
- Exclusao de pagamento pode orfanar financeiro.
- E-mail duplicado e permitido; login usa o primeiro encontrado.
- Numeros de proposta podem repetir.
- Contratos podem ser salvos sem campos essenciais.
- Campos monetarios aceitam valores negativos, pois nao ha validacao de minimo.
- Datas nao validam ordem cronologica.
- Aliquota pode ser negativa ou superior a 100.
- Nao ha validacao/m mascara de CNPJ, CPF, CEP, UF, agencia ou conta.

### 28.4 Escopo multiempresa

- Colecoes de negocio principais sao escopadas por empresa.
- Usuarios e empresas sao globais.
- Rascunho de pagamento, filtro de contrato e abas sao globais no navegador.
- Super admin sem empresa opera colecoes do escopo `global`.
- `getCompanySettings` de usuario sem empresa usa a primeira empresa cadastrada.
- Dados legados podem ser copiados para o primeiro escopo acessado durante migracao.

### 28.5 Rascunhos e perda de alteracoes nao salvas

- Dados da empresa e nova solicitacao de pagamento possuem rascunho local.
- Perfil, cliente, servico, proposta, contrato, receita, despesa, certidao, empresa do super admin, banco e usuario nao possuem rascunho.
- Nessas telas sem rascunho, sair, recarregar ou fechar antes de salvar descarta o que foi digitado.

### 28.6 Arquivos e capacidade

- Arquivos Base64 aumentam o tamanho em aproximadamente um terco.
- `localStorage` costuma ter limite pequeno por origem.
- Um contrato, timbrado, assinatura, nota ou certidao grande pode exceder o limite.
- A tabela `app_state` guarda colecoes inteiras; uma alteracao pequena regrava o JSON completo.
- Nao ha deduplicacao, versao de arquivo, checksum ou antivirus.

### 28.7 Relatorios

- A geracao depende do motor de impressao do navegador.
- Nao existe PDF canonico salvo no servidor.
- Nao existe numeracao sequencial transacional.
- O historico de documentos emitidos nao e armazenado.
- O processo forcado com certidoes pendentes limpa os arrays de pendencia antes da visualizacao final; o indicador visual de ressalva pode nao permanecer.

## 29. Requisitos minimos para reimplementar em PHP ou Node.js

Para preservar todas as funcoes ativas e corrigir os riscos estruturais, a nova aplicacao precisa conter os seguintes modulos de backend.

### 29.1 Autenticacao e autorizacao

- login por e-mail e senha com hash forte;
- sessao segura por cookie `HttpOnly` ou token com rotacao;
- recuperacao de senha real;
- politica minima de senha;
- autorizacao por perfil e modulo em cada rota e endpoint;
- isolamento obrigatorio por `company_id` no servidor;
- bloqueio de exclusao da propria conta administrativa quando ela for a ultima responsavel;
- auditoria de login, alteracoes de permissao e exclusoes.

### 29.2 Tabelas/colecoes recomendadas para equivalencia

- `companies`;
- `company_bank_accounts`;
- `users`;
- `user_modules`;
- `clients`;
- `services`;
- `proposals`;
- `proposal_items`;
- `contracts`;
- `contract_attachments`;
- `payment_requests`;
- `incomes`;
- `expenses`;
- `certificates`;
- `certificate_files` ou referencia ao storage;
- `notification_reads`;
- `audit_logs`;
- `generated_documents`, caso os PDFs emitidos devam ser preservados.

Todas as tabelas de negocio devem possuir `company_id`, datas de criacao/alteracao e politica clara de exclusao.

### 29.3 Armazenamento de arquivos

- usar S3, Supabase Storage ou servico equivalente;
- guardar no banco apenas identificador, URL assinada, MIME type, tamanho e checksum;
- validar extensao e MIME type;
- limitar tamanho;
- manter versoes de certidoes;
- gerar URLs publicas controladas ou assinadas;
- nao gravar Base64 em cookie, sessao ou colecao JSON principal.

### 29.4 APIs funcionais necessarias

- autenticacao: login, logout, sessao, solicitar reset e concluir reset;
- empresas: listar, criar, consultar, atualizar e excluir/arquivar;
- bancos: listar, criar, atualizar e excluir;
- usuarios: listar por empresa, criar, atualizar, redefinir senha, atualizar modulos e excluir;
- clientes: CRUD com verificacao de vinculos;
- servicos: CRUD com verificacao de vinculos;
- propostas: CRUD, itens, mudanca de status e geracao de PDF;
- contratos: CRUD, anexos, encerramento, download e compartilhamento;
- pagamentos: CRUD, formalizacao, marcacao de pagamento e relatorio;
- financeiro: CRUD de receitas/despesas e conciliacao com pagamentos;
- certidoes: criar versao, listar atual/historico, excluir registro, baixar e publicar;
- notificacoes: listar alertas e marcar leitura;
- documentos: gerar proposta, solicitacao avulsa e processo completo.

### 29.5 Transacoes obrigatorias

- marcar solicitacao como paga + criar receita + criar imposto deve ocorrer em uma unica transacao;
- excluir ou cancelar pagamento deve tratar lancamentos vinculados explicitamente;
- excluir empresa deve bloquear ou executar cascata documentada;
- excluir contrato deve bloquear quando houver pagamentos ou preservar referencia historica;
- numero de proposta deve ser gerado com sequencia unica por empresa;
- criacao de empresa e primeiro administrador deve ser atomica.

## 30. Criterios de aceite para equivalencia funcional

### 30.1 Acesso

- cada perfil ve somente menus autorizados;
- URL direta sem permissao retorna acesso negado;
- sessao removida ou usuario excluido encerra o acesso;
- dados de uma empresa nunca aparecem para outra.

### 30.2 Administrativo

- cliente e servico oferecem criar, listar, editar e excluir;
- bloqueios de exclusao respeitam vinculos;
- detalhes do cliente agregam contratos, propostas e pagamentos;
- proposta calcula servicos e produtos e gera documento;
- contrato calcula status/progresso, recebe anexo, encerra e inicia pagamento.

### 30.3 Financeiro

- receitas e despesas oferecem CRUD;
- saldo considera apenas despesas pagas;
- pagamento restaura rascunho;
- IA preenche a nota sem expor chave;
- formalizacao verifica seis certidoes;
- pagamento gera receita e imposto exatamente uma vez;
- relatorios avulso e completo sao gerados.

### 30.4 Certidoes

- nova versao preserva historico;
- validade inclui o dia final;
- filtros atual, vencidas e historico retornam registros corretos;
- pagina publica resolve slug e codigo alternativo;
- downloads funcionam sem expor dados privados de outras empresas.

### 30.5 Configuracoes e empresas

- rascunho de dados da empresa sobrevive a navegacao;
- salvar recalcula endereco consolidado;
- timbrado e assinatura aparecem nos documentos;
- primeira conta bancaria aparece na solicitacao;
- aliquota gera imposto correto;
- super admin administra empresa, usuarios, modulos e bancos.

## 31. Mapa de arquivos por responsabilidade

### Entrada e sessao

- `App.tsx`: rotas e guardas.
- `index.tsx`: montagem React.
- `context/AuthContext.tsx`: sessao, login, logout e modulos.
- `services/authService.ts`: base de usuarios e operacoes.
- `utils/auth.ts`: normalizacao e reconciliacao.

### Paginas

- `pages/Login.tsx`: login.
- `pages/Dashboard.tsx`: painel principal.
- `pages/Administrative.tsx`: abas administrativas, pagamentos e relatorio.
- `pages/Proposals.tsx`: propostas e documento.
- `pages/Contracts.tsx`: contratos.
- `pages/Finance.tsx`: financeiro.
- `pages/Certificates.tsx`: certidoes privadas.
- `pages/PublicCertificates.tsx`: certidoes publicas.
- `pages/Settings.tsx`: perfil e empresa.
- `pages/PermissionPanel.tsx`: usuarios da empresa.
- `pages/Register.tsx`: criacao de usuario.
- `pages/SuperAdminPanel.tsx`: empresas, bancos e usuarios globais.
- `pages/Orders.tsx`: ordens dormentes.

### Componentes de negocio

- `components/Registrations.tsx`: clientes, servicos e detalhes.
- `components/contracts/ContractFormModal.tsx`: formulario de contrato.
- `components/contracts/ContractAttachmentModal.tsx`: anexo.
- `components/contracts/ContractDetailsModal.tsx`: detalhes.
- `components/contracts/ContractActionsMenu.tsx`: menu operacional.
- `components/notifications/NotificationBell.tsx`: alertas ativos.

### Persistencia

- `services/storageScope.ts`: chaves e isolamento por empresa.
- `services/remotePersistence.ts`: bootstrap, upsert e Realtime.
- `services/supabaseClient.ts`: cliente Supabase.
- `utils/bootstrapMerge.ts`: mescla local/remoto.
- `utils/remoteStateSync.ts`: mapeamento de chaves.
- `hooks/useTrackedStorageRefresh.ts`: recarga de telas.
- `utils/companyStorageEvents.ts`: filtragem de eventos.

### Servicos de entidades

- `services/companyService.ts`.
- `services/clientService.ts`.
- `services/serviceService.ts`.
- `services/proposalService.ts`.
- `services/contractService.ts`.
- `services/financeService.ts`.
- `services/certificateService.ts`.
- `services/deadlineAlerts.ts`.

### Regras de dominio

- `utils/contracts.ts`.
- `utils/paymentFormalization.ts`.
- `utils/paymentReport.ts`.
- `utils/certificateHistory.ts`.
- `utils/publicCertificates.ts`.
- `utils/certificateLoad.ts`.
- `utils/certificateSnapshots.ts`.
- `utils/notifications.ts`.
- `utils/notificationReads.ts`.
- `utils/moduleTabs.ts`.
- `utils/companySettingsDraft.ts`.

## 32. Cobertura de testes existente

Os testes automatizados atuais cobrem:

- criacao de usuario, reset de senha, destino de login e reconciliacao de sessao;
- isolamento por empresa;
- mescla local/remota;
- chaves de persistencia e eventos de atualizacao;
- rascunho de configuracoes;
- endereco, slug e shareId de empresa;
- CRUD de proposta no escopo correto;
- recuperacao de contratos e certidoes;
- historico e validade de certidoes;
- pagina publica de certidoes;
- status, filtros, progresso, resumo e paginacao de contratos;
- validacao de certidoes na formalizacao;
- modos e layout do relatorio de pagamento;
- alertas e leitura diaria;
- abas administrativas e financeiras;
- identidade visual e textos do login.

Nao existem testes automatizados de navegador para os fluxos completos, nem testes de seguranca, permissao por rota, upload real, impressao, clipboard, Gemini, Realtime ou exclusoes em cascata.
