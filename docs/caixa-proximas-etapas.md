# Caixa — rascunho das próximas etapas

## Disponível no MVP

- Agenda mensal com retiradas e devoluções por dia.
- Caixa por data: valor contratado para retirada no dia e total efetivamente recebido.
- Confirmação manual do valor integral do aluguel, com Pix, dinheiro, cartão ou transferência.
- Histórico de entradas e proteção contra confirmação duplicada.
- Multas continuam no cálculo da devolução; ainda não entram no caixa.

## Próximas funcionalidades sugeridas

1. **Sinal e pagamento parcial:** registrar cada parcela com data, valor e forma; mostrar saldo restante por aluguel.
2. **Multas e ajustes:** cobrar os R$ 10 por dia de atraso no retorno; registrar desconto ou isenção com motivo, sem apagar o cálculo original.
3. **Despesas:** lavagem, reparos, compras e outras saídas por categoria; separar receita de lucro.
4. **Abertura e fechamento:** saldo inicial em dinheiro, total esperado por forma, valor contado e diferença justificada.
5. **Correção e estorno:** reverter recebimentos incorretos preservando autor, horário e motivo no histórico.
6. **Relatórios:** receitas por período, fantasias mais alugadas, inadimplência e exportação CSV.
7. **Conciliação:** comparar recebimentos registrados com Pix/cartão; considerar taxas e data do repasse.

Ordem proposta: correção/estorno e pagamentos parciais primeiro; depois multas, despesas e fechamento. Antes de operar com dinheiro real, validar o fluxo com a dona e implementar backup automático. O MVP registra a confirmação da dona; não verifica transações bancárias.
