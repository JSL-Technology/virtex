# Certificados de prueba para e-CF

Certificados **autofirmados** para probar en local la emisión de comprobantes
electrónicos (serie E): subir el certificado, firmar el XML, numerar, contabilizar,
generar el PDF y enviarlo por correo.

> **La DGII no acepta ninguno de estos certificados.** Solo una entidad
> certificadora autorizada puede emitir el certificado válido: a nombre del RNC
> de la empresa o de la cédula de la persona que la empresa autorizó en la
> Oficina Virtual.

| Archivo | Titular | Identificador | Contraseña | Para qué |
|---|---|---|---|---|
| `test-ecf-130456781.p12` | Colmado La Esquina SRL | RNC 130456781 | `virtex-pruebas` | Empresa de las pruebas de QA |
| `test-ecf-131190317.p12` | Empresa de pruebas Virtex | RNC 131190317 | `virtex-pruebas` | RNC de las sondas de `tools/verify` |
| `test-ecf-cedula-00112345673.p12` | Representante de pruebas | Cédula 001-1234567-3 | `virtex-pruebas` | Certificado de persona física autorizada |
| `test-ecf-sin-identificador.p12` | Ferreteria Demo SRL | — | `sonda-ecf` | Caso negativo: debe rechazarse (no identifica al titular) |

## Cómo usarlos

La API rechaza siempre un certificado autofirmado, salvo que se cumplan las dos
condiciones siguientes:

1. El proceso corre en desarrollo o en pruebas (`NODE_ENV=development` o `test`).
2. Existe la variable `ECF_ALLOW_TEST_CERTIFICATES=true`.

En cualquier otro entorno se rechaza aunque la variable esté puesta, así que es
imposible emitir en producción con uno de estos archivos.

Después, en **Ajustes › Facturación electrónica › Certificado digital**, sube el
archivo que corresponda al RNC de tu empresa. Si tu empresa tiene otro RNC,
genera uno para ella:

```bash
node tools/dev/generate-test-ecf-certificate.mjs --rnc <RNC> --name "<Razón social>"
node tools/dev/generate-test-ecf-certificate.mjs --cedula <cédula> --name "<Nombre>"
```

Las claves privadas de estos archivos son públicas a propósito: no protegen nada
y no deben usarse para nada más.
