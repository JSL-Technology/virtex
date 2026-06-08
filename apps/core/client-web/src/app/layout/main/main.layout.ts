// ../app/layout/main/main.layout.ts

import { Component, inject, signal, HostListener, ElementRef, HostBinding, OnInit, WritableSignal, ViewChild, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs/operators';
import { SettingsModalComponent } from '../../features/settings/modal/settings-modal.component';
import { AuthService } from '../../core/services/auth';
import { BrandingService } from '../../core/services/branding';
import { NotificationCenterService } from '../../core/services/notification-center.service';
import { ThemeToggle } from '../../shared/components/theme-toggle/theme-toggle';
import { AppLauncherComponent } from './components/app-launcher/app-launcher.component';
import { PwaService } from '../../core/services/pwa.service';
import { SearchService, SearchResultGroup } from '../../core/services/search.service';
import { Subject, of } from 'rxjs';
import { debounceTime, switchMap, catchError, distinctUntilChanged, tap } from 'rxjs/operators';
import {
  LucideAngularModule, Search, PlusCircle, Bell, User, Settings, LogOut, ChevronDown,
  LayoutDashboard, ShoppingCart, Receipt, Package, Users as ContactsIcon, HardHat, CheckSquare,
  FolderArchive,
  Database,
  UploadCloud,
  DownloadCloud,
  BookCopy,
  BarChartBig,
  Truck,
  X,
  ChevronRight,
  ArrowRight,
  FileText,
  Building,
  CreditCard,
  Calendar,
  User as UserIcon2,
  Box,
  FileSearch,
  UserPlus, // ✅ Icono añadido
  Package as PackageIcon, // ✅ Icono añadido
  Download // ✅ Icono añadido
} from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { Sidebar } from '../sidebar/sidebar';
import { ClickOutsideDirective } from '../../shared/directives/click-outside.directive'; // ✅ Directiva añadida
import { CompanySwitcherComponent } from './components/company-switcher/company-switcher.component';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    ThemeToggle,
    AppLauncherComponent,
    LucideAngularModule,
    TranslateModule,
    Sidebar,
    ClickOutsideDirective,
    SettingsModalComponent,
    CompanySwitcherComponent
  ], // ✅ Directiva añadida a los imports
  templateUrl: './main.layout.html',
  styleUrls: ['./main.layout.scss'],
})
export class MainLayout implements OnInit {
  notificationCenter = inject(NotificationCenterService);
  pwaService = inject(PwaService);
  private readonly quickCreateShortcuts = [
    { key: 'i', route: '/invoices/new' },
    { key: 'q', route: '/quotes/new' },
    { key: 'c', route: '/customers/new' },
    { key: 'p', route: '/products/new' },
  ] as const;
  
  // ✅ Lógica para la Modal "Crear Nuevo"
  isQuickCreateModalOpen: WritableSignal<boolean> = signal(false);

  toggleQuickCreateModal(): void {
    this.isQuickCreateModalOpen.update(value => !value);
    this.isUserMenuOpen.set(false);
    this.isNotificationMenuOpen.set(false);
  }

  closeQuickCreateModal(): void {
    this.isQuickCreateModalOpen.set(false);
  }
  // --- Fin de la lógica para la modal ---

  isGracePeriodActive(): boolean {
    const org = this.authService.currentUser()?.organization;
    if (!org?.gracePeriodEnd) return false;
    return new Date(org.gracePeriodEnd) > new Date();
  }

