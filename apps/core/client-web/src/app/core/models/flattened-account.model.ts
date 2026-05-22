import { Account } from './account.model';

/**
 * Extiende Account con datos de presentación necesarios para la UI en tablas/árboles.
 */
export interface FlattenedAccount extends Account {
  level: number;
  parentId: string | null;
  isExpanded?: boolean;
  isDisabled?: boolean;
  hasChildren?: boolean; // Indica si tiene hijos para optimizar la UI
}