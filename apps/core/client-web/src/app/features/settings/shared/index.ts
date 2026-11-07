import { SettingsDisclosureComponent } from './settings-disclosure.component';
import { SettingsGroupComponent } from './settings-group.component';

export { SettingsGroupComponent } from './settings-group.component';
export { SettingsDisclosureComponent } from './settings-disclosure.component';

/** Lo que toda página de Configuración necesita para agrupar su contenido. */
export const SETTINGS_LAYOUT = [SettingsGroupComponent, SettingsDisclosureComponent] as const;
