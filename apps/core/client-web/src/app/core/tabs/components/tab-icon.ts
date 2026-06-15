import {
  LucideAngularModule,
  File, FileText, FilePlus, Receipt, LayoutDashboard, ClipboardList,
  CheckSquare, Bell, Search, UploadCloud, DownloadCloud, FolderArchive,
  ShoppingCart, Package, Users, LayoutGrid, Building, Truck, Briefcase,
  Factory, Warehouse, BookCopy, BarChartBig, CreditCard, Database,
} from 'lucide-angular';

/** Iconos lucide disponibles para las pestañas, indexados por nombre. */
export const TAB_ICONS: Record<string, unknown> = {
  File, FileText, FilePlus, Receipt, LayoutDashboard, ClipboardList,
  CheckSquare, Bell, Search, UploadCloud, DownloadCloud, FolderArchive,
  ShoppingCart, Package, Users, LayoutGrid, Building, Truck, Briefcase,
  Factory, Warehouse, BookCopy, BarChartBig, CreditCard, Database,
};

export function resolveTabIcon(name: string | undefined): unknown {
  return (name && TAB_ICONS[name]) || File;
}

export { LucideAngularModule };
