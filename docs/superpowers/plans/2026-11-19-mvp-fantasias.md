# MVP de fantasias — plano de implementação

> **For agentic workers:** Use superpowers:executing-plans para executar cada tarefa com verificação.

**Goal:** Entregar painel local utilizável para cadastro, agenda e devolução; preparar integrações posteriores.

**Architecture:** Node.js com SQLite e páginas HTML responsivas. Regras de negócio no servidor, sem dependências externas na primeira etapa.

**Tech Stack:** Node.js 26, `node:sqlite`, `node:test`, HTML/CSS/JS.

**Spec:** `BLUEPRINT.md`.

## Restrições globais

- Multa: R$ 10 por dia corrido após vencimento.
- Não salvar extração por IA sem confirmação humana.
- Não publicar nem conectar número real sem testes e auditorias da fase 6.
- Dados privados exigem autenticação; segredos nunca no código.

## Foco de revisão

- Data inválida ou invertida deve ser recusada.
- Quantidade zero ou reserva sobreposta deve ser recusada.
- Devolução repetida não pode cobrar ou alterar estoque duas vezes.
- Usuário sem sessão não pode acessar nem alterar dados.
- Falha do banco não pode parecer sucesso.

### Tarefa 1: Regras de aluguel

**Arquivos:** `src/domain.js`, `test/domain.test.js`.

- [ ] Escrever testes para dias de atraso, intervalos e validação.
- [ ] Rodar testes e confirmar falha esperada.
- [ ] Implementar funções puras mínimas.
- [ ] Rodar testes e confirmar aprovação.

### Tarefa 2: Persistência e API privada

**Arquivos:** `src/db.js`, `src/server.js`, `test/api.test.js`.

- [ ] Escrever testes de cadastro, aluguel, conflito, devolução e acesso negado.
- [ ] Rodar testes e confirmar falha esperada.
- [ ] Implementar schema, transações, autenticação e endpoints.
- [ ] Rodar testes e confirmar aprovação.

### Tarefa 3: Painel operacional

**Arquivos:** `public/index.html`, `public/app.js`, `public/styles.css`.

- [ ] Implementar entrada, resumo do dia, catálogo, aluguéis e devolução.
- [ ] Verificar fluxos no navegador e responsividade.
- [ ] Rodar testes completos e checagem de sintaxe.

### Tarefa 4: Integrações seguintes

Gemini, WhatsApp e lembretes seguem o blueprint, mas só após a primeira etapa estar validada. Cada integração terá teste próprio antes de conectar credenciais reais.
