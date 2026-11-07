// Los 16 casos de GUA-01: dónde cambiar algo y cómo leerlo. Los usan dirty3.js y exits.js.
const CASES = [
  { id: 'my-profile', label: 'Mi perfil · nombre', saves: true, act: async (p) => { await p.locator('#firstname').click(); await p.keyboard.press('End'); await p.keyboard.type('x'); }, read: (p) => p.locator('#firstname').inputValue() },
  { id: 'account-security', label: 'Seguridad de la cuenta · contraseña', saves: false, act: async (p) => { await p.locator('#currentpassword').fill('algo-escrito'); }, read: (p) => p.locator('#currentpassword').inputValue() },
  { id: 'profile', label: 'Perfil de la empresa · sitio web', saves: true, act: async (p) => { await p.locator('#website').fill('https://ejemplo.do'); }, read: (p) => p.locator('#website').inputValue() },
  { id: 'regional-format', label: 'Formato regional · hora', saves: true, act: async (p) => { const s = p.locator('.sm-section select').last(); const opts = await s.locator('option').evaluateAll((o) => o.map((x) => x.value)); await s.selectOption(opts[opts.length - 1]); }, read: (p) => p.locator('.sm-section select').last().inputValue() },
  { id: 'branding', label: 'Marca · color de acento', saves: true, act: async (p) => { await p.locator('.sm-section .preset').nth(3).click(); }, read: (p) => p.locator('#accentColor').inputValue() },
  { id: 'smtp', label: 'Correo saliente · remitente', saves: true, act: async (p) => { await p.locator('#mail-sender').fill('Virtex Prueba'); }, read: (p) => p.locator('#mail-sender').inputValue() },
  { id: 'security', label: 'Política de seguridad · segundo factor', saves: true, act: async (p) => { await p.locator('.sm-section input[type="checkbox"]').first().click(); }, read: (p) => p.locator('.sm-section input[type="checkbox"]').first().isChecked() },
  { id: 'sso', label: 'SSO · dominio', saves: false, act: async (p) => { await p.locator('#sso-domain').fill('acme.com'); }, read: (p) => p.locator('#sso-domain').inputValue() },
  { id: 'ai', label: 'IA · presupuesto mensual', saves: true, act: async (p) => { await p.locator('#pol-monthly').fill('1234'); }, read: (p) => p.locator('#pol-monthly').inputValue() },
  { id: 'ai', key: 'ai-agents', label: 'IA · límite del agente', saves: true, act: async (p) => { await p.locator('#ag-limit').fill('5000'); }, read: (p) => p.locator('#ag-limit').inputValue() },
  { id: 'accounting-policies', label: 'Políticas contables · plazo de pago', saves: true, act: async (p) => { await p.locator('#ss-defaultPaymentTermDays').fill('15'); }, read: (p) => p.locator('#ss-defaultPaymentTermDays').inputValue() },
  { id: 'fiscal', label: 'Comprobantes fiscales · modalidad', saves: true, act: async (p) => { await p.locator('.mode-choice', { hasText: 'Solo tradicionales' }).click(); }, read: (p) => p.locator('.mode-choice--selected').innerText() },
  { id: 'fiscal', key: 'fiscal-range', label: 'Comprobantes fiscales · rango sin registrar', saves: false, act: async (p) => { await p.locator('#range-authorization').fill('AUT-123'); }, read: (p) => p.locator('#range-authorization').inputValue() },
  { id: 'withholding-regimes', label: 'Retenciones · régimen nuevo', saves: false, act: async (p) => { await p.getByRole('button', { name: 'Agregar régimen' }).first().click(); await p.locator('#w-code').fill('RET-1'); }, read: (p) => p.locator('#w-code').inputValue() },
  { id: 'sequences', label: 'Numeración · prefijo', saves: true, act: async (p) => { const f = p.locator('.sm-section .seq__input').first(); await f.click(); await f.press('End'); await f.type('X'); }, read: (p) => p.locator('.sm-section .seq__input').first().inputValue() },
  // Un editor de registro (como Retenciones): guarda con sus propios botones, no con la barra.
  { id: 'approvals', label: 'Aprobaciones · política nueva', saves: false, act: async (p) => { await p.getByRole('button', { name: 'Nueva política' }).first().click(); await p.locator('#ap-name').fill('Compras grandes'); }, read: (p) => p.locator('#ap-name').inputValue() },
];

module.exports = { CASES };
