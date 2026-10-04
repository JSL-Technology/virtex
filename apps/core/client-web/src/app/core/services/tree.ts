/**
 * =====================================================================================
 * ARCHIVO: ../app/core/services/tree.service.ts
 * =====================================================================================
 * DESCRIPCIÓN:
 * Este servicio proporciona utilidades para trabajar con estructuras de datos
 * jerárquicas (árboles). Su principal responsabilidad es convertir una lista plana de
 * elementos (como cuentas contables) en un árbol anidado y viceversa.
 *
 * MÉTODOS PRINCIPALES:
 * - buildTree: Construye una estructura de árbol a partir de un array plano de cuentas.
 * - flattenTree: Aplana una estructura de árbol para facilitar su renderizado en la UI.
 * =====================================================================================
 */

import { Injectable } from '@angular/core';
import { Account } from '../models/account.model';
import { FlattenedAccount } from '../models/flattened-account.model';
import { compareCells } from '../../shared/components/sort';

/** The name in the page's language, with the same fallbacks as the `vxName` pipe. */
function readableName(name: Account['name']): string {
  if (name == null) return '';
  if (typeof name === 'string') return name;
  const locale = (typeof document !== 'undefined' && document.documentElement.lang) || 'es';
  const language = locale.split('-')[0];
  return name[locale] ?? name[language] ?? name['es'] ?? name['en'] ?? Object.values(name).find(Boolean) ?? '';
}

@Injectable({
  providedIn: 'root'
})
export class TreeService {

  /**
   * Construye una estructura de árbol jerárquico a partir de una lista plana de cuentas.
   * El algoritmo es eficiente (complejidad O(n)) ya que solo recorre la lista una vez.
   *
   * @param accounts El array plano de cuentas obtenido de la API. Cada cuenta debe tener 'id' y 'parentId'.
   * @returns Un array de cuentas de nivel raíz (aquellas sin padre), con sus respectivos hijos anidados.
   */
  public buildTree(accounts: Account[], sort: { field: keyof FlattenedAccount; direction: 'asc' | 'desc' }): Account[] {
    if (!Array.isArray(accounts) || accounts.length === 0) {
      return [];
    }
  
    // Crear un mapa para acceso rápido
    const accountMap = new Map<string, Account>();
    accounts.forEach(account => {
      account.children = [];
      accountMap.set(account.id, account);
    });
  
    // Asignar hijos a padres
    const rootAccounts: Account[] = [];
    accounts.forEach(account => {
      if (account.parentId && accountMap.has(account.parentId)) {
        accountMap.get(account.parentId)!.children!.push(account);
      } else {
        rootAccounts.push(account);
      }
    });
  
    // Función de ordenación recursiva
    const sortTree = (nodeList: Account[]): void => {
      nodeList.sort((a, b) => this.compareAccounts(a, b, sort));
      nodeList.forEach(node => {
        if (node.children && node.children.length > 0) {
          sortTree(node.children);
        }
      });
    };
  
    sortTree(rootAccounts);
  
    return rootAccounts;
  }

  /**
   * Siblings in the chosen order (QA B-01). The name is a translation map (`{ es, en }`); compared
   * as an object every pair was «equal» and the header did nothing. It is compared as the reader
   * sees it, and amounts arrive as decimal strings, which `compareCells` reads as numbers.
   */
  private compareAccounts(a: Account, b: Account, sort: { field: keyof FlattenedAccount; direction: 'asc' | 'desc' }): number {
    const field = sort.field as keyof Account;
    const read = (account: Account): unknown => (field === 'name' ? readableName(account.name) : account[field]);
    return compareCells(read(a), read(b), sort.direction) || compareCells(a.code, b.code);
  }

  /**
   * Aplana una estructura de árbol de cuentas en una lista plana, añadiendo propiedades
   * de UI como el nivel de profundidad. Utiliza un enfoque recursivo.
   *
   * @param tree El array de cuentas de nivel raíz (el resultado de buildTree).
   * @returns Un array de `FlattenedAccount` listo para ser renderizado en una vista de tabla/lista.
   */
  public flattenTree(tree: Account[]): FlattenedAccount[] {
    const flattened: FlattenedAccount[] = [];

    // Función recursiva interna para procesar cada nivel del árbol.
    const flatten = (nodes: Account[], level: number) => {
      for (const node of nodes) {
        // 1. Añadir el nodo actual a la lista plana, extendiéndolo con las propiedades de UI.
        flattened.push({
          ...node,
          level: level,
          isExpanded: false, // Por defecto, los nodos están colapsados.
          hasChildren: !!node.children && node.children.length > 0
        });

        // 2. Si el nodo tiene hijos, llamar recursivamente a la función para ellos.
        if (node.children && node.children.length > 0) {
          flatten(node.children, level + 1);
        }
      }
    };

    // Iniciar el proceso de aplanamiento desde el nivel raíz (nivel 0).
    flatten(tree, 0);
    return flattened;
  }
}
