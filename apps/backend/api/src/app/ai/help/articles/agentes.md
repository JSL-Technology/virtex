---
title: Agentes (reposición y cotizaciones)
route: /settings/ai
---

## Qué es un agente

Un agente ejecuta un proceso por su cuenta, pero nunca compromete a la empresa: lo que produce es un borrador, o una solicitud en el flujo de aprobación que ya existe. Cada ejecución queda en la bitácora de Administración › IA, con lo que propuso, lo que no pudo hacer y por qué.

## Agente de reposición

Cada mañana, a partir del pronóstico de demanda, revisa los productos en riesgo de quiebre o bajo el punto de pedido y prepara órdenes de compra:

- al proveedor al que se compró el producto la última vez, al último precio;
- por la cantidad sugerida menos lo que ya está pedido y no ha llegado (incluidos los borradores que el agente dejó antes), así que ejecutarlo dos veces no pide dos veces;
- una orden por proveedor, sucursal y moneda.

Un producto que nunca se compró no tiene proveedor que preguntar: aparece en la bitácora en vez de adivinarse.

Se configura en Administración › IA › Agentes: activarlo (está apagado por defecto), enviar las órdenes a aprobación o dejarlas en borrador, y el monto máximo de una orden que puede enviar a aprobación por su cuenta; una orden mayor queda en borrador para que alguien la revise. Nunca se envía nada al proveedor sin aprobación humana. También puede ejecutarse a pedido o como paso «Agente de reposición» de un flujo de trabajo.

## Cotizaciones desde el mensaje de un cliente

Pega en el asistente el correo o mensaje de un cliente y pídele la cotización: busca al cliente y cada producto, y propone una cotización en borrador a precios de catálogo. Lo que no pudo identificar te lo dice. La cotización se crea solo cuando confirmas la propuesta.
