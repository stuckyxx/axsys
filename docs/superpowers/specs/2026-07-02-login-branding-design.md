# Login Branding Design

## Goal

Atualizar a tela inicial de login para usar a identidade visual Axsys aprovada, com painel escuro, marca desenhada como parte da página, detalhes em azul, roxo e laranja, e formulário claro à direita.

## Design

A página de login continua sendo uma tela pública sem alterar o fluxo de autenticação. Em desktop, a tela será dividida em duas áreas: uma faixa de marca escura à esquerda com textura de circuitos e logo Axsys desenhada em SVG/HTML inline, e uma área clara à direita com o formulário existente. Em telas menores, a tela vira uma coluna única com a marca no topo do formulário.

## Marca

A referência visual enviada orienta as cores e composição, mas a página não deve anexar a logo como PNG/JPG. O símbolo Axsys deve ser renderizado por componente React com SVG inline, e o wordmark/tagline devem ser texto ou HTML estilizado, para parecer parte nativa da interface.

## Behavior

O submit, loading, validação de senha mínima, erro de login, checkbox "Lembrar-me" e link "Esqueceu a senha?" permanecem com o mesmo comportamento. A alteração é visual e estrutural, sem trocar serviços, rotas ou contexto de autenticação.

## Verification

A implementação deve incluir um teste de branding que valide que a tela não usa `<img>` nem caminhos de assets para a logo, além dos textos aprovados. A verificação final deve rodar esse teste e `npm run build`.
