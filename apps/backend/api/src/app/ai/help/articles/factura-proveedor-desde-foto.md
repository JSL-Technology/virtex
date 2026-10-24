---
title: Registrar una factura de proveedor desde una foto o un PDF
route: /accounts-payable/new
---

## Cómo se hace

En Compras › Facturas de proveedor › Nueva, pulsa «Leer foto o PDF» y elige la foto de la factura o el PDF que te envió el proveedor (hasta 20 MB). El formulario se llena con lo que se lee del documento: proveedor, número del documento, fechas, moneda, líneas, impuesto y, donde el país los usa, la propina legal, la forma de pago de la autoridad fiscal y la clasificación de la compra. Los campos sugeridos llevan una marca con el porcentaje de confianza.

## Se lee según el país de tu empresa

El documento se lee y se comprueba con las reglas del país de tu empresa: el identificador fiscal que se imprime allí (RNC en República Dominicana, RFC en México, EIN en Estados Unidos…), el número que lleva el documento (NCF, folio fiscal del CFDI, clave de la NF-e, CUFE o el número de factura del proveedor), cómo se escriben las fechas y qué impuesto aplica. Si el país de tu empresa no tiene reglas fiscales configuradas, el identificador y el número se copian tal como están impresos y el formulario avisa de que no se verificaron.

## Qué se comprueba

Antes de mostrarte nada, el sistema verifica el identificador fiscal del proveedor con la regla de su país, el formato del número del documento (cuando el país tiene uno que se pueda comprobar), que las líneas sumen el subtotal y que subtotal más impuestos dé el total. Si algo no cuadra, aparece un aviso y el dato dudoso no se escribe en el campo. También avisa si ya registraste una factura de ese proveedor con el mismo número o si el mismo archivo ya es el documento de otra factura.

## El proveedor

El proveedor se busca por su identificador fiscal, nunca por el nombre. Si no tienes ninguno con ese identificador y la autoridad del país lo permite consultar, el aviso muestra el nombre registrado y un enlace «Registrar proveedor» que abre la ficha ya llena.

## Las líneas

Cada línea se asocia con lo que hiciste antes con ese proveedor: si la última vez la cargaste a una cuenta de gasto o a un producto, se propone lo mismo. Si no, se busca el producto por su código o su nombre. Revisa la cuenta de cada línea antes de guardar.

## Nada se guarda solo

Lo leído es una sugerencia: solo llena los campos que no hayas tocado y nada queda registrado hasta que pulses Guardar. Al guardar, el archivo queda adjunto a la factura como evidencia; puedes abrirlo desde la propia factura.

## Sin IA

Si tu plan no incluye la lectura de documentos, el botón se llama «Adjuntar foto o PDF»: el archivo se guarda con la factura, pero los campos los llenas tú.
