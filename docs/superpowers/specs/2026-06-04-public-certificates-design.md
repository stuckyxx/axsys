# Design: Links publicos de certidoes por empresa

## Objetivo

Permitir que cada empresa tenha uma pagina publica de certidoes, com URL amigavel para incorporacao em sites externos, mantendo um identificador alternativo estavel para fallback.

## Resultado esperado

- Cada empresa passa a ter um link publico proprio para certidoes.
- A URL principal usa um `slug` amigavel.
- O sistema tambem guarda um `shareId` publico como identificador alternativo.
- A pagina publica mostra certidoes validas por padrao.
- O visitante pode optar por visualizar tambem as certidoes vencidas.
- Cada certidao publica exibe nome, validade, status e link de download.

## Escopo

Incluido neste trabalho:

- Modelagem publica das certidoes por empresa
- Rota publica dentro do app
- Resolucao da empresa por `slug` ou `shareId`
- Tela publica de consulta e download
- Exibicao do link publico no painel interno de certidoes

Fora de escopo neste trabalho:

- Dominio customizado por cliente
- Endpoint HTTP externo sem hash routing
- Controle avancado de expiracao do link publico
- Permissoes por certidao individual

## Abordagens consideradas

### 1. Apenas pagina publica no app

Mais simples e rapida, mas nao atende bem reaproveitamento futuro em outros sites.

### 2. Apenas fonte de dados publica

Boa para integracao total com sites externos, mas nao entrega uma pagina pronta no proprio sistema.

### 3. Pagina publica mais identificador reutilizavel

Escolha recomendada. Entrega uma pagina publica imediata e deixa a base preparada para consumo externo posterior.

## Decisoes aprovadas

- O endereco publico deve ser generico e nao preso a um cliente de demonstracao.
- A URL principal deve usar `slug`.
- O sistema deve manter tambem um codigo publico de fallback.
- A listagem publica deve mostrar certidoes validas por padrao, com opcao para incluir vencidas.

## Design funcional

### Identificacao publica da empresa

Adicionar na empresa dois novos campos:

- `publicCertificatesSlug`
- `publicCertificatesShareId`

Regras:

- `publicCertificatesSlug` deve ser amigavel, derivado do nome da empresa e unico dentro do conjunto de empresas.
- `publicCertificatesShareId` deve ser gerado automaticamente com valor estavel e nao amigavel, usado como fallback.
- Empresas legadas que ainda nao possuam esses campos devem recebe-los automaticamente na leitura ou salvamento.

### Rota publica

Adicionar uma rota publica no app:

- `#/public/certidoes/:identifier`

Comportamento:

- `identifier` pode ser tanto o `publicCertificatesSlug` quanto o `publicCertificatesShareId`.
- A rota nao exige autenticacao.
- Se a empresa nao for encontrada, a tela deve informar que a pagina publica nao existe.

### Fonte dos dados

A tela publica vai localizar a empresa a partir do identificador e carregar as certidoes usando o `companyId` da empresa encontrada.

Filtros:

- Certidoes validas aparecem primeiro e visiveis por padrao.
- Certidoes vencidas ficam ocultas inicialmente.
- Um controle simples `Mostrar vencidas` expande a secao de vencidas.

### Download publico

Cada certidao com `fileUrl` disponivel deve oferecer acao de download.

Observacoes:

- O download continua apontando para o arquivo ja persistido hoje no sistema.
- Certidoes sem arquivo salvo devem aparecer como indisponiveis para download.

### Painel interno

Na tela interna de certidoes, adicionar um bloco de compartilhamento contendo:

- URL publica principal baseada no `slug`
- Indicacao do codigo de fallback
- Acao para copiar o link publico

## Impacto tecnico

Arquivos com maior chance de alteracao:

- `types.ts`
- `services/companyService.ts`
- `services/certificateService.ts`
- `pages/Certificates.tsx`
- `App.tsx`
- nova pagina publica dedicada
- testes de servicos e utilitarios relacionados

## Riscos e mitigacoes

### Slug duplicado

Mitigacao: gerar slug base e aplicar sufixo incremental quando necessario.

### Empresa legada sem dados publicos

Mitigacao: preencher `slug` e `shareId` automaticamente quando a empresa for lida.

### Certidao sem arquivo disponivel

Mitigacao: manter a exibicao do item e sinalizar indisponibilidade do download.

### Exposicao indevida de certidoes vencidas

Mitigacao: esconder vencidas por padrao e exigir interacao explicita para exibi-las.

## Plano de implementacao

1. Cobrir com testes a geracao e recuperacao dos identificadores publicos da empresa.
2. Adicionar os novos campos ao tipo `Company` e ao servico de empresas.
3. Criar helpers para resolver empresa por `slug` ou `shareId`.
4. Criar a pagina publica de certidoes.
5. Registrar a rota publica no roteador.
6. Exibir o link publico na tela interna de certidoes.
7. Validar comportamento com testes e build.

## Criterios de aceitacao

- Existe uma URL publica por empresa para consulta de certidoes.
- A URL funciona com `slug` e com `shareId`.
- A pagina publica nao exige login.
- Certidoes validas aparecem por padrao.
- O visitante consegue revelar certidoes vencidas.
- Certidoes com arquivo disponivel podem ser baixadas publicamente.
- O painel interno mostra o link publico que pode ser incorporado em outro site.
