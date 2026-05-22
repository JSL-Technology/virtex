import { Component, inject } from '@angular/core';
import { ThemeService } from '../../../core/services/theme';

// --- PASO 1: Importar el MÓDULO y los OBJETOS de los íconos ---
import { LucideAngularModule, Sun, Moon, Monitor } from 'lucide-angular';

@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  imports: [
    LucideAngularModule // Solo necesitas importar el módulo
  ],
  // No se necesita 'providers' ni inyectar el servicio de íconos aquí
  templateUrl: './theme-toggle.html',
  styleUrls: ['./theme-toggle.scss'],
})
export class ThemeToggle {
  public themeService = inject(ThemeService);

  // --- PASO 2: Exponer los íconos importados como propiedades ---
  // La plantilla usará estas propiedades para el binding [img]
  protected readonly SunIcon = Sun;
  protected readonly MoonIcon = Moon;
  protected readonly MonitorIcon = Monitor;

  readonly tooltips = {
    light: 'Cambiar a modo oscuro',
    dark: 'Cambiar a modo sistema',
    system: 'Cambiar a modo claro'
  };
}