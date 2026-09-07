/**
 * Los cinco gestos, en un solo sitio.
 *
 * Un punto de entrada y no imports sueltos por archivo: quien busca «cómo se hace una lista aquí»
 * encuentra la respuesta entera, y añadir un sexto gesto exige tocar este índice, que es donde se
 * ve que no debería existir.
 */
export { ListShellComponent } from './list-shell.component';
export { DocumentShellComponent, type DocumentTone } from './document-shell.component';
export { DraftShellComponent, type DraftProblem } from './draft-shell.component';
export { draftProblems } from './draft-validation';
export {
  InboxShellComponent,
  type InboxItem,
  type InboxSection,
} from './inbox-shell.component';
