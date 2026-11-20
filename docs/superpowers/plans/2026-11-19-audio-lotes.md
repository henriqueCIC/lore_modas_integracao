# Áudio em lote para acervo e locações

1. Reutilizar Gemini multimodal para transcrever e retornar até 50 rascunhos por áudio. Dois contextos: acervo (nome, tamanho, quantidade) e locação (fantasia, tamanho, cliente, telefone, datas, valor).
2. Exibir transcrição e formulários editáveis por registro. Campos ausentes ficam vazios; nenhum item é gravado pela extração. Quantidade do acervo significa unidades a acrescentar, com total previsto visível.
3. Gravar no microfone ou enviar arquivo de até 5 MB. Limitar gravação a dois minutos, liberar microfone ao parar e preservar rascunhos enquanto a página estiver aberta.
4. Reutilizar as rotas de cadastro/locação. Acrescentar confirmação de estoque existente e recibos de idempotência para impedir repetição após falha de rede.
5. Testar separação dos dois aluguéis do exemplo, campos ausentes, datas incoerentes, formatos inválidos, estoque incremental, confirmação repetida e conflitos. Conferir interface no navegador.

Critérios: duas locações no áudio geram dois rascunhos independentes; cada confirmação salva exatamente um registro. Locações continuam exigindo telefone e fantasia cadastrada. A IA não confirma disponibilidade ou consentimento. Áudio e transcrição não ficam no banco.

## Escopo adicional solicitado: agenda e caixa

Substituir seletor da agenda por calendário mensal responsivo, mantendo seleção diária. Adicionar pagamentos integrais em tabela própria; distinguir retiradas contratadas de dinheiro recebido por data. Validar autenticação, duplicatas, forma de pagamento, datas futuras e valor calculado no servidor. Manter multa fora deste recebimento inicial e documentar evolução. Revisão financeira independente e inspeção no navegador antes da entrega.
