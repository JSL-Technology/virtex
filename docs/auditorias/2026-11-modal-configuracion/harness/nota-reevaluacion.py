"""Nota de la reevaluación de la modal de Configuración, con el mismo protocolo que nota.py.

- Fuerza: DEBE pesa 3, DEBERÍA pesa 1.
- Reglas globales (consistencia entre páginas): binarias, 1 o 0.
- Reglas locales: proporción de páginas (o casos) aplicables que cumplen.
- Cumplimiento = suma(peso × puntuación) / suma(pesos evaluados). Nota = 10 × cumplimiento.
- Topes: un hallazgo bloqueante limita la nota a 4; uno alto, a 7.
- Cobertura = reglas evaluadas / reglas del estándar; por debajo del 80 % la nota es provisional.

Cada veredicto cita la medición o la captura que lo sostiene (ver el informe).
"""
W = {'DEBE': 3, 'DEBERÍA': 1}

# (id, fuerza, ámbito, cumplen, aplicables, evidencia)
RULES = [
    ('JER-01', 'DEBE', 'global', 1, 1, 'Miga, título, descripción y alcance en las 25 páginas'),
    ('JER-02', 'DEBE', 'local', 25, 25, 'Un h1 por vista (24/700); ningún h3 mayor que su h2'),
    ('TIP-01', 'DEBE', 'global', 1, 1, 'Dos estilos de título en toda la modal: h2 17/600 y h3 14/600'),
    ('TIP-02', 'DEBERÍA', 'local', 25, 25, 'Ninguna mayúscula sostenida en el contenido (H22, R06)'),
    ('TIP-03', 'DEBE', 'local', 2, 2, 'tabular-nums en las cifras en columna (Plan y facturación, Numeración)'),
    ('ACC-01', 'DEBE', 'local', 25, 25, 'Como máximo una primaria habilitada por página, a 1440 px y en teléfono'),
    ('ACC-02', 'DEBE', 'local', 25, 25, 'Vista previa inerte; sin casillas sin acción; «Ver» en lugar de un «Editar» muerto'),
    ('ACC-03', 'DEBERÍA', 'local', 25, 25, 'Acciones de página en la cabecera (Extensiones incluida)'),
    ('ACC-04', 'DEBE', 'global', 1, 1, 'Confirmación proporcional en restablecer, cerrar sesiones, 2FA, revocar, eliminar'),
    ('GUA-01', 'DEBE', 'local', 16, 16, '16 casos: Escape, la X, el fondo y otra página preguntan; lo escrito se conserva'),
    ('GUA-02', 'DEBERÍA', 'global', 1, 1, 'Un modelo por tipo de cambio, con las excepciones justificadas por escrito'),
    ('GUA-03', 'DEBE', 'global', 1, 1, 'La barra dice por qué no se puede guardar; los editores dicen qué falta'),
    ('CON-01', 'DEBERÍA', 'local', 25, 25, 'Contenedor solo en avisos, vistas previas y opciones elegibles'),
    ('CON-02', 'DEBE', 'global', 1, 1, 'Una anatomía de grupo: vx-settings-group (título y espacio)'),
    ('SOM-01', 'DEBE', 'local', 25, 25, 'Ningún contenedor de contenido con sombra (1440 px y teléfono)'),
    ('RAD-01', 'DEBE', 'global', 1, 1, '6 px en avisos y vistas previas; la muestra de Marca refleja el radio elegido'),
    ('ESP-01', 'DEBE', 'local', 25, 25, '32 px entre grupos, 24 px entre subgrupos; 16 px entre campos (R03)'),
    ('ALI-01', 'DEBE', 'local', 25, 25, 'Desplegable, periodo y ayudas alineados; segmentado y celda de registro (R02, R05)'),
    ('COL-01', 'DEBE', 'global', 1, 1, 'vx-badge con tono por significado; vx-notice para avisos'),
    ('COL-02', 'DEBE', 'global', 1, 1, 'Todo estado lleva texto'),
    ('EST-01', 'DEBE', 'global', 1, 1, '11 estados vacíos, todos vx-empty-state'),
    ('EST-02', 'DEBE', 'global', 1, 1, '23 de 23 páginas aplicables: error con reintento y recuperación; uno solo si fallan varias lecturas (R08)'),
    ('CONT-01', 'DEBE', 'local', 25, 25, 'Ninguna clave cruda ni traducción que falte, en las cinco condiciones'),
    ('CONT-02', 'DEBE', 'local', 25, 25, 'Sin contradicciones ni repeticiones, tampoco en los errores; una sola voz (R07, R08)'),
    ('CONT-03', 'DEBE', 'local', 25, 25, 'Lugares con su nombre y enlazados'),
    ('CONT-04', 'DEBERÍA', 'local', 25, 25, 'Estilo oración'),
    ('FMT-01', 'DEBE', 'global', 1, 1, 'Un formateador de moneda y uno de fecha (corto en datos, largo en frases)'),
    ('FORM-01', 'DEBE', 'local', 15, 15, 'Etiqueta visible en todo campo; un estilo de obligatorio'),
    ('FORM-02', 'DEBERÍA', 'local', 12, 12, 'Ancho por dato desde 640 px; ancho completo en una columna'),
    ('COMP-01', 'DEBE', 'global', 1, 1, 'Un patrón por función: filas, subida, segmentado, desplegable, paginación, diálogo, casilla'),
    ('COMP-02', 'DEBE', 'local', 6, 6, 'Deshabilitado con motivo o botón que dice qué falta'),
    ('A11Y-01', 'DEBE', 'local', 25, 25, 'axe sin fallos de contraste en claro y oscuro'),
    ('A11Y-02', 'DEBE', 'local', 25, 25, 'axe sin fallos de nombre ni etiqueta'),
    ('A11Y-03', 'DEBE', 'local', 25, 25, 'Foco visible siempre; nunca en un elemento invisible (casos de contenedor, en captura)'),
    ('A11Y-04', 'DEBE', 'global', 1, 1, '0 fugas de foco en 25 páginas y en los diálogos'),
    ('A11Y-05', 'DEBE', 'global', 1, 1, 'axe 2.5.8 sin fallos en ambas densidades y en táctil'),
    ('A11Y-06', 'DEBE', 'global', 1, 1, 'Escape cierra solo la capa superior (diálogos incluidos)'),
    ('NAV-01', 'DEBERÍA', 'global', 1, 1, '13 búsquedas con el resultado esperado'),
    ('NAV-02', 'DEBE', 'global', 1, 1, 'Página activa marcada y miga'),
    ('ARQ-01', 'DEBERÍA', 'global', 1, 1, 'Integraciones sin duplicados; la actividad de la IA, en Análisis'),
    ('RESP-01', 'DEBE', 'local', 25, 25, 'A 390 px: sin desbordes ni textos cortados; tablas como lista'),
    ('ANT-01', 'DEBE', 'local', 25, 25, 'Sin rejillas repetitivas ni otros antipatrones de la §10'),
    ('PERM-01', 'DEBE', 'global', 1, 1, '12 de 12 páginas aplicables en solo lectura; las demás nombran el permiso'),
]
MAX_SEVERITY = None  # ningún hallazgo abierto

