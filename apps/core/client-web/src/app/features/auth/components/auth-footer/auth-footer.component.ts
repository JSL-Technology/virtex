import { Component, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { RouterModule } from '@angular/router';
import { LucideAngularModule, Globe, ChevronUp, Check } from 'lucide-angular';

@Component({
  selector: 'app-auth-footer',
  standalone: true,
  imports: [
    CommonModule,
    TranslateModule,
    RouterModule,
    LucideAngularModule
  ],
  templateUrl: './auth-footer.component.html',
  styleUrls: ['./auth-footer.component.scss']
})
export class AuthFooterComponent {
  private translate = inject(TranslateService);

  readonly icons = { Globe, ChevronUp, Check };
  readonly currentYear = new Date().getFullYear();

  isLangDropdownOpen = false;

  availableLanguages = [
    { code: 'es', label: 'Español' },
    { code: 'en', label: 'English' }
  ];

  get currentLang(): string {
    return this.translate.currentLang || 'es';
  }

  get currentLangLabel(): string {
    const lang = this.availableLanguages.find(l => l.code === this.currentLang);
    return lang ? lang.label : 'Español';
  }

  toggleLangDropdown(event: Event) {
    event.stopPropagation();
    this.isLangDropdownOpen = !this.isLangDropdownOpen;
  }

  changeLang(langCode: string) {
    this.translate.use(langCode);
    localStorage.setItem('lang', langCode);
    this.isLangDropdownOpen = false;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.language-selector')) {
      this.isLangDropdownOpen = false;
    }
  }
}
