# Configuración de Segmentos de Cuenta

Este documento detalla el funcionamiento y flujo de configuración de la estructura de segmentos para el Catálogo de Cuentas (Chart of Accounts).

## Concepto
El sistema utiliza una estructura de segmentos definida por organización para validar y construir los códigos de las cuentas contables. Por ejemplo, una estructura de 4 niveles (1-2-2-3) produciría códigos como `1-10-05-001`.

## Flujo de Configuración

### 1. Inicialización Automática
Cuando se crea una nueva organización o subsidiaria a través del `OrganizationsService`, el sistema inicializa automáticamente una estructura por defecto:
- **Nivel 1:** Longitud 1
- **Nivel 2:** Longitud 2
- **Nivel 3:** Longitud 2
- **Nivel 4:** Longitud 3

### 2. Configuración Manual (UI)
Los administradores pueden acceder a la pantalla de configuración en:
`Configuración > Contabilidad > Estructura de Segmentos`
(URL: `/accounting/chart-of-accounts/segments-configuration`)

**Restricciones:**
- Solo se puede modificar la estructura si **no existen cuentas creadas** para la organización. Esto es para prevenir inconsistencias en los datos históricos.

### 3. Onboarding de Organizaciones Existentes
Para organizaciones que no tienen una estructura definida, el sistema muestra un banner informativo en el formulario de creación de cuentas con un acceso directo a la configuración.

## Referencia de API

### Obtener definiciones
`GET /api/v1/chart-of-accounts/segment-definitions`

### Configurar estructura
`POST /api/v1/chart-of-accounts/segment-definitions`
Body:
```json
{
  "segments": [
    { "name": "Nivel 1", "length": 1, "isRequired": true },
    { "name": "Nivel 2", "length": 2, "isRequired": true }
  ]
}
```

### Inicializar valores por defecto (Idempotente)
`POST /api/v1/chart-of-accounts/segment-definitions/initialize`

## Resolución de Problemas
Si aparece el error: *"La estructura de segmentos de cuenta no ha sido configurada"*, diríjase a la pantalla de configuración y presione "Cargar Plantilla" o defina sus propios niveles.
