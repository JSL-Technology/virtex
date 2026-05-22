import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

// Define las interfaces para los DTOs que vienen del backend
export interface WorkingCapitalDto {
  workingCapital: number;
  date: Date;
}

export interface QuickRatioDto {
  quickRatio: number;
  date: Date;
}

export interface CurrentRatioDto {
  currentRatio: number;
  date: Date;
}

export interface RoadDto {
  roa: number;
  date: Date;
}

export interface RoeDto {
  roe: number;
  date: Date;
}

export interface LeverageDto {
  leverage: number;
  date: Date;
}

export interface NetMarginDto {
  netMargin: number;
  date: Date;
}

export interface EbitdaDto {
  ebitda: number;
  date: Date;
}

export interface FcfDto {
  freeCashFlow: number;
  date: Date;
}

export interface CashFlowWaterfallDto {
  openingBalance: number;
  operatingIncome: number;
  costOfGoodsSold: number;
  operatingExpenses: number;
  investments: number;
  financing: number;
  endingBalance: number;
}


@Injectable({
  providedIn: 'root'
})
export class DashboardApiService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/dashboard`; // Asumiendo que el proxy está configurado para /api

  getWorkingCapital(): Observable<WorkingCapitalDto> {
    return this.http.get<WorkingCapitalDto>(`${this.apiUrl}/kpi/working-capital`);
  }

  getQuickRatio(): Observable<QuickRatioDto> {
    return this.http.get<QuickRatioDto>(`${this.apiUrl}/kpi/quick-ratio`);
  }

  getCurrentRatio(): Observable<CurrentRatioDto> {
    return this.http.get<CurrentRatioDto>(`${this.apiUrl}/kpi/current-ratio`);
  }

  getROA(): Observable<RoadDto> {
    return this.http.get<RoadDto>(`${this.apiUrl}/kpi/roa`);
  }

  getROE(): Observable<RoeDto> {
    return this.http.get<RoeDto>(`${this.apiUrl}/kpi/roe`);
  }

  getLeverage(): Observable<LeverageDto> {
    return this.http.get<LeverageDto>(`${this.apiUrl}/kpi/leverage`);
  }

  getNetMargin(): Observable<NetMarginDto> {
    return this.http.get<NetMarginDto>(`${this.apiUrl}/kpi/net-margin`);
  }

  getEBITDA(): Observable<EbitdaDto> {
    return this.http.get<EbitdaDto>(`${this.apiUrl}/kpi/ebitda`);
  }

  getFreeCashFlow(): Observable<FcfDto> {
    return this.http.get<FcfDto>(`${this.apiUrl}/kpi/fcf`);
  }

  getConsolidatedCashFlowWaterfall(): Observable<CashFlowWaterfallDto> {
    return this.http.get<CashFlowWaterfallDto>(`${this.apiUrl}/consolidated-cash-flow-waterfall`);
  }
}
