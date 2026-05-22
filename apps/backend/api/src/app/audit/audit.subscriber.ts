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
    const request = RequestContext.currentContext.req;
    if (request && request.user) {
      const auditLog = new AuditLog();
      auditLog.userId = request.user.id;
      auditLog.entity = event.metadata.tableName;
      auditLog.entityId = event.entity.id;
      auditLog.actionType = actionType;
      auditLog.ipAddress = request.ip;
      auditLog.newValue = event.entity;
      if (actionType === ActionType.UPDATE) {
        auditLog.previousValue = event.databaseEntity;
      }
      await getManager().save(auditLog);
    }
  }
}