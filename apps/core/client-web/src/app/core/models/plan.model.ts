export interface PlanLimit {
  id: string;
  resource: string;
  limit: number;
  period: 'monthly' | 'lifetime';
}

export interface Plan {
  id: string;
  slug: string;
  name: string;
  description: string;
  monthlyPriceId: string;
  annualPriceId: string;
  isActive: boolean;
  limits: PlanLimit[];
}
