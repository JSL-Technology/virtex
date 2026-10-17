---
title: NCF y e-CF de las compras
route: /accounts-payable
---

## Formato

Un NCF tradicional tiene 11 caracteres: la letra B, dos dígitos del tipo de comprobante y ocho de secuencia (por ejemplo B0100000123). Un e-CF tiene 13: la letra E, dos dígitos del tipo y diez de secuencia (por ejemplo E310000000123). Los espacios y guiones se ignoran. Un NCF con otro formato, o de un tipo que la DGII no define, no se acepta: no podría declararse en el 606.

## El RNC del proveedor

El 606 identifica cada compra por el RNC o la cédula del proveedor, así que una factura con NCF necesita un proveedor con RNC válido (se comprueba el dígito verificador). Las excepciones son los comprobantes que emite tu propia empresa para gastos menores (B13, E43) y para pagos al exterior (B17, E47), donde la contraparte no tiene RNC dominicano.

## NCF repetido

Un NCF es único para quien lo emite. Si intentas registrar dos facturas vivas del mismo proveedor con el mismo NCF, la segunda se rechaza: casi siempre es la misma compra registrada dos veces. Una factura anulada o rechazada no cuenta.

## Tipos que conviene revisar

Una factura de consumo (B02, E32) es válida como compra, pero no da crédito de ITBIS. Una nota de crédito (B04, E34) se registra como nota del proveedor, no como factura.
