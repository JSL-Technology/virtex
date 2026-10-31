# Recepción de e-CF (receptor electrónico)

Todo emisor electrónico de la DGII es también **receptor**: sus proveedores le envían los e-CF que
le emiten, y él responde con un acuse de recibo firmado (ARECF) y, dentro de tres días hábiles, con
su aprobación o rechazo comercial (ACECF). La certificación ante la DGII ejercita estos servicios, y
el contribuyente debe registrar sus URL en el directorio de facturadores electrónicos.

## Servicios que expone cada empresa

La base es por empresa, con su RNC:

```
https://<dominio>/<prefijo-api>/dgii/<RNC>
```

Por ejemplo, con el prefijo por defecto `api/v1` y el RNC `131234567`:

| Servicio | Método y ruta |
|---|---|
| Semilla | `GET  …/dgii/131234567/fe/autenticacion/api/semilla` |
| Validación de la semilla firmada (token) | `POST …/dgii/131234567/fe/autenticacion/api/validacioncertificado` |
| Recepción de e-CF | `POST …/dgii/131234567/fe/recepcion/api/ecf` |
| Aprobación comercial (de tus clientes sobre lo que emites) | `POST …/dgii/131234567/fe/aprobacioncomercial/api/ecf` |

El XML se acepta como archivo `multipart/form-data` (convención de la DGII) o como cuerpo
`application/xml`. Los servicios son públicos: se autentican como define la DGII —el llamante firma
la semilla con su certificado y recibe un token *Bearer* de una hora— y no usan cookies de sesión.

**Qué hace cada recepción**

- Verifica la firma XMLDSig del e-CF contra el certificado que trae.
- Comprueba que el `RNCComprador` sea la empresa.
- Guarda el XML íntegro (documento legal) con emisor, e-NCF, fecha, ITBIS y total.
- Responde siempre con un **ARECF firmado** con el certificado de la empresa: `Estado 0` (recibido)
  o `Estado 1` con `CodigoMotivoNoRecibido`: 1 error de especificación, 2 error de firma, 3 envío
  duplicado, 4 RNC comprador no corresponde.

Un ACECF que llega a `aprobacioncomercial` marca el documento emitido como aprobado o rechazado por
su comprador (`ecf_submissions.commercial_status`).

## En el producto

*Contabilidad › Comprobantes recibidos* lista lo recibido con su plazo de respuesta (3 días
hábiles). **Aceptar** o **Rechazar** (con motivo) firma y envía el ACECF a la DGII y deja el
veredicto registrado. El XML se descarga desde la misma lista.

## Requisitos para activarlo

1. La empresa es dominicana (`country = DO`) y su RNC está registrado en la organización.
2. Tiene un **certificado digital activo** (Configuración › Fiscal): con él se firman los ARECF.
3. El API está publicado en HTTPS en un dominio estable (ver `docs/DEPLOYMENT.md`).
4. Registrar las URL anteriores en el **directorio de facturadores electrónicos** de la DGII
   (Oficina Virtual) durante el proceso de certificación.

## Verificación

`npm run verify:ecf-receptor` (en CI) recorre el ciclo completo por HTTP real entre dos empresas:
semilla → token, recepción con ARECF firmado, duplicado (3), firma alterada (2), comprador
equivocado (4), aprobación comercial de vuelta y aislamiento entre inquilinos.

> *Verificar con la DGII:* los nombres de elementos siguen los formatos ARECF/ACECF publicados. El
> set de pruebas de certificación nombra cualquier elemento que no coincida: esa corrida es la
> prueba de conformidad definitiva.
