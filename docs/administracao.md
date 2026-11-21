# Acessos e diagnósticos da Lore Modas

Esta atualização troca a senha compartilhada por contas individuais. O acesso antigo por `ADMIN_PASSWORD` deixa de funcionar. Antes de colocar em operação, pare o servidor antigo e crie as contas no servidor que contém o banco correto:

```sh
npm run accounts -- create admin henrique
npm run accounts -- create operator lore
npm start
```

Cada comando solicita a senha duas vezes sem exibi-la (12 a 256 caracteres). Não coloque senhas nos argumentos do terminal. Lore recebe uma senha temporária e precisa alterá-la ao entrar. Henrique usa Administração no menu (`/#admin`) para bloquear, desbloquear, encerrar sessões e redefinir senhas. A senha temporária de uma redefinição aparece uma vez; entregue-a por um canal privado. Não há cadastro público nem senha padrão.

Para recuperar Henrique no terminal do servidor:

```sh
npm run accounts -- recover henrique
```

Isso define a nova senha, desbloqueia o administrador e encerra suas sessões. Alterações de acesso ficam no histórico por 90 dias. As sessões expiram após 12 horas ou 60 minutos de inatividade. Senhas usam scrypt com salt; somente o hash dos identificadores de sessão é guardado. Toda autorização é verificada pelo servidor. Não há exclusão de contas; o último administrador ativo não pode ser bloqueado.

## Integrações

As credenciais permanecem no ambiente do processo. O painel mostra o sufixo de quatro caracteres e um identificador SHA-256 abreviado. Para trocar uma chave, atualize o ambiente e reinicie o servidor. O painel não revela nem edita segredos. Mudanças de chave não atribuem retroativamente chamadas anteriores à nova credencial.

- **Gemini:** conexão consulta modelos; resposta e áudio geram conteúdo sintético e consomem cota. O áudio de teste diz “Uma fantasia de pirata, tamanho M”. Nenhum teste cadastra fantasia ou aluguel. O histórico registra tentativas, modelos, duração e tokens quando informados; não é uma fatura nem um contador oficial de cota.
- **WhatsApp:** conexão consulta o número; templates consulta os modelos de operação em pt_BR usando `WHATSAPP_WABA_ID`. Envio requer `WHATSAPP_TEST_PHONE` (55 + DDD + número), `WHATSAPP_TEST_TEMPLATE` aprovado sem parâmetros e confirmação explícita na tela. O envio pode ser cobrado. O destino nunca é retirado do cadastro de clientes.
- **Recebimento WhatsApp:** gerar código e enviar manualmente ao número da loja permite comprovar a entrada pelo webhook assinado. Atualize o painel para consultar o resultado. O código vale dez minutos e não vira pedido. Aceite de envio pela Meta não comprova entrega; entregue/lido dependem de callbacks assinados.
- **SQLite:** integridade e escrita isolada com rollback.
- **Consumo Hermes:** opcional, consulta somente metadados; indisponibilidade não impede a operação da loja.
- **Este dispositivo:** microfone e armazenamento local, disponível também à Lore. Grave três segundos e ouça. Teste o armazenamento, recarregue a página e repita para verificar a leitura. Não envia áudio ao servidor. Testar no computador não comprova funcionamento no celular.

Os testes são manuais, com intervalo mínimo de dez segundos por usuário/integração e uma execução por integração. Configurado não significa testado. Resultados têm data e podem ficar desatualizados. Um erro 429 não permite concluir sozinho se a cota acabou por minuto ou por dia.

## Banco e backup

No primeiro uso de uma base anterior sem tabela de usuários, o servidor e o comando de contas fazem um backup antes da migração aditiva. O arquivo fica em `BACKUP_DIR` ou em `backups` ao lado do banco. Os dados operacionais são preservados; o nome do cliente em cada aluguel passa a ser uma fotografia do nome no momento da contratação. Nomes já sobrescritos antes desta atualização não podem ser recuperados automaticamente.

Configure `BACKUP_DIR` para habilitar cópias diárias (checagem na inicialização e a cada hora) e o botão de backup. Cada cópia usa a API de backup SQLite, incluindo WAL, e é aberta em uma base temporária para verificar integridade, chaves estrangeiras e escrita. O painel mostra a verificação concluída. Backups incluem dados pessoais e hashes de senha; proteja o diretório e copie para armazenamento externo seguro. A rotina não apaga backups antigos; monitore o espaço. Cópia no mesmo disco não protege contra falha desse disco.

Para restaurar: pare o servidor, preserve o banco atual e seus arquivos `-wal` e `-shm` em outro diretório, coloque a cópia verificada no caminho de `DB_PATH` sem reaproveitar WAL/SHM antigos, revise as contas e reinicie. A restauração substitui os dados pelo estado da cópia. Ensaie primeiro em outro `DB_PATH`, sem integrações externas habilitadas.

## Verificação e implantação

```sh
npm ci
npx playwright install chromium
npm run check
npm test
```

Playwright é dependência apenas de desenvolvimento. `npm run test:unit` executa testes sem navegador; `npm run test:browser` executa os fluxos Chromium. O runtime continua usando apenas APIs do Node.js 26+. Os testes usam bases descartáveis e mocks dos provedores.

Não houve criação de contas reais, alteração de credenciais, migração do banco operacional nem envio real nesta implementação. Faça o provisionamento acima antes do corte. O servidor continua em 127.0.0.1: configure proxy HTTPS para acesso remoto e `NODE_ENV=production` para cookie Secure. Só habilite `TRUST_LOCAL_PROXY=1` com proxy local confiável.

Limites conhecidos: confirmação WhatsApp serializada em um único processo; múltiplos workers exigem coordenação persistente. Falha de rede após a Meta aceitar uma mensagem pode deixar o resultado incerto; não há garantia de entrega exatamente uma vez. Áudios pendentes usam o armazenamento deste navegador e podem ser apagados ao limpar os dados; quando a gravação local falha, a interface avisa para manter a aba aberta. Nenhum segredo é editado pelo painel.
