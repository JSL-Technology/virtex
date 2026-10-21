---
title: Agentes (reposição e orçamentos)
route: /settings/ai
---

## O que é um agente

Um agente executa um processo por conta própria, mas nunca compromete a empresa: o que produz é um rascunho, ou uma solicitação no fluxo de aprovação que já existe. Cada execução fica no registro de Administração › IA, com o que propôs, o que não conseguiu fazer e por quê.

## Agente de reposição

Todas as manhãs, a partir da previsão de demanda, revisa os produtos em risco de ruptura ou abaixo do ponto de pedido e prepara ordens de compra:

- ao fornecedor de quem o produto foi comprado da última vez, pelo último preço;
- pela quantidade sugerida menos o que já está pedido e não chegou (incluídos os rascunhos que o agente deixou antes), de modo que executá-lo duas vezes não pede duas vezes;
- uma ordem por fornecedor, filial e moeda.

Um produto que nunca foi comprado não tem fornecedor a quem pedir: aparece no registro em vez de ser adivinhado.

Configura-se em Administração › IA › Agentes: ativá-lo (vem desligado), enviar as ordens para aprovação ou deixá-las em rascunho, e o valor máximo de uma ordem que pode enviar para aprovação por conta própria; uma ordem maior fica em rascunho para alguém revisar. Nada é enviado ao fornecedor sem aprovação humana. Também pode ser executado sob pedido ou como passo «Agente de reposição» de um fluxo de trabalho.

## Orçamentos a partir da mensagem de um cliente

Cole no assistente o e-mail ou a mensagem de um cliente e peça o orçamento: ele encontra o cliente e cada produto, e propõe um orçamento em rascunho com os preços de catálogo. O que não conseguiu identificar, ele informa. O orçamento só é criado quando você confirma a proposta.
