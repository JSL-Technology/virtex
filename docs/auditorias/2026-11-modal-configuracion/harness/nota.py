"""Cálculo de la nota de la modal de Configuración con el protocolo del estándar v0.1.

- Fuerza: DEBE pesa 3, DEBERÍA pesa 1.
- Reglas globales (consistencia entre páginas): binarias, 1 o 0.
- Reglas locales: proporción de páginas aplicables que cumplen.
- Cumplimiento = suma(peso × puntuación) / suma(pesos evaluados). Nota = 10 × cumplimiento.
- Topes: un hallazgo bloqueante limita la nota a 4; uno alto, a 7.
- Cobertura = reglas evaluadas / reglas aplicables; por debajo del 80 % la nota es provisional.
"""
W = {'DEBE': 3, 'DEBERÍA': 1}

# (id, fuerza, ámbito, cumplen, aplicables, nota)  — None = no verificable
RULES = [
    ('JER-01', 'DEBE', 'global', 1, 1, 'Cabecera común en las 25 páginas'),
    ('JER-02', 'DEBE', 'local', 20, 25, 'Mi perfil, Seguridad de la cuenta, Cuentas predeterminadas, Políticas contables, Integraciones'),
    ('TIP-01', 'DEBE', 'global', 0, 1, 'Seis estilos para el título de grupo'),
    ('TIP-02', 'DEBERÍA', 'local', 23, 25, 'Mi perfil, Plan y facturación'),
    ('TIP-03', 'DEBE', 'local', 1, 2, 'Plan y facturación'),
    ('ACC-01', 'DEBE', 'local', 19, 25, 'Seguridad de la cuenta, Comprobantes fiscales; duplicadas: Estructura, Sucursales, Retenciones, Aprobaciones'),
    ('ACC-02', 'DEBE', 'local', 24, 25, 'Marca de la empresa'),
    ('ACC-03', 'DEBERÍA', 'local', 24, 25, 'Extensiones'),
    ('ACC-04', 'DEBE', 'global', 1, 1, 'Restablecer marca, cerrar sesiones, exigir 2FA'),
    ('GUA-01', 'DEBE', 'local', 8, 10, 'Correo saliente, Inteligencia artificial'),
    ('GUA-02', 'DEBERÍA', 'global', 0, 1, 'Cuatro modelos de guardado'),
    ('GUA-03', 'DEBE', 'global', 1, 1, 'La barra dice por qué no se puede guardar'),
    ('CON-01', 'DEBERÍA', 'local', 14, 25, '11 páginas con tarjetas innecesarias o anidadas'),
    ('CON-02', 'DEBE', 'global', 0, 1, 'Cuatro anatomías de tarjeta'),
    ('SOM-01', 'DEBE', 'local', 8, 25, '17 páginas con sombra en contenido'),
    ('RAD-01', 'DEBE', 'global', 0, 1, 'Radios de 6, 9,6 y 13,8 px en tarjetas'),
    ('ESP-01', 'DEBE', 'local', 23, 25, 'Seguridad de la cuenta y Perfil de la empresa: 0 px entre tarjetas'),
    ('ALI-01', 'DEBE', 'local', 22, 25, 'Seguridad de la cuenta, Inteligencia artificial, Pista de auditoría'),
    ('COL-01', 'DEBE', 'global', 0, 1, '«Activa» neutro frente a verde; avisos gris frente a amarillo'),
    ('COL-02', 'DEBE', 'global', 1, 1, 'Todo estado lleva texto'),
    ('EST-01', 'DEBE', 'global', 0, 1, 'Cuatro patrones de estado vacío'),
    ('EST-02', 'DEBE', 'global', None, 1, 'No se simularon fallos de red'),
    ('CONT-01', 'DEBE', 'local', 24, 25, 'Inteligencia artificial'),
    ('CONT-02', 'DEBE', 'local', 20, 25, 'Preferencias, Política de seguridad, Aprobaciones, Numeración, SSO'),
    ('CONT-03', 'DEBE', 'local', 24, 25, 'Comprobantes fiscales'),
    ('CONT-04', 'DEBERÍA', 'local', 24, 25, 'Plan y facturación'),
    ('FMT-01', 'DEBE', 'global', 0, 1, 'Moneda en tres formatos'),
    ('FORM-01', 'DEBE', 'local', 11, 14, 'Comprobantes fiscales, SSO, Extensiones'),
    ('FORM-02', 'DEBERÍA', 'local', 10, 12, 'Mi perfil, Correo saliente'),
    ('COMP-01', 'DEBE', 'global', 0, 1, 'Acciones de fila, subida de archivos, segmentados y desplegables distintos'),
    ('COMP-02', 'DEBE', 'local', 5, 6, 'SSO'),
    ('A11Y-01', 'DEBE', 'local', 23, 25, 'Mi perfil y Marca (tema oscuro)'),
    ('A11Y-02', 'DEBE', 'local', 23, 25, 'Usuarios, Seguridad de la cuenta'),
    ('A11Y-03', 'DEBE', 'local', 22, 25, 'Seguridad de la cuenta, Mi perfil, Marca'),
    ('A11Y-04', 'DEBE', 'global', 1, 1, '0 fugas de foco en 25 páginas'),
    ('A11Y-05', 'DEBE', 'global', 1, 1, 'axe 2.5.8 sin fallos en ambas densidades'),
    ('A11Y-06', 'DEBE', 'global', 1, 1, 'Escape cierra solo la capa superior'),
    ('NAV-01', 'DEBERÍA', 'global', 0, 1, '«firma» e «impuestos» no llevan a todas sus páginas'),
    ('NAV-02', 'DEBE', 'global', 1, 1, 'Sección activa marcada y miga'),
    ('ARQ-01', 'DEBERÍA', 'global', 0, 1, 'Integraciones duplica accesos; IA aloja operación'),
    ('RESP-01', 'DEBE', 'local', 23, 25, 'Usuarios, Roles y permisos'),
    ('ANT-01', 'DEBE', 'local', 24, 25, 'Integraciones (rejilla 3 + 1)'),
    ('PERM-01', 'DEBE', 'global', None, 1, 'El usuario de prueba tiene todos los permisos'),
]
MAX_SEVERITY = 'alta'  # la más alta encontrada

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
    rows.append((rid, force, scope, f'{s:.2f}', verdict, note))

base = 10 * num / den
cap = {'bloqueante': 4, 'alta': 7}.get(MAX_SEVERITY, 10)
final = min(base, cap)
coverage = evaluated / len(RULES)
print(f'Puntos: {num:.2f} de {den:.0f}  → cumplimiento {num/den:.1%}  → base {base:.2f}')
print(f'Tope por severidad ({MAX_SEVERITY}): {cap}  → nota final {final:.1f}')
print(f'Cobertura: {evaluated}/{len(RULES)} = {coverage:.0%}  ({"provisional" if coverage < 0.8 else "definitiva"})')
print(f'Sensibilidad (agregación binaria): {10*strict_num/den:.1f}')
print()
for r in rows: print('| ' + ' | '.join(r) + ' |')
