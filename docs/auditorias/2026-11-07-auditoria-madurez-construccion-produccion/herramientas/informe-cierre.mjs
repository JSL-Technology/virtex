import fs from 'node:fs';
const r=JSON.parse(fs.readFileSync('/tmp/claude-0/v/findings.json','utf8'));
const A='apps/backend/api/src/app';
const R=(c,e)=>({st:'RESUELTO',c,e}); const P=(c,e,f)=>({st:'PARCIAL',c,e,f}); const W=(e)=>({st:'EN CURSO',c:'—',e});
const M={
'PLTB-DT-01':R('017fa1d5','`package.json`: `"electron": "45.2.3"` (versión exacta, sin `^`); `package-lock.json` resuelve electron-45.2.3.'),
'PLTB-DT-02':R('017fa1d5','`apps/desktop/electron-builder.config.cjs` (`forceCodeSigning` en modo release, firma Azure/notarización), `apps/desktop/src/updater.js` (verifica la declaración Ed25519 antes de descargar), `.github/workflows/desktop-release.yml`. La firma real requiere los certificados del cliente en los secretos del repositorio.'),
'PLTB-DT-03':R('017fa1d5','`apps/desktop/src/security-policy.js` + `main.js`: CSP base inyectada con `onHeadersReceived`.'),
'IAM-T2':R('4b930dfc','Migración `1789410000000-SameTenantGuardCustomerPortal.ts` (`SELECT virtex_install_same_tenant_guards()`); `same-tenant-references.spec.ts` en verde.'),
'CS-01':R('4b930dfc','Mismo arreglo que IAM-T2 (guarda de mismo inquilino en `FK_customer_portal_accounts_customer`).'),
'NOM-41':R('4b930dfc','Mismo arreglo que IAM-T2.'),
'FE-CI-03':R('4b930dfc','`config/external-effects.ts` (`EXTERNAL_EFFECTS`, `none` por defecto fuera de producción); `dgii-transport`, `dgii-auth`, `regime-transport`, `pac.provider` y el reconciliador respetan el interruptor.'),
'FAC-EINV-02':R('4b930dfc','Igual que FE-CI-03; `config/external-effects.spec.ts`.'),
'FAC-EINV-03':R('4b930dfc','node-forge 1.4.3 en `package-lock.json`; `certificate-trust.ts` corregido (`issuer.issued(subject) && issuer.verify(subject)`); `certificate-trust.spec.ts` compila y pasa.'),
'FE-CI-01':P('4b930dfc, 4f411a27, 94a20869','En la rama, todos los pasos de CI pasan salvo los que yo rompí y ya corregí (`verify:boundaries` en 4f411a27, `check:schema-drift` en 94a20869).','`main` sigue en rojo hasta que se fusione la rama; falta confirmar el CI verde del último commit y la protección de rama, que se configura en GitHub y no desde el repositorio.'),
'PLT-NOT-01':R('471e0e3e','`push-notifications/push-endpoint.ts` (lista de servicios push permitidos), `dto/push-subscription.dto.ts`, controlador transaccional, `push-subscription.spec.ts`. Reproducido en vivo: 201 antes, 400 después.'),
'PLT-NOT-05':R('471e0e3e','Migración `1789420000000-PushSubscriptionHardening.ts`: índice `UQ_push_subscription_endpoint`.'),
'PLTB-DS-01':R('471e0e3e','`datasheets/controllers/datasheets.controller.ts` usa `UuidParamPipe` en todas las rutas `:id`.'),
'PLTB-DS-02':R('471e0e3e','`datasheets/dto/datasheet-book.dto.ts` (DTO con lista blanca); el servicio copia columna por columna; `datasheet-book-isolation.spec.ts` (además cerró el robo de libros entre inquilinos hallado al verificar). Verificador `tools/verify/body-dto.mjs`.'),
'FAC-CMP-01':R('8b1ee726','`compliance.service.ts` `tillFiscalSales` usa `"createdAt"`/`"paymentMethod"`; `compliance-till-sales.spec.ts` contra el esquema real. 607/608 generados en vivo.'),
'INV-01':R('8b1ee726','Es el mismo hallazgo que FAC-CMP-01: `tillFiscalSales` corregido; `compliance-till-sales.spec.ts` contra el esquema migrado.'),
'FAC-INV-01':R('8b1ee726','`saas/repositories/usage-metric.repository.ts`: `INSERT … ON CONFLICT DO NOTHING` + `UPDATE` condicional (ya no aborta la transacción); `issueWithin` no cobra cupo a la nota de crédito. Verificado en vivo: NC con cupo agotado → 201.'),
'FAC-INV-02':R('8b1ee726','`usage-metric.repository.spec.ts`: 20 llamadas concurrentes con límite 10 → exactamente 10 aceptadas, sin 500.'),
'PLT-DT-01':P('8b1ee726','La causa raíz (el límite del plan abortaba la transacción → 500) está corregida en `usage-metric.repository.ts`.','No se valida el cupo antes del commit ni se persiste una ejecución PARTIAL; la importación sigue siendo fila a fila.'),
'SP-11':P('8b1ee726','La causa raíz citada (FAC-INV-01) está corregida.','El resto del módulo saas-payment (IAM-P2/P3/P4) sigue pendiente.'),
'TES-01':R('e6bcf4d4','`customer-payments.service.ts`: rechaza un cobro cuya moneda difiere de la de la factura (`customers.receipt_currency_differs_from_invoice`); filtrado por moneda en `form.page.ts`; 2 pruebas nuevas en `customer-payments.spec.ts`.'),
'TES-02':R('e6bcf4d4','`push()` en `customer-payments.service.ts` registra `currencyCode`, `foreignCurrencyDebit/Credit` y `exchangeRate` en las líneas de banco, CxC y anticipo.'),
'FINB-01':R('e87dd8a0','`currency-revaluation.service.ts`: cuentas monetarias por rol + bancos + multimoneda, posiciones por (cuenta, moneda) vía `foreignPositionsAsOf`, error si falta la tasa de cierre o la cuenta de diferencia cambiaria; `period-close.spec.ts`.'),
'FIN-AC-03':P('e87dd8a0','La revaluación ya no depende de `isMultiCurrency`: incluye cuentas monetarias por rol y los mayores de los bancos.','No se rechaza aún un asiento en divisa sobre una cuenta no multimoneda, ni hay alerta en el checklist de saldos sin revaluar.'),
'LOC-01':R('4909944d','`localization/fiscal/country-tax-schemes.ts` (`noRegistrationMeansNoTax`, solo US) y `tax-determination.service.ts` (NO_NEXUS → NOT_DETERMINABLE fuera de US); prueba BR en `tax-determination.spec.ts`. Vista previa BR bloqueada en vivo.'),
'IA-B01':R('b012b456','`dashboard.service.ts`: EBITDA = resultado operativo + depreciación; `dashboard-kpis.spec.ts` (EBITDA 40.000 frente a utilidad neta 24.000).'),
'IA-B03':R('b012b456','`dashboard-charts.service.ts`: excluye borradores y anuladas, resta las notas de crédito, «hoy» en la zona horaria del inquilino.'),
'IA-B04':P('b012b456','Margen, ROA y EBITDA se calculan sobre el ejercicio en curso sin asientos de cierre (`excludeClosingEntries`).','El ROE sigue usando activos − pasivos (`dashboard.service.ts`, `getROE`) en lugar del patrimonio contable, y la UI conserva rótulos comparativos sin dato (`kpi-fcf.ts`: `vs_budget`).'),
'XF-09':R('a3f55f52','`journal-entries.service.ts` `rate()` con 6 decimales; `numericTransformerWithDefault`; migración `1789430000000-RestoreFxRateTolerance.ts` (22/22 organizaciones de desarrollo restauradas a 0,02); `stated-rate-tolerance.spec.ts`, `journal-entry-rate.spec.ts`.'),
'FINB-02':R('a3f55f52','Mismo arreglo que XF-09: `fx_rate_tolerance` vuelve a tomar el DEFAULT 0,02; el verificador `numeric-transformers` detecta la regresión.'),
'FAC-PL-01':R('7e3640e0, 94a20869','`price-lists/price-resolver.service.ts` usado por `invoices.service.ts`, `quotes.service.ts` y `pos.service.ts`; `customers.price_list_id`; `POST /price-lists/resolve`; `price-resolver.spec.ts` contra PostgreSQL. En vivo: 12 u a 70 = 840 frente a 99,995 de catálogo.'),
'FAC-PL-02':R('7e3640e0','`price-lists.service.ts`: `roundAmount(item.price, 6)`; columna `numeric(18,6)`.'),
'FAC-PL-03':R('7e3640e0','`dto/create-price-list.dto.ts`: `@Matches(/^[A-Za-z]{3}$/)` (`validation.currency_code`).'),
'FAC-PL-04':R('7e3640e0','`price-lists/price-resolver.spec.ts` (8 pruebas, unitarias y contra PostgreSQL).'),
'FE-CI-07':P('017fa1d5, 4b930dfc','Corregidas las vulnerabilidades altas citadas de node-forge y electron; puerta de auditoría solo para el escritorio (`tools/desktop/audit-gate.mjs`).','`npm audit` no es una puerta para el monorepo completo; @angular/router y el resto siguen sin revisar.'),
'SP-01':P('varios','Conectados: listas de precios, revaluación.','Siguen «construidos pero no conectados»: estados comparativos, consolidación, landed cost, manufactura, regímenes de e-factura (en curso).'),
'FAC-EINV-01':R('f43ade93','`einvoicing/services/fiscal-submission.service.ts` (outbox `fiscal_submissions` registrado en la transacción de emisión, toma atómica con concesión, estados explícitos, backoff), `fiscal-submission.reconciler.ts` (cron con bloqueo), `invoices.service.ts` (registro + envío tras commit; bloqueo `invoices.transmission_not_configured`), detalle de factura con estado y reintento; `fiscal-submission.spec.ts` contra PostgreSQL (carrera de 3 workers → 1 envío). La transmisión real exige el certificado y el contrato de cada contribuyente (verificar con contador/abogado local).'),
'FAC-EINV-04':R('f43ade93','`einvoicing/services/transmission-config.service.ts`: endpoint y credencial por empresa en `fiscal_regime_settings`, credencial cifrada (`CryptoUtil`, `select:false`), step-up `manage_fiscal_credentials`, HTTPS público comprobado al guardar y en cada conexión (`common/net/outbound-address.ts`); variables de proceso solo con `EINVOICE_PROCESS_CREDENTIALS=allow`; `transmission-config.spec.ts`. Verificado en vivo.'),
'FINB-30':R('958cf094','`consolidation/group-eliminations.ts` (`splitSubsidiaryEquity`: inversión contra patrimonio preadquisición, plusvalía a tipo de cierre NIC 21.47, NCI proporcional, compra ventajosa NIIF 3.34) y `consolidation.service.ts` (el patrimonio de la subsidiaria se sustituye; patrimonio = suma de líneas; cuadre real). Pruebas con ejemplo resuelto y contra PostgreSQL.'),
'FINB-31':R('958cf094','`eliminateIntercompanyFunding`: CxC/CxP intercompañía (no la caja), saldos acumulados a la fecha desde los asientos de cada lado; residuo a la diferencia de conversión con aviso. Prueba de integración.'),
'FINB-32':R('958cf094','`eliminateIntragroupTrade`: ventas entre miembros (por identificador fiscal) eliminadas de ingresos y costo, más CxC/CxP abiertas; aviso de discrepancia y de margen no realizado en inventario (verificar con contador). Prueba de integración.'),
'FINB-33':R('958cf094','`features/accounting/consolidation/` (página con estados, eliminaciones como asientos, avisos, empresas y corridas guardadas) y entrada de menú en `contabilidad.manifest.ts`; `consolidation.page.spec.ts`.'),
'FINB-34':R('958cf094','Lo posterior a la adquisición se convierte al promedio desde la adquisición (no al histórico); la diferencia de conversión se acumula por corrida en `consolidation_runs` (migración 1789460000000, solo inserción). El promedio sigue siendo la media de cierres mensuales, aproximación que NIC 21.22 permite.'),
'FINB-35':R('958cf094','`OrganizationsService.linkSubsidiary` + `POST /organizations/subsidiaries/link` (step-up, propietario, administrador de ambas empresas, sin ciclos ni doble control, cupo del plan) y diálogo en Ajustes › Subsidiarias; `subsidiary-link.spec.ts`.'),
'FIN-COA-03':R('aeabe621','`localization/fiscal/coa-builder.ts`: plan base neutro + paquetes por país (`COA_COUNTRY_PACKS`: DO, MX con código agrupador SAT de primer nivel, CO, EC, CR); `COUNTRY_SPECIFIC_COA_TERMS`; `coa-country-packs.spec.ts` (19 mercados sin vocabulario ajeno). Migración `1789470000000-NeutralChartOfAccounts.ts` (roles, columnas, nombres sin editar fuera de DO, código agrupador MX) probada contra PostgreSQL en `database/neutral-chart-of-accounts.migration.spec.ts`. `verify:markets` con aserciones de contenido: 19/19 en verde. Verificar con contador local.'),
'LOC-02':R('aeabe621','Mismo arreglo que FIN-COA-03: roles neutros `PENSION_/HEALTH_/OTHER_PAYROLL_CONTRIBUTIONS_PAYABLE`, columnas `default_*_contributions_payable_account_id`, propina solo donde `serviceChargeRate > 0`, ISC/IEPS/ICE/INC por paquete.'),
'I18N-05':R('aeabe621','`chart-of-accounts.service.ts` (`booksLanguage`: nombre guardado bajo el idioma de los libros o del país; la edición conserva las otras traducciones), `principalTaxName` en portugués para BR, migración 1789470000000 (re-clave de BR/US), `verify:markets` comprueba la clave de idioma.'),
'CMP-16':R('aeabe621','`IdentityDocumentService.inferType`: sin tipo, el documento se reconoce por patrón y dígito verificador entre los tipos del país; `identity-document-inference.spec.ts` contra PostgreSQL (RNC 131246796 → RNC; cédula válida → CEDULA; inválido sigue rechazado; el tipo explícito manda).'),
'LOC-04':P('aeabe621','31 claves genéricas neutras en es/en/pt; el término dominicano en `regional/es-DO.json` (CNPJ/CPF en `pt-BR.json`). Las claves de flujos solo DO se mantienen (el backend ya las limita al país).','Las claves `ledger.payroll.afp_payable/sfs_payable/infotep_payable` siguen nombrando la TSS; se retiran con JUR-01.'),
'I18N-02':P('aeabe621','Igual que LOC-04.','Igual que LOC-04: `ledger.payroll.*` con nombres de la TSS, pendiente de JUR-01.'),
'SP-02':W('Hecho en aeabe621: FIN-COA-03, LOC-02, CMP-16, I18N-05 y verificador de contenido en `verify:markets`; LOC-04/I18N-02 parciales. Falta: LOC-03 (requisitos de emisión por país y aviso «no es comprobante fiscal»), JUR-01 (contribuciones como lista con código libre) y JUR-02.'),
};
const isRef=x=>!x.sev && /^(XF-(\d+|W\d|US-W\d)|FAC-[123])$/.test(x.id) && x.id!=='XF-09';
const isInfo=x=>/positivo|informativo/i.test(x.text) && !M[x.id];
const sevNorm=s=>{if(!s)return '—';s=s.toLowerCase();if(s.startsWith('cr'))return 'Crítica';if(s.startsWith('alt'))return 'Alta';if(s.startsWith('med'))return 'Media';if(s.startsWith('baj'))return 'Baja';return s;};
const rows=r.map(x=>{let s=M[x.id]; if(!s){ if(isRef(x)) s={st:'NO ES HALLAZGO',e:'Etiqueta de paso o de documento de prueba en el flujo cruzado.'}; else if(isInfo(x)) s={st:'INFORMATIVO',e:'Hallazgo positivo / sin acción requerida.'}; else s={st:'PENDIENTE',e:''};} return {...x,sevN:sevNorm(x.sev),...s};});
const order={'Crítica':0,'Alta':1,'Media':2,'Baja':3,'—':4};
rows.sort((a,b)=>(order[a.sevN]??5)-(order[b.sevN]??5)||a.id.localeCompare(b.id));
const count={};for(const x of rows){count[x.st]=(count[x.st]||0)+1;}
const bySev={};for(const x of rows){const k=x.sevN+'|'+x.st;bySev[k]=(bySev[k]||0)+1;}
const esc=s=>String(s).replace(/\|/g,'\\|');
let md=`# Verificación de cierre de hallazgos (2026-11-08)\n\n`;
md+=`Cada identificador que aparece en los MD de la auditoría (\`docs/auditorias/2026-11-07-auditoria-madurez-construccion-produccion/\`), con la línea que lo define (cita del MD) y su estado verificado contra el código y los commits de la rama \`ccr-f710ff5b-8ijix4\`.\n\n`;
md+=`**Respuesta: no está todo resuelto.** De ${rows.length} identificadores: `+Object.entries(count).map(([k,v])=>`${v} ${k.toLowerCase()}`).join(', ')+`.\n\n`;
md+=`## Resumen por severidad\n\n| Severidad | Resuelto | Parcial | En curso | Pendiente | Informativo / no es hallazgo |\n|---|---|---|---|---|---|\n`;
for(const s of ['Crítica','Alta','Media','Baja','—']){const g=k=>bySev[s+'|'+k]||0;md+=`| ${s} | ${g('RESUELTO')} | ${g('PARCIAL')} | ${g('EN CURSO')} | ${g('PENDIENTE')} | ${g('INFORMATIVO')+g('NO ES HALLAZGO')} |\n`;}
md+=`\nMétodo: los identificadores se extrajeron con una expresión regular sobre todos los MD; la severidad, de la línea que define cada uno (en las filas de tablas de ejes puede ser la severidad del eje y no la del hallazgo: revisar la cita). «Resuelto» exige un commit y una comprobación en el código (archivo/prueba citados); «Parcial» lista lo que falta.\n\n`;
for(const st of ['RESUELTO','PARCIAL','EN CURSO','PENDIENTE','INFORMATIVO','NO ES HALLAZGO']){
 const g=rows.filter(x=>x.st===st); if(!g.length)continue;
 md+=`## ${st} (${g.length})\n\n`;
 if(st==='RESUELTO'||st==='PARCIAL'||st==='EN CURSO'){md+=`| ID | Sev. | Cita del MD | Commit | Evidencia de la solución |${st==='PARCIAL'?' Falta |':''}\n|---|---|---|---|---|${st==='PARCIAL'?'---|':''}\n`;for(const x of g)md+=`| ${x.id} | ${x.sevN} | \`${x.file}:${x.line}\` — ${esc(x.text.slice(0,180))}… | ${x.c} | ${esc(x.e)} |${st==='PARCIAL'?` ${esc(x.f)} |`:''}\n`;}
 else {md+=`| ID | Sev. | Cita del MD |\n|---|---|---|\n`;for(const x of g)md+=`| ${x.id} | ${x.sevN} | \`${x.file}:${x.line}\` — ${esc(x.text.slice(0,200))}… |\n`;}
 md+='\n';
}
md+=`---\nRegenerar (desde la raíz del repo): \`node docs/auditorias/2026-11-07-auditoria-madurez-construccion-produccion/herramientas/extraer-hallazgos.mjs\` y luego \`node …/herramientas/informe-cierre.mjs <salida.md>\`. El estado de cada hallazgo resuelto está en el mapa \`M\` de \`informe-cierre.mjs\`, con su commit y evidencia.\n`;
fs.writeFileSync(process.argv[2],md);
console.log(count, JSON.stringify(bySev));