  ngOnInit(): void {
    this.notificationCenter.initialize();
    this.searchQuery$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      tap(query => {
        if (query.trim().length > 0) {
          this.isSearchLoading.set(true);
          this.isSearchOpen.set(true);
        } else {
          this.isSearchLoading.set(false);
          this.isSearchOpen.set(false);
          this.searchResults.set([]);
        }
      }),
      switchMap(query => {
        if (query.trim().length > 0) {
          return this.searchService.search(query.trim()).pipe(
            catchError(() => of([] as SearchResultGroup[]))
          );
        } else {
          return of([] as SearchResultGroup[]);
        }
      })
    ).subscribe(results => {
      this.searchResults.set(results);
      this.isSearchLoading.set(false);
    });
  }
  private elementRef = inject(ElementRef);
  authService = inject(AuthService);
  brandingService = inject(BrandingService);
  private searchService = inject(SearchService);
  protected readonly router = inject(Router);

  settings = this.brandingService.settings;

  public companyLogo = computed(() => {
    return (
      this.settings().logoUrl ||
      this.authService.currentUser()?.organization?.logoUrl ||
      null
    );
  });

  public companyName = computed(() => {
    return (
      this.authService.currentUser()?.organization?.name || 'FacturaPRO'
    );
  });

  private readonly currentFragment = toSignal(
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      map(() => {
        const url = this.router.url;
        const idx = url.indexOf('#');
        return idx >= 0 ? url.slice(idx + 1) : '';
      }),
      startWith((() => {
        const url = this.router.url;
        const idx = url.indexOf('#');
        return idx >= 0 ? url.slice(idx + 1) : '';
      })()),
    ),
    { initialValue: '' }
  );

  readonly isSettingsOpen = computed(() =>
    this.currentFragment().startsWith('settings')
  );

  readonly settingsSection = computed(() => {
    const frag = this.currentFragment();
    if (frag.startsWith('settings/')) return frag.slice('settings/'.length);
    if (frag === 'settings') return 'my-profile';
    return 'my-profile';
  });

  openSettings(section = 'my-profile'): void {
    this.router.navigate([], { fragment: 'settings/' + section });
  }

  closeSettings(): void {
    const path = this.router.url.split('#')[0];
    this.router.navigateByUrl(path);
  }

  isUserMenuOpen = signal(false);
  isNotificationMenuOpen = signal(false);
  isSearchOpen = signal(false);
  searchResults = signal<SearchResultGroup[]>([]);
  isSearchLoading = signal(false);
  private searchQuery$ = new Subject<string>();

  @HostBinding('class')
  get layoutClass() {
    return `layout-${this.settings().layoutStyle}`;
  }

  stopImpersonation(): void {
    this.authService.stopImpersonation().subscribe();
  }

  // Íconos expuestos a la plantilla
  protected readonly SearchIcon = Search;
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly BellIcon = Bell;
  protected readonly UserIcon = User;
  protected readonly SettingsIcon = Settings;
  protected readonly LogOutIcon = LogOut;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly XIcon = X;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly ArrowRightIcon = ArrowRight;
  protected readonly DashboardIcon = LayoutDashboard;
  protected readonly MyWorkIcon = HardHat;
  protected readonly ApprovalsIcon = CheckSquare;
  protected readonly DocumentsIcon = FolderArchive;
  protected readonly PackageIcon = Package;
  protected readonly SalesIcon = ShoppingCart;
  protected readonly InvoicesIcon = Receipt;
  protected readonly InventoryIcon = Package;
  protected readonly ContactsIcon = ContactsIcon;
  protected readonly MastersIcon = Database;
  protected readonly DataImportsIcon = UploadCloud;
  protected readonly DataExportsIcon = DownloadCloud;
  protected readonly AccountingIcon = BookCopy;
  protected readonly ReportsIcon = BarChartBig;
  protected readonly PurchasingIcon = Truck;
  protected readonly FileTextIcon = FileText;
  protected readonly BuildingIcon = Building;
  protected readonly CreditCardIcon = CreditCard;
  protected readonly CalendarIcon = Calendar;
  protected readonly UserIcon2 = UserIcon2;
  protected readonly BoxIcon = Box;
  protected readonly FileSearchIcon = FileSearch;
  protected readonly ReceiptIcon = Receipt; // ✅ Icono añadido
  protected readonly UserPlusIcon = UserPlus; // ✅ Icono añadido
  protected readonly DownloadIcon = Download; // ✅ Icono añadido

  toggleUserMenu(): void {
    this.isUserMenuOpen.update(isOpen => !isOpen);
    this.closeNotificationMenu();
    this.closeQuickCreateModal();
  }

  toggleNotificationMenu(): void {
    this.isNotificationMenuOpen.update(isOpen => !isOpen);
    this.closeUserMenu();
    this.closeQuickCreateModal();
  }

  closeUserMenu(): void {
    this.isUserMenuOpen.set(false);
  }
  
  // ✅ Nuevo método para cerrar notificaciones (usado por clickOutside)
  closeNotificationMenu(): void {
    this.isNotificationMenuOpen.set(false);
  }

  navigateToSearch(query: string): void {
    if (query && query.trim().length > 0) {
      this.router.navigate(['/app/global-search'], { queryParams: { q: query.trim() } });
      this.closeSearch();
    }
  }

  onSearchInput(query: string): void {
    this.searchQuery$.next(query);
  }

  onSearchFocus(): void {
    if (this.searchResults().length > 0) {
      this.isSearchOpen.set(true);
    }
  }

  closeSearch(): void {
    this.isSearchOpen.set(false);
  }

  getIconForType(type: string): any {
    if (!type) {
      return this.FileSearchIcon;
    }

    const lowerCaseType = type.toLowerCase();
    const iconMap: { [key: string]: any } = {
      'customers': this.UserIcon2,
      'products': this.BoxIcon,
      'invoices': this.InvoicesIcon,
      'documents': this.FileTextIcon,
      'companies': this.BuildingIcon,
      'payments': this.CreditCardIcon,
      'events': this.CalendarIcon,
      'sales': this.SalesIcon,
      'dashboard': this.DashboardIcon,
      'inventory': this.PackageIcon,
      'contacts': this.ContactsIcon,
      'users': this.UserIcon2,
      'settings': this.SettingsIcon,
      'reports': this.ReportsIcon,
      'purchases': this.PurchasingIcon,
    };

    return iconMap[lowerCaseType] || this.FileSearchIcon;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const searchElement = this.elementRef.nativeElement.querySelector('.global-search');
    if (searchElement && !searchElement.contains(event.target as Node)) {
      this.closeSearch();
    }
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if (!event.altKey || !event.shiftKey || this.isTypingContext(event.target)) {
      return;
    }

    const shortcut = this.quickCreateShortcuts.find(({ key }) => key === event.key.toLowerCase());
    if (!shortcut) {
      return;
    }

    event.preventDefault();
    this.closeQuickCreateModal();
    this.router.navigateByUrl(shortcut.route);
  }

  private isTypingContext(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
  }
}
