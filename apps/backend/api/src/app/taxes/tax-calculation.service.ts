import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tax, TaxType } from './entities/tax.entity';
import { TaxConfiguration } from './entities/tax-configuration.entity';
import { Product } from '../inventory/entities/product.entity';
import { Customer } from '../customers/entities/customer.entity';
import { TaxRule } from './entities/tax-rule.entity';

interface TaxableLineItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
}

interface TaxCalculationContext {
  organizationId: string;
  lineItems: TaxableLineItem[];
  customerId?: string;
  shippingAddress?: {
    countryCode?: string;
    state?: string;
  };
}

interface TaxBreakdown {
  taxId: string;
  name: string;
  rate: number;
  amount: number;
}

export interface TaxCalculationResult {
  subtotal: number;
  totalTaxAmount: number;
  grandTotal: number;
  taxBreakdown: TaxBreakdown[];
}

@Injectable()
export class TaxCalculationService {
  private readonly logger = new Logger(TaxCalculationService.name);

  constructor(
    @InjectRepository(Tax)
    private readonly taxRepository: Repository<Tax>,
    @InjectRepository(TaxConfiguration)
    private readonly taxConfigRepository: Repository<TaxConfiguration>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(TaxRule)
    private readonly taxRuleRepository: Repository<TaxRule>,
  ) {}

  async calculateTaxes(
    context: TaxCalculationContext,
  ): Promise<TaxCalculationResult> {
    const rules = await this.taxRuleRepository.find({
      where: {},
      order: { priority: 'ASC' },
      relations: ['tax'],
    });

    const result: TaxCalculationResult = {
      subtotal: 0,
      totalTaxAmount: 0,
      grandTotal: 0,
      taxBreakdown: [],
    };

    const lineResults: { line: TaxableLineItem; breakdown: TaxBreakdown[] }[] =
      [];

    for (const line of context.lineItems) {
      const lineSubtotal = line.unitPrice * line.quantity;
      result.subtotal += lineSubtotal;

      const lineTaxableBase = lineSubtotal;
      const lineTaxBreakdown = new Map<string, TaxBreakdown>();

      const applicableRules = this.evaluateRulesForLine(rules, line, context);

      for (const rule of applicableRules) {
        let taxAmount = 0;
        const tax = rule.tax;

        let currentTaxableBase = lineTaxableBase;
        if (rule.isCompound) {
          lineTaxBreakdown.forEach((breakdown) => {
            currentTaxableBase += breakdown.amount;
          });
        }

        if (tax.type === TaxType.PERCENTAGE) {
          taxAmount = currentTaxableBase * (tax.rate / 100);
        } else {
          taxAmount = tax.rate * line.quantity;
        }

        if (rule.isWithholding) {
          taxAmount = -Math.abs(taxAmount);
        }

        const existingBreakdown = lineTaxBreakdown.get(tax.id) || {
          taxId: tax.id,
          name: tax.name,
          rate: tax.rate,
          amount: 0,
        };
        existingBreakdown.amount += taxAmount;
        lineTaxBreakdown.set(tax.id, existingBreakdown);
      }
      lineResults.push({
        line,
        breakdown: Array.from(lineTaxBreakdown.values()),
      });
    }

    const finalBreakdown = new Map<string, TaxBreakdown>();
    lineResults.forEach((lr) => {
      lr.breakdown.forEach((bd) => {
        const final = finalBreakdown.get(bd.taxId) || { ...bd, amount: 0 };
        final.amount += bd.amount;
        finalBreakdown.set(bd.taxId, final);
      });
    });

    result.taxBreakdown = Array.from(finalBreakdown.values());
    result.totalTaxAmount = result.taxBreakdown.reduce(
      (sum, tax) => sum + tax.amount,
      0,
    );
    result.grandTotal = result.subtotal + result.totalTaxAmount;

    return result;
  }

  private evaluateRulesForLine(
    rules: TaxRule[],
    line: TaxableLineItem,
    context: TaxCalculationContext,
  ): TaxRule[] {
    return rules;
  }
}
