---
title: Conciliación bancaria asistida
route: /accounting/reconciliation
---

## Qué archivos del banco se pueden importar

En Contabilidad › Conciliación › Importar estado de cuenta se acepta el archivo que exporta la banca en línea:

- **OFX** (también llamado QFX o «Money»): trae fechas, montos con signo y el saldo final. No hay que indicar columnas.
- **camt.053** (ISO 20022, XML): trae fechas, montos, el saldo inicial y el final. No hay que indicar columnas.
- **CSV**: hay que decir qué columna es cada cosa. Al elegir el archivo, el sistema lee los encabezados y las primeras filas y propone el mapeo: la columna de fecha y su formato, la descripción, la referencia, la de entradas y la de salidas, y si los números usan coma o punto decimal. Revisa la propuesta antes de importar; si los encabezados no dicen nada útil, el asistente la propone y lo indica.

Con OFX y camt.053 el período y los saldos salen del archivo. Si los escribes a mano, deben coincidir con el archivo; si no coinciden, la importación se rechaza y dice qué dato difiere.

## Cómo se proponen los emparejamientos

Para cada movimiento del banco se buscan líneas del mayor de la cuenta bancaria por el mismo monto, y se puntúan:

- misma fecha o fecha cercana;
- una referencia en común (número de cheque, de factura, número fiscal o de recibo en la descripción);
- palabras en común en la descripción;
- que la empresa haya emparejado antes movimientos con la misma descripción contra la misma cuenta.

Cada candidato muestra su puntuación y las razones. Un movimiento es **seguro** cuando tiene un único candidato claro por encima del umbral de la empresa (95 por defecto) y ese candidato no lo reclama otro movimiento; si no, queda para **revisar**.

## Confirmar los seguros de una vez

El botón «Confirmar las seguras» empareja todos los movimientos seguros del estado de cuenta. Cada emparejamiento se deshace igual que uno manual, con «Deshacer».

La casilla «Confirmar automáticamente al importar» hace lo mismo al importar cada estado de cuenta. Está apagada por defecto y se activa por empresa; los emparejamientos que hace quedan con origen automático.

## Preguntar al asistente

Cuando un movimiento tiene varias líneas del mismo monto que la puntuación no separa, «Preguntar al asistente» le pide que elija una y explique por qué. El asistente solo marca la línea: el emparejamiento lo confirma la persona. Si ninguna corresponde con seguridad, lo dice.
