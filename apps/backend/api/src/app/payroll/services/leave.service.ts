import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { roundAmount, sumAmounts } from '../../common/money';
import { BadRequestError, ConflictError, NotFoundError } from '../../i18n/localized.exception';
import { Employee } from '../../hcm/entities/employee.entity';
import { EmployeeLeave, LeaveKind, LeaveStatus } from '../entities/employee-leave.entity';

/**
 * Public holidays that fall on the same date every year. The movable ones (6 and 26 January,
 * Good Friday, 1 May, Corpus Christi, 6 November) are moved by Ley 139-97 to the nearest Monday
 * and must be added by the company the year they apply; the leave counts them as working days
 * until then, which errs towards the employee keeping days.
 */
const FIXED_HOLIDAYS = ['01-01', '01-21', '02-27', '08-16', '09-24', '12-25'];

/** Art. 180: vacation of a worker with less than a year of service, by completed months. */
const PROPORTIONAL_DAYS: Record<number, number> = { 5: 6, 6: 7, 7: 8, 8: 9, 9: 10, 10: 11, 11: 12 };

export interface VacationBalance {
  employeeId: string;
  hireDate: string;
  asOf: string;
  /** Completed months of service. */
  monthsOfService: number;
  /** The service year the current entitlement belongs to (0 before the first anniversary). */
  serviceYear: number;
  /** Working days the law grants for that year: 14, 18 after five years, proportional before one. */
  entitled: number;
  taken: number;
  pending: number;
  available: number;
}

export interface RequestLeaveInput {
  kind: LeaveKind;
  startDate: string;
  endDate: string;
  reason?: string | null;
}

/**
 * Leave, and the vacation the Dominican Labour Code grants.
 *
 * - Art. 177: 14 working days of paid vacation after one year of uninterrupted service; 18 after
 *   five.
 * - Art. 180: under a year, a proportional vacation from five completed months (6 days) to eleven
 *   (12 days).
 *
 * A vacation consumes the entitlement of the service year it is requested in; an approval that
 * would exceed it is refused. Other kinds of leave are recorded and approved, not counted against
 * the vacation.
 */
@Injectable()
export class LeaveService {
  constructor(
    @InjectRepository(EmployeeLeave) private readonly leaves: Repository<EmployeeLeave>,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
  ) {}

  async balance(organizationId: string, employeeId: string, asOf: string = today()): Promise<VacationBalance> {
    const employee = await this.requireEmployee(organizationId, employeeId);
    const months = LeaveService.monthsBetween(employee.hireDate, asOf);
    const serviceYear = Math.floor(months / 12);
    const entitled = LeaveService.entitlement(months);
    const vacations = await this.leaves.find({
      where: {
        organizationId,
        employeeId,
        kind: LeaveKind.VACATION,
        serviceYear,
        status: In([LeaveStatus.APPROVED, LeaveStatus.REQUESTED]),
      },
    });
    const taken = sumAmounts(vacations.filter((l) => l.status === LeaveStatus.APPROVED).map((l) => Number(l.businessDays)));
    const pending = sumAmounts(vacations.filter((l) => l.status === LeaveStatus.REQUESTED).map((l) => Number(l.businessDays)));
    return {
      employeeId,
      hireDate: employee.hireDate,
      asOf,
      monthsOfService: months,
      serviceYear,
      entitled,
      taken,
      pending,
      available: roundAmount(Math.max(0, entitled - taken)),
    };
  }

