---
title: Facturas y pedidos que llegan por correo
route: /settings/integrations
---

## Las direcciones

En Configuración › Integraciones, la sección «Correo entrante» crea dos direcciones para tu empresa: una para facturas de proveedor y otra para pedidos de clientes. Se necesita el permiso «Correo entrante». La parte larga de la dirección es su clave: si se filtra, «Cambiar dirección» crea otra y la anterior deja de funcionar al instante. Puedes limitar quién escribe a cada una con una lista de direcciones o de dominios (@proveedor.com). Un correo cuyo dominio de origen dice que es falso (SPF o DKIM fallidos) se descarta.

## Facturas de proveedor

Cada PDF, foto o XML adjunto (CFDI, e-CF, NF-e) se lee con las mismas reglas de tu país que una factura subida a mano. Si el proveedor está registrado con ese identificador fiscal, el número de documento es válido, los totales cuadran, no es un duplicado y cada línea tiene producto o cuenta, se guarda como factura en borrador y se liga a la orden de compra abierta que explica claramente (por total y productos). Si algo está en duda, queda en «Facturas recibidas por correo», en la lista de facturas de proveedor, con el motivo; «Revisar» abre el formulario ya lleno con lo leído y el archivo adjunto. Nada se aprueba ni se contabiliza desde el correo.

## Pedidos de clientes

El cliente se reconoce por su dirección de correo. Los artículos que pide se buscan por código y por nombre en tu catálogo, y el pedido se convierte en una cotización en borrador a precios de catálogo. Lo que no se pudo identificar queda en «Pedidos recibidos por correo», en la lista de cotizaciones, para completarlo. Aprobar la cotización la convierte en pedido; de ahí se factura como siempre.

## Lo que queda registrado

Cada borrador lleva la etiqueta «Recibido por correo y leído por IA» con el mensaje del que vino. En las facturas leídas, la etiqueta dice cuántos campos corrigió una persona antes de guardarla.
