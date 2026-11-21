# Administração, acessos e diagnóstico — plano proposto

Status: implementação autorizada e concluída; revisão final em andamento. Complementa a auditoria de 20/11/2026 em lore_modas_integracao, commit 6d2b0fc.

**Objetivo:** Henrique administra o acesso da Lore e verifica as integrações efetivamente usadas pela loja, sem compartilhar credenciais de acesso.
**Arquitetura proposta:** mesmo servidor e SQLite, contas individuais com papéis admin e operator, área /#admin com APIs protegidas no backend. Reutilizar as integrações atuais e sua interface HTML/CSS/JavaScript; nenhuma migração de framework.
**Stack:** Node.js >=26, node:http, node:sqlite, node:crypto, node:test e navegador nativo.
**Escopo:** uma loja, inicialmente duas contas. Este documento reúne o desenho funcional e a sequência de implementação; a implementação foi autorizada pelo usuário em seguida.

## Abordagem

Recomendação: contas e painel administrativo no sistema existente. Uma aplicação administrativa separada duplicaria autenticação e implantação; manter senha compartilhada não permite controlar apenas a sessão da Lore. O painel /admin é uma área do produto, não um novo container Docker.

## Contas e permissões

| Ação | Henrique/admin | Lore/operator |
|---|---|---|
| Aluguéis, estoque, agenda, caixa e pedidos | Sim | Sim |
| Alterar a própria senha | Sim | Sim |
| Redefinir acesso da Lore | Sim | Não |
| Bloquear/desbloquear Lore e encerrar suas sessões | Sim | Não |
| Ver diagnósticos, identificação de chaves e histórico administrativo | Sim | Não |
| Executar testes externos | Sim | Não |

- Login por identificador e senha; sem cadastro público. Lore mantém toda a operação atual.
- Redefinição fornece senha temporária, obriga alteração no próximo acesso e revoga sessões anteriores. Nunca mostrar a senha atual de ninguém.
- Senhas derivadas com scrypt e salt individual; sessões aleatórias com hash no banco, expiração absoluta proposta de 12 horas e inatividade de 60 minutos. Cookies HttpOnly, SameSite e Secure em produção.
- Permissão, bloqueio e expiração verificados no servidor em toda chamada. Não confiar no menu oculto nem em papel enviado pelo navegador.
- Impedir bloqueio/exclusão do último administrador. Nesta versão, bloquear contas em vez de excluí-las.
- Toda alteração de acesso registra ator, alvo, ação, data e resultado, sem senhas ou tokens.
- Recuperação do administrador por procedimento local do servidor, com nova senha e revogação das sessões; não criar porta de recuperação pública.
- Migração aditiva: provisionar o primeiro admin por comando local, criar a conta da Lore e desativar o login compartilhado no corte. Não continuar aceitando ADMIN_PASSWORD como bypass. Preservar dados existentes e testar backup/restauração antes do corte.

## Workspace administrativo

Página Administração: contas e cartões de integração, com histórico e uso em seções expansíveis.

Cada cartão mostra estado, última verificação, duração, identificação da configuração e erro legível. Estados: não configurado, não testado, testando, funcionando, degradado e falhou. Separar configuração presente de serviço comprovadamente funcional. Resultado antigo mostra data e não significa disponibilidade atual.

### Gemini

- Mostrar origem da credencial efetiva (ambiente do processo), últimos quatro caracteres, fingerprint SHA-256 abreviado, modelo principal e lista de fallback.
- Resolver configuração pelo mesmo código utilizado em produção; não mostrar uma configuração diferente da usada nas requisições.
- Testar conexão: consulta de modelos/autorização sem geração. Listagem acessível não garante que o modelo conseguirá gerar.
- Testar resposta: prompt sintético pequeno, limite de saída e timeout, executado pelo mesmo caminho de produção. Exibir modelo solicitado, modelo efetivo, fallback ocorrido, duração e usageMetadata.
- Testar áudio: amostra sintética curta e conhecida; conferir transcrição e estrutura, sem inserir estoque ou aluguel.
- Registrar por chamada: finalidade, fingerprint da credencial, modelo efetivo, duração, status e tokens disponíveis. Nunca registrar mídia, prompt de cliente ou segredo. Dados históricos começam com a implantação; não inventar atribuição retroativa.
- A primeira versão identifica a chave sem revelar seu valor completo. A troca da chave continua no ambiente do servidor; edição de segredos pelo painel é uma etapa separada.
- Testes de geração informam que consomem cota; não executam ao abrir a página. Não apresentar saldo financeiro ou custo exato sem fonte confiável.

