export interface Kpi {
    title: string;
    value: string;
    // Comparación (ej. vs presupuesto o vs año anterior)
    comparisonValue: string;
    comparisonPeriod: string;
    isPositive: boolean; // El cambio es bueno o malo?
    iconName: string;
    color: 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'teal';
}

export interface AlertItem {
    severity: 'critical' | 'warning';
    title: string;
    description: string;
}

export interface ExpenseCategory {
    name: string;
    y: number; // Porcentaje o valor
    color?: string;
}