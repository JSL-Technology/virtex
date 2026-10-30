# Avance — auditoría de la ventana de ajuste

Archivo de trabajo. El informe final es `../2026-10-AUDITORIA-VENTANA-DE-AJUSTE.md`.

- [x] Inventario de ventanas de ajuste (código)
- [x] App servida (Postgres 16 y Redis locales, migraciones, seed DEV)
- [x] Ajuste de inventario: flujo completo, efectos, obsoleto, doble envío, fechas, período cerrado, anular, rol restringido, tamaños, tema oscuro, teclado, axe
- [x] Ajuste de auditoría: vacío, validaciones, totales, intento real sobre ejercicio 2019 cerrado (falla 500)
- [x] Configuración › Políticas de inventario: estructura, Escape con cambios, foco, efecto en asiento y restauración
- [x] POS › Ajustes de la caja
- [x] Configuración general: 26 secciones recorridas, cambios sin guardar, permisos, tamaños (añadida a petición)
- [x] Informe final

Pendiente (ver §11 del informe): otro país, ajuste de auditoría con política de aprobación, error de red, sesión expirada, zoom 125/150 %, edición profunda de 24 secciones de Configuración, app de escritorio.

## Ampliación: Configuración general (a petición)

- [x] Lectura del código del modal y de las 26 secciones (más `sessions`, oculta)
- [x] Mediciones de layout por sección (`config-layout.json`) y capturas pliegue a pliegue (`capturas/config/`)
- [x] Modelos de guardado verificados por red (explícito, por fila, autoguardado de IA, aplicación inmediata de densidad); valores restaurados
- [x] Rol restringido, tema oscuro, 1366×768, Atrás y recarga
- [x] Informe `../2026-10-AUDITORIA-CONFIGURACION-GENERAL.md` (CG-01…CG-31)