### WhatsApp / Meta

- Exibir número conectado quando consultável, Phone Number ID, WABA ID quando configurado, versão da API e templates usados. Token e app secret permanecem no servidor.
- Testar conexão: consulta autenticada dos metadados do número. Mostrar falta de permissão separadamente de erro de rede ou token inválido.
- Conferir templates: existência, idioma e estado disponibilizado pela Meta; não cadastrar nem alterar templates automaticamente.
- Testar envio: ação separada, com destinatário de teste configurado e prévia. Botão explícito “Enviar mensagem de teste”, exibindo destino e possível custo; nunca usar cliente escolhido automaticamente.
- Testar webhook: mostrar configuração, último evento com assinatura válida e estados de entrega. Consulta ao provedor ou handshake local não prova recebimento externo; sem evento real, mostrar “recebimento não comprovado”.
- Para comprovar entrada: administrador envia mensagem sintética ao número da loja e o painel correlaciona o evento recebido. Não transformar a mensagem de diagnóstico em lead operacional.
- Separar aceito pela API de entregue e lido; atualizar pelo webhook e deduplicar eventos. Tratar falha, timeout e ausência de confirmação sem inventar sucesso.

### Diagnósticos adicionais úteis

- SQLite: acesso, versão de schema e teste de integridade sob demanda. Teste de escrita em tabela isolada com rollback; não usar registros de clientes.
- Áudio no dispositivo: teste de microfone, reprodução e IndexedDB (salvar/ler/remover amostra e verificar recuperação após recarga). Mostrar que vale para o navegador atual; o computador do administrador não comprova o celular da Lore.
- Disponibilizar à Lore um diagnóstico simplificado do próprio dispositivo, sem configurações administrativas nem segredos.
- Consumo Hermes: apenas se a integração estiver habilitada; mostrar disponibilidade e último registro bem-sucedido, sem leitura de conversas. Falha nesse monitoramento não pode impedir uma locação.
- Backup: mostrar “não configurado” enquanto não existir rotina real. Separar último backup de última restauração verificada. Implantar backup consistente do SQLite e validar recuperação antes da operação real.
- Não acrescentar e-mail, pagamentos online ou outro provedor de IA nesta etapa: não fazem parte do fluxo atual.

## Segurança dos diagnósticos

