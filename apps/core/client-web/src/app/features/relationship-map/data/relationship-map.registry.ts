import {
  ArrowLeftRight,
  BookOpen,
  Building2,
  ClipboardList,
  FileCheck,
  FileMinus,
  FileText,
  HandCoins,
  Landmark,
  PackageCheck,
  Receipt,
  ScrollText,
  ShoppingBag,
  ShoppingCart,
  Sliders,
  Target,
  Users,
  Wallet,
} from 'lucide-angular';
import { FlowDocumentType } from './relationship-map.models';

/**
 * How the client presents each document type: its icon and the screen that opens it.
 *
 * Routes are a client concern — the server knows tables, not screens — so they live here, next to
 * the manifests they point into. `null` means the product has no screen for that document on its
 * own (a customer receipt is read from its customer's statement), and the node is not a link.
 * Every route is relative to the organisation (`ActiveOrganizationService.urlFor` prefixes it).
 */
export interface FlowTypePresentation {
  icon: unknown;
  route: ((id: string) => string) | null;
}

export const FLOW_TYPE_REGISTRY: Record<FlowDocumentType, FlowTypePresentation> = {
  SALES_OPPORTUNITY: { icon: Target, route: null },
  SALES_QUOTE: { icon: FileText, route: (id) => `quotes/${id}/edit` },
  SALES_INVOICE: { icon: Receipt, route: (id) => `invoices/${id}` },
  CUSTOMER_PAYMENT: { icon: HandCoins, route: null },
  POS_SALE: { icon: ShoppingCart, route: null },
  ECF_SUBMISSION: { icon: FileCheck, route: null },
  PURCHASE_REQUISITION: { icon: ClipboardList, route: (id) => `purchasing/requisitions/${id}/edit` },
  PURCHASE_ORDER: { icon: ShoppingBag, route: (id) => `purchasing/orders/${id}/edit` },
  GOODS_RECEIPT: { icon: PackageCheck, route: (id) => `purchasing/receipts/${id}` },
  VENDOR_BILL: { icon: ScrollText, route: (id) => `accounts-payable/${id}` },
  VENDOR_DEBIT_NOTE: { icon: FileMinus, route: (id) => `accounts-payable/debit-notes/${id}` },
  VENDOR_PAYMENT: { icon: Wallet, route: (id) => `accounts-payable/payments/${id}` },
  JOURNAL_ENTRY: { icon: BookOpen, route: (id) => `accounting/journal-entries/${id}/edit` },
  BANK_TRANSFER: { icon: ArrowLeftRight, route: null },
  INTERCOMPANY_TRANSACTION: { icon: Building2, route: null },
  INVENTORY_ADJUSTMENT: { icon: Sliders, route: (id) => `inventory/adjustments/${id}` },
  PAYROLL_RUN: { icon: Users, route: (id) => `payroll/runs/${id}` },
  FIXED_ASSET: { icon: Landmark, route: (id) => `accounting/fixed-assets/${id}` },
};

export function presentationOf(type: string): FlowTypePresentation {
  return FLOW_TYPE_REGISTRY[type as FlowDocumentType] ?? { icon: FileText, route: null };
}
