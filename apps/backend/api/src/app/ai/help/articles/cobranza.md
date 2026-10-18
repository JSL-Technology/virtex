---
title: Cobranza
route: /collections
---

## Qué muestra

Ventas › Cobranza lista todas las facturas con saldo pendiente que puedes ver (las de tus sucursales), en el orden en que conviene cobrarlas. Cada fila dice la acción sugerida y por qué: saldo grande, poco probable que pague pronto, más de 60 días vencida, promesa incumplida, promesa vigente o contactado hace poco.

## Cómo se ordena

La prioridad combina cuatro cosas:

- el saldo, en la moneda de la empresa;
- la probabilidad de que la factura se pague en 30 días sin hacer nada, tomada del flujo de caja proyectado (cómo paga realmente ese cliente). Si todavía no hay proyección, se estima por la antigüedad de la factura y la pantalla lo indica;
- la antigüedad: cuanto más vencida, más pesa;
- lo que ya se hizo: una promesa incumplida la sube; una promesa vigente o un contacto en los últimos tres días la bajan.

## La acción sugerida

- **Llamar**: hay una promesa incumplida o la factura lleva más de 60 días vencida.
- **Recordatorio firme**: entre 31 y 60 días vencida.
- **Recordatorio**: vencida hasta 30 días.
- **Aviso antes del vencimiento**: vence esta semana y es poco probable que se pague a tiempo.
- **Esperar la promesa** o **Contactado hace poco**: por ahora no hace falta insistir.

## Enviar un recordatorio

Al abrir una factura puedes escribir el mensaje o pedir al asistente que lo redacte en el tono sugerido (cordial, formal o firme). El asistente usa solo las cifras de la factura; si su texto menciona otra cifra, se rechaza. Revisa el mensaje y pulsa «Enviar recordatorio»: sale por correo con el nombre de tu empresa, en el idioma de la factura y con la factura adjunta. También puedes guardarlo como borrador.

El asistente del ERP puede dejar un recordatorio en borrador («redáctale un recordatorio a Tardío SRL»); nunca lo envía: el borrador espera en Cobranza a que alguien lo revise.

## Registrar llamadas y promesas

Registra cada llamada (contestó, no contestó, prometió pagar, disputa la factura…), las promesas de pago con su fecha y, si se acordó, el monto, y cualquier nota. Una promesa cuya fecha pasa con la factura todavía abierta cuenta como incumplida desde el día siguiente.

## Automatizar

En los flujos de trabajo existe el paso automático «Recordatorio de pago»: deja el recordatorio en borrador para revisión o lo envía directamente. Se suele poner detrás de una aprobación.