- Rotas /api/admin/* exigem admin em cada chamada, inclusive leitura. Respostas sem cache e erros sanitizados.
- Testes externos por POST, validação de origem e proteção CSRF; destinos de rede fixos por integração, sem campo livre de URL.
- Limitar testes por usuário e integração; uma execução em andamento por integração, timeout finito e sem disparos em polling de tela.
- Não retornar tokens em JSON, HTML, logs, URLs ou mensagens de erro. Histórico restrito com retenção proposta de 90 dias.
- Testes não salvam aluguéis, estoque, pagamentos ou leads. Envios externos só pelo botão destinado ao teste.

## Sequência de implementação e aceite

### 1. Corrigir a base de segurança e persistência

Arquivos: src/server.js, public/app.js, public/audio-import.js, test/api.test.js e testes de navegador a acrescentar.
- [x] Reproduzir em testes a corrida do limite de login, reenvio manual sem identificador e duplicação parcial da janela rápida.
- [x] Corrigir os contadores, manter identificadores estáveis e preservar etapas já gravadas.
- [x] Persistir áudio antes do envio, tratar erro de armazenamento e testar recarga durante requisição pendente.
- [x] Serializar confirmações por aluguel; verificar duas requisições simultâneas com um único envio.
- [x] Tratar os demais achados da auditoria em tarefas próprias: histórico do cliente, tamanho ambíguo e MIME vazio.

### 2. Introduzir contas e sessões individuais

Criar src/auth.js e test/auth.test.js; modificar src/db.js, src/server.js, public/app.js e public/index.html; comando local de provisionamento/recuperação.
- [x] Testar papéis, bloqueio, troca obrigatória de senha, expiração e revogação (cobertura executada, sem alegação de TDD retroativo).
- [x] Criar users, sessions e admin_events de forma aditiva; implementar sessão e autorização centralizadas.
- [x] Criar GET /api/me, login individual, logout e alteração da própria senha.
- [x] Verificar que operador recebe 403 em todas as rotas administrativas e que uma sessão revogada falha imediatamente.
- [x] Ensaiar migração e recuperação em cópia sintética do schema anterior; preservar dados e não deixar bypass de senha compartilhada.

### 3. Entregar gestão do acesso da Lore

Criar public/admin.js e src/admin.js; modificar public/index.html, public/styles.css e src/server.js; criar test/admin.test.js.
- [x] Implementar GET /api/admin/users e ações de bloqueio, desbloqueio, redefinição e revogação de sessões por ID validado.
- [x] Mostrar estado da conta, último login e ações com consequência clara.
- [x] Testar que Lore não pode promover a própria conta, alterar outra conta ou consultar eventos administrativos.
- [x] Testar a proteção do último administrador e o registro sem dados secretos.

### 4. Entregar integração Gemini e rastreabilidade

Criar src/diagnostics.js e test/diagnostics.test.js; modificar src/gemini.js, src/db.js, src/admin.js e public/admin.js.
- [x] Criar GET /api/admin/integrations com metadados sanitizados e POST /api/admin/integrations/gemini/tests com kind connection, response ou audio.
- [x] Reutilizar resolução da credencial, fallback e chamadas reais; registrar metadados do teste com fingerprint.
- [x] Testar sucesso, chave recusada, 429, 503, timeout, fallback e ausência de usageMetadata com mocks.
- [x] Demonstrar que uma chave nova muda o fingerprint usado na próxima execução após atualização do ambiente e reinício; nenhum segredo aparece nas respostas.

### 5. Entregar diagnóstico WhatsApp, banco e dispositivo

Modificar src/whatsapp.js, src/reminders.js, src/server.js, src/diagnostics.js e public/admin.js; ampliar testes correspondentes.
- [x] Implementar testes connection, templates e send para WhatsApp, validando destino de teste e registrando message ID sem token.
- [x] Processar callbacks de status assinados e deduplicados; comprovar que aceitação não marca entrega.
- [x] Separar evento sintético de diagnóstico de lead operacional.
- [x] Implementar SQLite, IndexedDB/microfone e Hermes opcional com escopo claramente exibido.
- [x] Verificar que falha em diagnóstico não modifica nem bloqueia operações da loja.

### 6. Verificar e documentar

Modificar README.md e .env.example sem sobrescrever mudanças prévias do usuário; documentar acesso, recuperação e diagnósticos.
- [x] npm run check e npm test: sem falhas; incluir novos módulos no script check.
- [x] Navegador: testar admin e Lore em sessões distintas, acesso direto às rotas, bloqueio com sessão aberta, reenvio e recarga de áudio.
- [x] Inspecionar respostas e logs para ausência de segredos; testar origem inválida e execução repetida de diagnósticos.
- [ ] Testes externos opcionais em ambiente de teste com credenciais configuradas; mensagem somente ao destinatário explicitamente escolhido.
- [x] Backup/restauração validado em base descartável antes de promover migração; registrar limitações pendentes.

## Pontos para implantação

O servidor atual escuta em 127.0.0.1. Se Henrique acessar de outro computador, será necessário definir hospedagem/rede e HTTPS. Isso não é resolvido somente pela criação do papel admin. Não abrir porta pública automaticamente.

Consultar contratos e permissões exatos da Meta na implementação; o Context7 encontrado apontava wrappers de terceiros, por isso a referência usada é a coleção oficial da Meta.

Fontes consultadas:
- https://ai.google.dev/gemini-api/docs/api-key
- https://ai.google.dev/gemini-api/docs/generate-content/audio
- https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api
- https://ui.visantlabs.com/llms.txt — componentes React/Tailwind; incompatíveis diretamente com o frontend nativo atual.

Não implementado: troca/revelação de segredos pelo painel, múltiplas lojas, cobrança, impersonação da Lore, migração para React ou novo serviço/container. Sem testes externos executados nesta implementação. Veja docs/administracao.md para o corte e limitações.
