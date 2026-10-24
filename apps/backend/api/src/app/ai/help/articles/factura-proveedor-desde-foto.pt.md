---
title: Registrar uma fatura de fornecedor a partir de uma foto ou PDF
route: /accounts-payable/new
---

## Como se faz

Em Compras › Faturas de fornecedor › Nova, clique em «Ler foto ou PDF» e escolha a foto da fatura ou o PDF que o fornecedor enviou (até 20 MB). O formulário é preenchido com o que se lê do documento: fornecedor, número do documento, datas, moeda, linhas, imposto e, onde o país os usa, a taxa de serviço legal, a forma de pagamento da autoridade fiscal e a classificação da compra. Os campos sugeridos levam uma marca com a confiança.

## Lê-se pelo país da sua empresa

O documento é lido e verificado pelas regras do país da sua empresa: o identificador fiscal impresso lá (CNPJ no Brasil, RFC no México, EIN nos Estados Unidos…), o número que o documento traz (chave de acesso da NF-e, folio fiscal do CFDI, NCF, CUFE ou simplesmente o número da fatura do fornecedor), como se escrevem as datas e qual imposto se aplica. Se o país da sua empresa não tem regras fiscais configuradas, o identificador e o número são copiados como estão impressos e o formulário avisa que não foram verificados.

## O que se verifica

Antes de mostrar qualquer coisa, o sistema verifica o identificador fiscal do fornecedor pela regra do seu país, o formato do número do documento (quando o país tem um que se possa verificar — a chave da NF-e tem dígito verificador), que as linhas somem o subtotal e que subtotal mais impostos dê o total. Se algo não fecha, aparece um aviso e o dado duvidoso não é escrito no campo. Também avisa se você já registrou uma fatura desse fornecedor com o mesmo número ou se o mesmo arquivo já é o documento de outra fatura.

## O fornecedor

O fornecedor é procurado pelo identificador fiscal, nunca pelo nome. Se você não tem nenhum com esse identificador e a autoridade do país permite consultá-lo, o aviso mostra o nome registrado e um link «Registrar fornecedor» que abre a ficha já preenchida.

## As linhas

Cada linha é associada ao que você fez antes com esse fornecedor: se da última vez a lançou numa conta de despesa ou num produto, propõe-se o mesmo. Senão, procura-se o produto pelo código ou pelo nome. Revise a conta de cada linha antes de salvar.

## Nada é salvo sozinho

O que se lê é uma sugestão: só preenche os campos que você não tocou e nada fica registrado até você clicar em Salvar. Ao salvar, o arquivo fica anexado à fatura como evidência; você pode abri-lo a partir da própria fatura.

## Sem IA

Se o seu plano não inclui a leitura de documentos, o botão chama-se «Anexar foto ou PDF»: o arquivo fica guardado com a fatura, mas os campos você preenche.
