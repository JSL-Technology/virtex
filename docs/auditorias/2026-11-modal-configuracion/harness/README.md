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

## Reevaluación

Pasos de la reevaluación
([`../../2026-11-REEVALUACION-MODAL-CONFIGURACION.md`](../../2026-11-REEVALUACION-MODAL-CONFIGURACION.md)).
Escriben en la misma `../salida/`.

```bash
export VX_PASS='<la DEV_SEED_PASSWORD con la que arrancó la API>'
node final-run.js        # pasada completa: cada fase con su propio inicio de sesión
                         #   run.js base|dark|laptop|phone|density|focus|search,
                         #   dirty3.js, exits.js, est02.js, perm01.js, after.js y dialogs.js
node rerun-pages.js a,b  # repite todas las fases para unas páginas y combina los resultados
node analyze.js          # resumen regla por regla de las mediciones
node tables.js           # tablas de EST-02, PERM-01 y GUA-01 para el informe
python3 nota-reevaluacion.py
```

Qué hace cada script:

| Script | Qué hace |
|---|---|
| `gua-cases.js` | Los 16 casos de GUA-01: dónde cambiar algo y cómo leerlo |
| `dirty3.js` | GUA-01 en 16 casos: un cambio, Escape, «Seguir editando», cerrar con la X y descartar |
| `exits.js` | GUA-01, las otras dos salidas: un clic en el fondo y otra página de la barra lateral |
| `dialogs.js` | Diálogos de Roles y Usuarios: axe, foco atrapado, Escape y foco inicial |
| `est02.js` | EST-02: las peticiones de datos de la página fallan como sin red; busca el error con «Reintentar» y que reintentar con la red sana recupere la página |
| `perm01.js` | PERM-01: sustituye la sesión por una con todos los permisos de lectura (`view-permissions.json` menos los de gestión) y cuenta los controles que cambian algo |
| `after.js` | Capturas «después» a doble densidad, con lo corregido señalado en verde y las comprobaciones en `after-log.json` |
| `dialogs.js --before` | Las mismas comprobaciones de diálogos sobre el código anterior, con capturas en rojo |
| `annotate.py` | Señala en rojo los defectos en las capturas «antes» de los hallazgos nuevos |
| `optimize.py` | Reduce el peso de las capturas publicadas (paleta de 256 colores, sin tramado) |
| `wait-api.js`, `wait-build.js` | Esperan a que la API responda o a que el servidor de desarrollo termine de compilar |

`est02.js` corta solo las peticiones de datos de la página, y deja pasar la sesión, las
traducciones y los recursos estáticos. `perm01.js` no toca el servidor: solo cambia la sesión que
ve el cliente. Ningún script guarda cambios de configuración.
