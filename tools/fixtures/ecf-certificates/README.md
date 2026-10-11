# Certificados de prueba para comprobantes electrónicos

Certificados **autofirmados** para probar en local la emisión de comprobantes
electrónicos en cualquier mercado con régimen: subir el certificado, firmar el
documento, numerar, contabilizar, generar el PDF y enviarlo por correo.

> **Ninguna autoridad fiscal acepta estos certificados** (DGII, SAT, DIAN,
> SUNAT, SRI, SII, AFIP, Receita Federal). Solo una entidad certificadora
> autorizada emite el certificado válido: a nombre del identificador fiscal de
> la empresa o, donde la ley lo permite (República Dominicana, Chile, Ecuador),
> de la persona que la empresa autorizó.

Todos vencen a los 10 años de generados.

| Archivo | País | Titular | Identificador | Contraseña | Para qué |
|---|---|---|---|---|---|
| `test-ecf-do-130456781.p12` | RD | Colmado La Esquina SRL | RNC 130456781 | `virtex-pruebas` | Empresa de las pruebas de QA |
| `test-ecf-do-131190317.p12` | RD | Empresa de pruebas Virtex | RNC 131190317 | `virtex-pruebas` | RNC de las sondas de `tools/verify` |
| `test-ecf-do-101010632.p12` | RD | Distribuidora del Cibao SRL | RNC 101010632 | `virtex-pruebas` | Caso negativo: certificado de otra empresa |
| `test-ecf-do-persona-00112345673.p12` | RD | Laura Martínez | Cédula 001-1234567-3 | `virtex-pruebas` | Certificado de la persona autorizada |
| `test-ecf-mx-eku9003173c9.p12` | MX | Escuela Kemper Urgate | RFC EKU9003173C9 | `virtex-pruebas` | CSD de prueba (RFC de pruebas del SAT) |
| `test-ecf-co-900373913.p12` | CO | Comercializadora Andina SAS | NIT 900373913-4 | `virtex-pruebas` | Certificado sin dígito de verificación |
| `test-ecf-sin-identificador.p12` | RD | Ferreteria Demo SRL | — | `sonda-ecf` | Caso negativo: no identifica al titular |

## Cómo usarlos

La API rechaza siempre un certificado autofirmado, salvo que se cumplan las dos
condiciones siguientes:

1. El proceso corre en desarrollo o en pruebas (`NODE_ENV=development` o `test`).
2. Existe la variable `ECF_ALLOW_TEST_CERTIFICATES=true`.

En cualquier otro entorno se rechaza aunque la variable esté puesta, así que es
imposible emitir en producción con uno de estos archivos.

Después, en **Ajustes › Comprobantes fiscales › Certificado digital**, sube el
archivo que corresponda al identificador fiscal de tu empresa. El certificado
se guarda para el régimen del país de la empresa. Si tu empresa tiene otro
identificador, genera uno para ella:

```bash
node tools/dev/generate-test-ecf-certificate.mjs --country DO --tax-id <RNC> --name "<Razón social>"
node tools/dev/generate-test-ecf-certificate.mjs --country DO --tax-id <cédula> --name "<Nombre>" --person
node tools/dev/generate-test-ecf-certificate.mjs --country MX --tax-id <RFC> --name "<Razón social>"
node tools/dev/generate-test-ecf-certificate.mjs --country CO --tax-id <NIT> --name "<Razón social>"
```

Opciones: `--password` (por defecto `virtex-pruebas`), `--days` (por defecto
365) y `--out` (por defecto `test-ecf-<país>-<identificador>.p12`).

Las claves privadas de estos archivos son públicas a propósito: no protegen nada
y no deben usarse para nada más.
