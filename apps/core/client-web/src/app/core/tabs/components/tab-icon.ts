import {
  LucideAngularModule,
  File, FileText, FilePlus, Receipt, LayoutDashboard, ClipboardList,
  CheckSquare, Bell, Search, UploadCloud, DownloadCloud, FolderArchive,
  ShoppingCart, Package, Users, LayoutGrid, Building, Truck, Briefcase,
  Factory, Warehouse, BookCopy, BarChartBig, CreditCard, Database, Share2,
} from 'lucide-angular';
import { isKnownIcon, moduleIcon } from '../../modules/module-icons';

/** Iconos lucide disponibles para las pestañas, indexados por nombre. */
export const TAB_ICONS: Record<string, unknown> = {
  File, FileText, FilePlus, Receipt, LayoutDashboard, ClipboardList,
  CheckSquare, Bell, Search, UploadCloud, DownloadCloud, FolderArchive,
  ShoppingCart, Package, Users, LayoutGrid, Building, Truck, Briefcase,
  Factory, Warehouse, BookCopy, BarChartBig, CreditCard, Database, Share2,
};

/**
 * A window's icon: its own name first, then the manifest icon set the sidebar already draws. Only
 * the 26 names above used to resolve, so every window whose manifest named another icon —
 * «Workflow», «History», most of the product — showed the same blank page, and a process's design
 * and one of its runs were two identical tabs.
 */
export function resolveTabIcon(name: string | undefined): unknown {
  if (!name) return File;
  return TAB_ICONS[name] ?? (isKnownIcon(name) ? moduleIcon(name) : File);
}

export { LucideAngularModule };
