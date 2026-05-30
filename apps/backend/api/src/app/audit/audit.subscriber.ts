import {
  EventSubscriber,
  EntitySubscriberInterface,
  InsertEvent,
  UpdateEvent,
  RemoveEvent,
} from 'typeorm';
import { AuditLog, ActionType } from './entities/audit-log.entity';
import { RequestContext } from 'nestjs-request-context';
import { getManager } from 'typeorm';

@EventSubscriber()
export class AuditSubscriber implements EntitySubscriberInterface<any> {
  listenTo() {
    return Object;
  }

  async afterInsert(event: InsertEvent<any>) {
    this.log(ActionType.CREATE, event);
  }

  async afterUpdate(event: UpdateEvent<any>) {
    this.log(ActionType.UPDATE, event);
  }

  async afterRemove(event: RemoveEvent<any>) {
    this.log(ActionType.DELETE, event);
  }

  private async log(actionType: ActionType, event: any) {
    if (event.metadata.target === AuditLog || event.metadata.tableName === 'audit_logs') {
      return;
    }

    const entity = event.entity ?? event.databaseEntity;
    const request = RequestContext.currentContext?.req;
    if (request?.user && entity?.id) {
      const auditLog = new AuditLog();
      auditLog.userId = request.user.id;
      auditLog.organizationId = request.user.organizationId ?? entity.organizationId ?? null;
      auditLog.entity = event.metadata.tableName;
      auditLog.entityId = entity.id;
      auditLog.actionType = actionType;
      auditLog.ipAddress = request.ip;
      auditLog.newValue = event.entity ?? null;
      if (actionType === ActionType.UPDATE) {
        auditLog.previousValue = event.databaseEntity;
      }
      await getManager().save(auditLog);
    }
  }
}