num = den = 0.0
evaluated = 0
strict_num = 0.0
rows = []
for rid, force, scope, ok, appl, note in RULES:
    w = W[force]
    if ok is None:
        rows.append((rid, force, scope, '—', 'No verificable', note)); continue
    s = ok / appl
    num += w * s; den += w; evaluated += 1
    strict_num += w * (1 if ok == appl else 0)
    verdict = 'Cumple' if ok == appl else ('No cumple' if scope == 'global' else f'Cumple en {ok} de {appl}')
    if scope == 'local' and ok == appl:
        verdict = f'Cumple en {ok} de {appl}'
    rows.append((rid, force, scope, f'{s:.2f}'.replace('.', ','), verdict, note))

base = 10 * num / den
cap = {'bloqueante': 4, 'alta': 7}.get(MAX_SEVERITY, 10)
final = min(base, cap)
coverage = evaluated / len(RULES)
print(f'Puntos: {num:.2f} de {den:.0f}  → cumplimiento {num/den:.1%}  → base {base:.2f}')
print(f'Tope por severidad ({MAX_SEVERITY or "ninguno"}): {cap}  → nota final {final:.1f}')
print(f'Cobertura: {evaluated}/{len(RULES)} = {coverage:.0%}  ({"provisional" if coverage < 0.8 else "definitiva"})')
print(f'Sensibilidad (agregación binaria): {10*strict_num/den:.1f}')
print()
for r in rows: print('| ' + ' | '.join(r) + ' |')
