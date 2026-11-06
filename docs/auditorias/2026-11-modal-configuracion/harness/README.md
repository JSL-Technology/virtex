# Arnés de la evaluación de la modal de Configuración

Scripts con los que se obtuvo cada medición y captura del informe
[`../../2026-11-EVALUACION-MODAL-CONFIGURACION.md`](../../2026-11-EVALUACION-MODAL-CONFIGURACION.md).
Escriben en `../salida/`, que no se versiona.

## Requisitos

- La aplicación servida en local: API en `:3000` con `DEV_SEED=true` y cliente en `:4200`
  (ver el `README.md` de la raíz).
- Playwright con Chromium disponible para `require('playwright')`.
- `node_modules` instalado en la raíz (se usan `axe-core` y `sharp`).

## Orden

```bash
export VX_PASS='<la DEV_SEED_PASSWORD con la que arrancó la API>'
node run.js login        # guarda la sesión en state.json (no se versiona)
node run.js base         # 25 páginas: mediciones, axe (WCAG 2.2 AA) y capturas por desplazamiento
node run.js dark         # tema oscuro
node run.js laptop       # 1366 × 768
node run.js phone        # 390 × 844, modo compacto
node run.js density      # densidad compacta
node run.js focus        # 80 tabulaciones por página: fugas, foco visible, elementos invisibles
node run.js search       # buscador
node run.js dirty        # protección de cambios sin guardar (campo de texto)
node dirty2.js           # protección de cambios en páginas sin campo de texto simple
node ai-autosave.js      # cuándo guarda la página de Inteligencia artificial
node evidence.js         # capturas de evidencia con el elemento señalado
python3 nota.py          # cálculo de la nota con la fórmula del protocolo
```

La sesión caduca por la rotación del token de refresco: si un paso no encuentra la modal,
vuelve a ejecutar `node run.js login`.

`dirty2.js` y `ai-autosave.js` escriben en la página y la restauran (el presupuesto de IA vuelve
a su valor). Ningún script guarda cambios de configuración.
