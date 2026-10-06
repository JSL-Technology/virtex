import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, firstValueFrom, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ActiveOrganizationService } from './active-organization.service';

/** A place the company operates from. Not a subsidiary: same legal entity, same books. */
export interface Branch {
  id: string;
  code: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  fiscalEstablishmentCode: string | null;
  emissionPointCode: string | null;
  defaultWarehouseId: string | null;
  isHeadquarters: boolean;
  isActive: boolean;
  /** How many people are limited to this branch; present on the administration list. */
  restrictedUserCount?: number;
}

export type BranchOption = Pick<Branch, 'id' | 'code' | 'name' | 'isHeadquarters'>;

/** The branches the signed-in person may issue documents from. */
export interface MyBranches {
  /** Open branches the person may issue from. */
  branches: BranchOption[];
  /** Their closed branches: never offered, but still named on the documents they issued. */
  closed: Pick<Branch, 'id' | 'code' | 'name'>[];
  defaultBranchId: string | null;
  restricted: boolean;
}

export interface UserBranchAccess {
  userId: string;
  /** Empty means every branch. */
  branchIds: string[];
  defaultBranchId: string | null;
}

export type SaveBranch = Partial<Omit<Branch, 'id' | 'restrictedUserCount'>>;

const NONE: MyBranches = { branches: [], closed: [], defaultBranchId: null, restricted: false };

/**
 * The company's branches, for the screens that administer them and the ones that pick one.
 *
 * `mine` is what every document form and list filter reads. It is asked for once per company and
 * held here, so ten pickers on screen cost one request; switching company clears it, because the
 * branches — and the person's access to them — belong to the company.
 */
@Injectable({ providedIn: 'root' })
export class BranchesService {
  private readonly http = inject(HttpClient);
  private readonly tenancy = inject(ActiveOrganizationService);
  private readonly apiUrl = `${environment.apiUrl}/organizations/branches`;

  private readonly mineState = signal<MyBranches>(NONE);
  private loadedFor: string | null = null;
  private pending: Promise<MyBranches> | null = null;

  /** The person's branches in the active company; empty until loaded, and for a company without any. */
  readonly mine = this.mineState.asReadonly();
  /** Whether the company works with branches at all — the pickers and filters hide otherwise. */
  readonly hasBranches = computed(() => this.mineState().branches.length > 0);

  constructor() {
    effect(() => {
      const organizationId = this.tenancy.organization()?.id ?? null;
      if (organizationId !== this.loadedFor) {
        this.loadedFor = null;
        this.pending = null;
        this.mineState.set(NONE);
      }
    });
  }

  /** `code · name` of any branch the person can see, open or closed; null when unknown. */
  label(branchId: string | null | undefined): string | null {
    if (!branchId) return null;
    const mine = this.mineState();
    const branch = mine.branches.find((b) => b.id === branchId) ?? mine.closed.find((b) => b.id === branchId);
    return branch ? `${branch.code} · ${branch.name}` : null;
  }

  /** Loads the person's branches for the active company, once. */
  ensureMine(): Promise<MyBranches> {
    const organizationId = this.tenancy.organization()?.id ?? null;
    if (organizationId && this.loadedFor === organizationId) return Promise.resolve(this.mineState());
    if (this.pending) return this.pending;
    this.pending = firstValueFrom(this.http.get<MyBranches>(`${this.apiUrl}/mine`))
      .then((mine) => {
        this.mineState.set(mine);
        this.loadedFor = organizationId;
        return mine;
      })
      .catch(() => {
        // No branches is the safe reading: the form issues documents as it always did.
        this.mineState.set(NONE);
        return NONE;
      })
      .finally(() => (this.pending = null));
    return this.pending;
  }

  /** Forget the cached list; the next picker asks again. After any branch or access change. */
  invalidate(): void {
    this.loadedFor = null;
    this.pending = null;
  }

  list(): Observable<Branch[]> {
    return this.http.get<Branch[]>(this.apiUrl);
  }

  create(body: SaveBranch & { code: string; name: string }): Observable<Branch> {
    return this.http.post<Branch>(this.apiUrl, body).pipe(tap(() => this.invalidate()));
  }

  update(id: string, body: SaveBranch): Observable<Branch> {
    return this.http.patch<Branch>(`${this.apiUrl}/${id}`, body).pipe(tap(() => this.invalidate()));
  }

  /** Refused once anything was issued from the branch; deactivating is the alternative. */
  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`).pipe(tap(() => this.invalidate()));
  }

  getAccess(userId: string): Observable<UserBranchAccess> {
    return this.http.get<UserBranchAccess>(`${this.apiUrl}/access/${userId}`);
  }

  setAccess(userId: string, body: { branchIds: string[]; defaultBranchId: string | null }): Observable<UserBranchAccess> {
    return this.http.put<UserBranchAccess>(`${this.apiUrl}/access/${userId}`, body).pipe(tap(() => this.invalidate()));
  }

  /** `?branchId=` for a list or report, or nothing when no branch is chosen. */
  static params(branchId: string | null | undefined, params = new HttpParams()): HttpParams {
    return branchId ? params.set('branchId', branchId) : params;
  }
}
