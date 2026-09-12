import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { JournalEntriesModule } from '../journal-entries/journal-entries.module';
import { Employee } from '../hcm/entities/employee.entity';
import { EmployeeCompensation } from '../hcm/entities/employee-compensation.entity';
import { PayrollRun } from './entities/payroll-run.entity';
import { Payslip } from './entities/payslip.entity';
import { PayslipLine } from './entities/payslip-line.entity';
import { PayrollConcept } from './entities/payroll-concept.entity';
import { PayrollInput } from './entities/payroll-input.entity';
import { StatutoryContribution } from './entities/statutory-contribution.entity';
import { IncomeTaxBracket } from './entities/income-tax-bracket.entity';
import { StatutoryReference } from './entities/statutory-reference.entity';
import { JurisdictionRegistry } from './jurisdictions/jurisdiction-registry';
import { PayrollParametersService } from './services/payroll-parameters.service';
import { PayrollParametersAdminService } from './services/payroll-parameters-admin.service';
import { PayrollCalculationService } from './services/payroll-calculation.service';
import { SeveranceService } from './services/severance.service';
import { PayrollAccountingService } from './services/payroll-accounting.service';
import { PayrollRunService } from './services/payroll-run.service';
import { PayrollTssService } from './services/payroll-tss.service';
import { PayrollConceptService } from './services/payroll-concept.service';
import { PayrollInputService } from './services/payroll-input.service';
import { PayrollController } from './payroll.controller';

/**
 * Payroll: the calculation engine, the run lifecycle, the accounting posting and the TSS filings.
 *
 * The statutory-parameter entities are registered here as global reference data; the tenant tables
 * (runs, payslips) and the employee tables are read through the same repositories the HCM module
 * owns. Accounting is reached through {@link JournalEntriesModule}, so the payroll entry goes through
 * the one validated, balanced posting path.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PayrollRun,
      Payslip,
      PayslipLine,
      PayrollConcept,
      PayrollInput,
      StatutoryContribution,
      IncomeTaxBracket,
      StatutoryReference,
      Employee,
      EmployeeCompensation,
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => JournalEntriesModule),
    AuditModule,
  ],
  controllers: [PayrollController],
  providers: [
    JurisdictionRegistry,
    PayrollParametersService,
    PayrollParametersAdminService,
    PayrollCalculationService,
    SeveranceService,
    PayrollAccountingService,
    PayrollRunService,
    PayrollTssService,
    PayrollConceptService,
    PayrollInputService,
  ],
  exports: [PayrollCalculationService, SeveranceService, PayrollRunService],
})
export class PayrollModule {}