  list(organizationId: string, filter: { employeeId?: string; status?: LeaveStatus } = {}): Promise<EmployeeLeave[]> {
    return this.leaves.find({
      where: {
        organizationId,
        ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      order: { startDate: 'DESC' },
      take: 500,
    });
  }

  async request(organizationId: string, employeeId: string, input: RequestLeaveInput, actorId: string | null): Promise<EmployeeLeave> {
    const employee = await this.requireEmployee(organizationId, employeeId);
    if (input.endDate < input.startDate) throw new BadRequestError('payroll.leave.end_before_start');
    if (input.startDate < employee.hireDate) throw new BadRequestError('payroll.leave.before_hire');
    const businessDays = LeaveService.businessDays(input.startDate, input.endDate);
    if (businessDays <= 0) throw new BadRequestError('payroll.leave.no_working_days');

    const overlapping = await this.leaves
      .createQueryBuilder('leave')
      .where('leave.organizationId = :organizationId', { organizationId })
      .andWhere('leave.employeeId = :employeeId', { employeeId })
      .andWhere('leave.status IN (:...active)', { active: [LeaveStatus.REQUESTED, LeaveStatus.APPROVED] })
      .andWhere('leave.startDate <= :end AND leave.endDate >= :start', { start: input.startDate, end: input.endDate })
      .getCount();
    if (overlapping > 0) throw new ConflictError('payroll.leave.overlaps');

    let serviceYear: number | null = null;
    if (input.kind === LeaveKind.VACATION) {
      const balance = await this.balance(organizationId, employeeId, input.startDate);
      if (balance.entitled === 0) throw new BadRequestError('payroll.leave.vacation_not_yet_earned');
      if (businessDays > roundAmount(balance.entitled - balance.taken - balance.pending)) {
        throw new BadRequestError('payroll.leave.vacation_exceeds_balance', {
          requested: businessDays,
          available: roundAmount(balance.entitled - balance.taken - balance.pending),
        });
      }
      serviceYear = balance.serviceYear;
    }

    return this.leaves.save(
      this.leaves.create({
        organizationId,
        employeeId,
        kind: input.kind,
        startDate: input.startDate,
        endDate: input.endDate,
        businessDays,
        serviceYear,
        status: LeaveStatus.REQUESTED,
        reason: input.reason?.trim() || null,
        requestedById: actorId,
      }),
    );
  }

  async decide(
    organizationId: string,
    leaveId: string,
    decision: 'approve' | 'reject' | 'cancel',
    actorId: string,
    note?: string,
  ): Promise<EmployeeLeave> {
    const leave = await this.leaves.findOne({ where: { id: leaveId, organizationId } });
    if (!leave) throw new NotFoundError('payroll.leave.not_found');
    if (decision === 'cancel') {
      if (leave.status === LeaveStatus.CANCELLED || leave.status === LeaveStatus.REJECTED) {
        throw new ConflictError('payroll.leave.already_closed');
      }
      leave.status = LeaveStatus.CANCELLED;
    } else {
      if (leave.status !== LeaveStatus.REQUESTED) throw new ConflictError('payroll.leave.already_decided');
      if (decision === 'reject' && !note?.trim()) throw new BadRequestError('payroll.leave.rejection_reason_required');
      leave.status = decision === 'approve' ? LeaveStatus.APPROVED : LeaveStatus.REJECTED;
    }
    leave.decidedById = actorId;
    leave.decidedAt = new Date();
    leave.decisionNote = note?.trim() || null;
    return this.leaves.save(leave);
  }

  // ── The arithmetic, apart from the database ────────────────────────────────

  /** Working days the law grants for the service year a worker is in, by completed months. */
  static entitlement(monthsOfService: number): number {
    if (monthsOfService >= 60) return 18;
    if (monthsOfService >= 12) return 14;
    return PROPORTIONAL_DAYS[monthsOfService] ?? 0;
  }

  /** Completed months between two `YYYY-MM-DD` dates. */
  static monthsBetween(from: string, to: string): number {
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    let months = (ty - fy) * 12 + (tm - fm);
    if (td < fd) months -= 1;
    return Math.max(0, months);
  }

  /** Monday to Friday between two dates inclusive, without the fixed public holidays. */
  static businessDays(start: string, end: string): number {
    let count = 0;
    const day = new Date(`${start}T12:00:00Z`);
    const last = new Date(`${end}T12:00:00Z`);
    while (day.getTime() <= last.getTime()) {
      const weekday = day.getUTCDay();
      const monthDay = day.toISOString().slice(5, 10);
      if (weekday !== 0 && weekday !== 6 && !FIXED_HOLIDAYS.includes(monthDay)) count++;
      day.setUTCDate(day.getUTCDate() + 1);
    }
    return count;
  }

  private async requireEmployee(organizationId: string, employeeId: string): Promise<Employee> {
    const employee = await this.employees.findOne({
      where: { id: employeeId, organizationId },
      select: ['id', 'hireDate', 'organizationId'],
    });
    if (!employee) throw new NotFoundError('payroll.leave.employee_not_found');
    return employee;
  }
}

function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(new Date());
}
