/**
 * =====================================================================================
 * ARCHIVO: ../app/core/services/chart-of-accounts.service.ts
 * =====================================================================================
 * DESCRIPCIÓN:
 * Este servicio es el responsable de toda la comunicación HTTP relacionada con el
 * Plan de Cuentas. Actúa como una capa de abstracción entre los componentes de la
 * aplicación y la API del backend.
 *
 * Cada método público en este servicio corresponde a un endpoint de la API.
 * =====================================================================================
 */

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Account, HierarchyType } from '../models/account.model';

// --- INTERFACES PARA RESPUESTAS DE API ESPECÍFICAS ---

/**
 * Describe el objeto de respuesta esperado del endpoint de análisis de impacto (dry-run).
 */
export interface ImpactAnalysisResult {
  transactionsAffected: number;
  subledgerReferences: number;
  reportsAffected: string[];
  warnings: string[];
  isActionAllowed: boolean;
}

/**
 * Describe el objeto de respuesta esperado del endpoint de operaciones masivas (importación).
 */
export interface BulkOperationResult {
  successCount: number;
  errorCount: number;
  errors: {
    rowIndex: number;
    accountCode: string;
    message: string;
  }[];
}

@Injectable({
  providedIn: 'root'
})
export class ChartOfAccountsService {
  // --- INYECCIÓN DE DEPENDENCIAS Y CONFIGURACIÓN ---
  private readonly http = inject(HttpClient);
  // La URL base de la API. Ajústala si tu backend está en un dominio o puerto diferente.
  private readonly apiUrl = '/api/chart-of-accounts';

  // --- MÉTODOS DE LECTURA (GET) ---

  /**
   * Obtiene la lista completa de cuentas para una versión y jerarquía específicas.
   * @param version La versión del plan de cuentas a obtener.
   * @param hierarchy El tipo de jerarquía a visualizar (LEGAL, MANAGEMENT, FISCAL).
   * @returns Un Observable que emite un array de objetos Account.
   */
  getAccounts(version: number, hierarchy: HierarchyType): Observable<Account[]> {
    const params = new HttpParams()
      .set('version', version.toString())
      .set('hierarchy', hierarchy);
    return this.http.get<Account[]>(this.apiUrl, { params });
  }

  /**
   * Obtiene los datos completos de una única cuenta contable por su ID.
   * @param id El identificador único de la cuenta.
   * @returns Un Observable que emite un único objeto Account.
   */
  getAccountById(id: string): Observable<Account> {
    return this.http.get<Account>(`${this.apiUrl}/${id}`);
  }

  // --- MÉTODOS DE ESCRITURA (POST, PATCH) ---

  /**
   * Envía los datos de una nueva cuenta al backend para su creación.
   * @param accountData Un objeto parcial que contiene los datos de la nueva cuenta.
   * @returns Un Observable que emite la cuenta recién creada, incluyendo su ID asignado por el servidor.
   */
  createAccount(accountData: Partial<Account>): Observable<Account> {
    return this.http.post<Account>(this.apiUrl, accountData);
  }

  /**
   * Envía los datos actualizados de una cuenta existente al backend.
   * @param id El ID de la cuenta a actualizar.
   * @param accountData Un objeto parcial con los campos que se desean modificar.
   * @returns Un Observable que emite la cuenta con los datos ya actualizados.
   */
  updateAccount(id: string, accountData: Partial<Account>): Observable<Account> {
    return this.http.patch<Account>(`${this.apiUrl}/${id}`, accountData);
  }

  // --- MÉTODOS DE VERSIONADO ---

  /**
   * Obtiene una lista de todos los números de versión disponibles en el sistema.
   * @returns Un Observable que emite un array de números (e.g., [1, 2, 3]).
   */
  getVersions(): Observable<number[]> {
    return this.http.get<number[]>(`${this.apiUrl}/versions`);
  }

  /**
   * Solicita al backend la creación de una nueva versión del plan de cuentas.
   * @param baseVersion El número de la versión existente que se usará como plantilla.
   * @param effectiveFrom La fecha a partir de la cual la nueva versión será efectiva (formato ISO).
   * @returns Un Observable que emite un objeto con el número de la nueva versión creada.
   */
  createVersion(baseVersion: number, effectiveFrom: string): Observable<{ newVersion: number }> {
    return this.http.post<{ newVersion: number }>(`${this.apiUrl}/versions`, { baseVersion, effectiveFrom });
  }

  // --- MÉTODOS PARA OPERACIONES COMPLEJAS Y DE SEGURIDAD ---

  /**
   * Ejecuta la fusión de una cuenta de origen en una cuenta de destino.
   * @param sourceAccountId El ID de la cuenta que será absorbida y desactivada.
   * @param targetAccountId El ID de la cuenta que recibirá los saldos y transacciones.
   * @returns Un Observable<void> que se completa cuando la operación finaliza exitosamente.
   */
  mergeAccounts(sourceAccountId: string, targetAccountId: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/merge`, { sourceAccountId, targetAccountId });
  }

  /**
   * Realiza un chequeo de impacto (dry-run) antes de ejecutar una acción crítica.
   * @param accountId El ID de la cuenta sobre la que se realiza el análisis.
   * @param action La acción a analizar ('DEACTIVATE', 'MERGE', 'REPARENT').
   * @returns Un Observable que emite un objeto ImpactAnalysisResult con los detalles del impacto.
   */
  getImpactAnalysis(accountId: string, action: 'DEACTIVATE' | 'MERGE' | 'REPARENT'): Observable<ImpactAnalysisResult> {
    const params = new HttpParams().set('action', action);
    return this.http.get<ImpactAnalysisResult>(`${this.apiUrl}/${accountId}/impact-analysis`, { params });
  }

  // --- MÉTODOS PARA OPERACIONES MASIVAS ---

  /**
   * Sube un archivo (CSV o XLSX) al backend para la creación o actualización masiva de cuentas.
   * @param file El objeto File que representa el archivo seleccionado por el usuario.
   * @returns Un Observable que emite un objeto BulkOperationResult con el resumen de la importación.
   */
  bulkCreateOrUpdate(file: File): Observable<BulkOperationResult> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    return this.http.post<BulkOperationResult>(`${this.apiUrl}/bulk-import`, formData);
  }

  /**
   * Descarga el plan de cuentas en el formato especificado.
   * @param version La versión del plan a exportar.
   * @param hierarchy La jerarquía del plan a exportar.
   * @param format El formato de archivo deseado ('csv' o 'json').
   * @returns Un Observable que emite el contenido del archivo como un Blob.
   */
  exportAccounts(version: number, hierarchy: HierarchyType, format: 'csv' | 'json'): Observable<Blob> {
    const params = new HttpParams()
      .set('version', version.toString())
      .set('hierarchy', hierarchy)
      .set('format', format);
    // Se espera una respuesta de tipo 'blob' para manejar el archivo.
    return this.http.get(`${this.apiUrl}/export`, { params, responseType: 'blob' });
  }
}
