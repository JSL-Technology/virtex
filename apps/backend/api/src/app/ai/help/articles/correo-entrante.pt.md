---
title: Faturas e encomendas que chegam por e-mail
route: /settings/integrations
---

## Os endereços

Em Configurações › Integrações, a secção «E-mail recebido» cria dois endereços para a sua empresa: um para faturas de fornecedor e outro para encomendas de clientes. É necessária a permissão «E-mail recebido». A parte longa do endereço é a sua chave: se for divulgada, «Mudar endereço» cria outro e o anterior deixa de funcionar de imediato. Pode limitar quem escreve para cada um com uma lista de endereços ou domínios (@fornecedor.com). Um e-mail cujo domínio de origem diz que é falso (SPF ou DKIM falhados) é descartado.

## Faturas de fornecedor

Cada PDF, foto ou XML anexo (CFDI, e-CF, NF-e) é lido com as mesmas regras do seu país que uma fatura carregada à mão. Se o fornecedor estiver registado com esse identificador fiscal, o número do documento for válido, os totais baterem, não for um duplicado e cada linha tiver produto ou conta, é guardada como fatura em rascunho e ligada à ordem de compra aberta que claramente a explica (por total e produtos). Se algo estiver em dúvida, fica em «Faturas recebidas por e-mail», na lista de faturas de fornecedor, com o motivo; «Rever» abre o formulário já preenchido com o que foi lido e o ficheiro anexo. Nada é aprovado nem contabilizado a partir do e-mail.

## Encomendas de clientes

O cliente é reconhecido pelo seu endereço de e-mail. Os artigos pedidos são procurados por código e por nome no seu catálogo, e a encomenda torna-se um orçamento em rascunho a preços de catálogo. O que não foi possível identificar fica em «Encomendas recebidas por e-mail», na lista de orçamentos, para ser completado. Aprovar o orçamento converte-o em encomenda; daí é faturado como sempre.

## O que fica registado

Cada rascunho leva a etiqueta «Recebido por e-mail e lido por IA» com a mensagem de onde veio. Nas faturas lidas, a etiqueta diz quantos campos uma pessoa corrigiu antes de guardar.
