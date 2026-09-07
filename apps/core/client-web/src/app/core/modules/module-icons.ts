import {
  ArrowLeftRight, Banknote, BarChart2, Bell, Blocks, BookOpen, BookText, Briefcase,
  CalendarCheck, CalendarClock, CalendarRange, CheckCircle, CheckSquare, ClipboardCheck,
  ClipboardList, Clock, Coins, Construction, CreditCard, DownloadCloud, Factory, FilePen,
  FilePlus, FileText, FolderArchive, FolderTree, GitCompareArrows, HandCoins, History, Home,
  Landmark, Layers, Layers3, LayoutDashboard, LayoutGrid, Library, ListChecks, ListTree,
  NotebookTabs, Package, PackagePlus, PackageSearch, Percent, Receipt, Ruler, Scale, Search,
  Settings2, ShieldAlert, ShoppingBag, ShoppingCart, Store, Table2, Tag, TrendingUp, Truck,
  Upload, UploadCloud, UserCog, UserPlus, Users, UsersRound, Warehouse, Waves,
} from 'lucide-angular';

/**
 * Icon names, resolved.
 *
 * A manifest names its icon as a string so the manifest stays data — importable by a test, by the
 * route generator and by the window host without dragging the icon library into any of them. The
 * sidebar is the one place that needs the drawing, so the lookup lives here.
 *
 * `moduleIcon()` falls back rather than throwing: a missing icon is a cosmetic defect and must not
 * be able to take down the navigation. `module-manifest.spec.ts` fails on an unknown name, so the
 * fallback covers the running app while the build covers the mistake.
 */
const ICONS: Record<string, unknown> = {
  ArrowLeftRight, Banknote, BarChart2, Bell, Blocks, BookOpen, BookText, Briefcase,
  CalendarCheck, CalendarClock, CalendarRange, CheckCircle, CheckSquare, ClipboardCheck,
  ClipboardList, Clock, Coins, Construction, CreditCard, DownloadCloud, Factory, FilePen,
  FilePlus, FileText, FolderArchive, FolderTree, GitCompareArrows, HandCoins, History, Home,
  Landmark, Layers, Layers3, LayoutDashboard, LayoutGrid, Library, ListChecks, ListTree,
  NotebookTabs, Package, PackagePlus, PackageSearch, Percent, Receipt, Ruler, Scale, Search,
  Settings2, ShieldAlert, ShoppingBag, ShoppingCart, Store, Table2, Tag, TrendingUp, Truck,
  Upload, UploadCloud, UserCog, UserPlus, Users, UsersRound, Warehouse, Waves,
};

export function moduleIcon(name: string): unknown {
  return ICONS[name] ?? LayoutGrid;
}

export function isKnownIcon(name: string): boolean {
  return name in ICONS;
}
