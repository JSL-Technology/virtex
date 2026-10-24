---
title: Conciliação bancária assistida
route: /accounting/reconciliation
---

## Quais arquivos do banco podem ser importados

Em Contabilidade › Conciliação › Importar extrato aceita-se o arquivo que o internet banking exporta:

- **OFX** (também chamado QFX ou «Money»): traz datas, valores com sinal e o saldo final. Não é preciso indicar colunas.
- **camt.053** (ISO 20022, XML): traz datas, valores, o saldo inicial e o final. Não é preciso indicar colunas.
- **CSV**: é preciso dizer o que é cada coluna. Ao escolher o arquivo, o sistema lê os cabeçalhos e as primeiras linhas e propõe o mapeamento: a coluna de data e o seu formato, a descrição, a referência, as de entradas e de saídas, e se os números usam vírgula ou ponto decimal. Revise a proposta antes de importar; se os cabeçalhos não dizem nada útil, o assistente a propõe e o indica.

Com OFX e camt.053 o período e os saldos saem do arquivo. Se você os digitar, devem coincidir com o arquivo; se não coincidirem, a importação é recusada e diz qual dado difere.

## Como se propõem os pareamentos

Para cada movimento do banco procuram-se linhas do razão da conta bancária com o mesmo valor, e pontuam-se:

- mesma data ou data próxima;
- uma referência em comum (número de cheque, de fatura, número fiscal ou de recibo na descrição);
- palavras em comum na descrição;
- a empresa já ter pareado antes movimentos com a mesma descrição com a mesma conta.

Cada candidato mostra a pontuação e os motivos. Um movimento é **seguro** quando tem um único candidato claro acima do limite da empresa (95 por padrão) que nenhum outro movimento reclama; senão, fica para **revisar**.

## Confirmar os seguros de uma vez

O botão «Confirmar os seguros» pareia todos os movimentos seguros do extrato. Cada pareamento desfaz-se como um manual, com «Desfazer».

A caixa «Confirmar automaticamente ao importar» faz o mesmo ao importar cada extrato. Vem desligada e ativa-se por empresa; os pareamentos que faz ficam com origem automática.

## Perguntar ao assistente

Quando um movimento tem várias linhas do mesmo valor que a pontuação não separa, «Perguntar ao assistente» pede-lhe que escolha uma e explique por quê. O assistente só marca a linha: quem confirma o pareamento é a pessoa. Se nenhuma corresponde com segurança, ele o diz.
