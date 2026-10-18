import { Injectable, Logger } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { PERMISSIONS } from '../shared/permissions';
import { WorkflowDefinition } from './entities/workflow-definition.entity';
import { WorkflowInstance } from './entities/workflow-instance.entity';
import { WorkflowTask } from './entities/workflow-task.entity';
import { DirectoryUser, WorkflowDirectoryService } from './workflow-directory.service';

/** The in-app link a task's notices point at: the inbox, opened on that task. */
export const taskLink = (taskId: string): string => `/workflow-tasks?task=${taskId}`;

/**
 * Tells people about the workflow work that concerns them.
 *
 * Called only after the engine's transaction has committed, so a notice never announces a step
 * that was rolled back. Each notice is written in its recipient's own language and links to the
 * exact task, and when the task is decided or cancelled every notice about it is marked read — the
 * bell never keeps asking someone to act on something that is already closed.
 */
@Injectable()
export class WorkflowNotifier {
  private readonly logger = new Logger(WorkflowNotifier.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly directory: WorkflowDirectoryService,
  ) {}

  async taskCreated(task: WorkflowTask, instance: WorkflowInstance): Promise<void> {
    const recipients = await this.recipientsOf(task);
    const subject = instance.subject?.label ?? '';
    for (const recipient of recipients) {
      await this.send(recipient, {
        titleKey: task.nodeType === 'approval' ? 'workflow_engine.notify.approval_title' : 'workflow_engine.notify.task_title',
        bodyKey: subject ? 'workflow_engine.notify.task_body_subject' : 'workflow_engine.notify.task_body',
        params: { task: task.name, subject },
        link: taskLink(task.id),
        organizationId: task.organizationId,
      });
    }
  }

  /** The task no longer waits on anyone: its notices are read and say so (QA A-10). */
  async taskClosed(task: WorkflowTask): Promise<void> {
    await this.notifications.resolveByLink(task.organizationId, taskLink(task.id), {
      titleKey: 'workflow_engine.notify.task_closed_title',
      bodyKey: 'workflow_engine.notify.task_closed_body',
    });
  }

  async taskOverdue(task: WorkflowTask, instance: WorkflowInstance): Promise<void> {
    const recipients = await this.recipientsOf(task);
    const escalateTo = task.escalateToUserId ?? instance.startedByUserId;
    if (escalateTo && !recipients.some((user) => user.id === escalateTo)) {
      const [extra] = await this.directory.users(task.organizationId, undefined, [escalateTo]);
      if (extra) recipients.push(extra);
    }
    for (const recipient of recipients) {
      await this.send(recipient, {
        titleKey: 'workflow_engine.notify.overdue_title',
        bodyKey: 'workflow_engine.notify.overdue_body',
        params: { task: task.name, subject: instance.subject?.label ?? '' },
        link: taskLink(task.id),
        organizationId: task.organizationId,
      });
    }
  }

  /** A failed run needs someone who can fix and retry it: whoever started it, and the designers. */
  async instanceFailed(instance: WorkflowInstance, definition: WorkflowDefinition): Promise<void> {
    const ids = new Set<string>(await this.directory.userIdsWithPermission(instance.organizationId, PERMISSIONS.WORKFLOW_DESIGN));
    if (instance.startedByUserId) ids.add(instance.startedByUserId);
    const users = await this.directory.users(instance.organizationId, undefined, [...ids].slice(0, 50));
    for (const user of users) {
      await this.send(user, {
        titleKey: 'workflow_engine.notify.failed_title',
        bodyKey: 'workflow_engine.notify.failed_body',
        params: { workflow: definition.name, subject: instance.subject?.label ?? '' },
        link: `/workflow-instances/${instance.id}`,
        organizationId: instance.organizationId,
      });
    }
  }

  private async recipientsOf(task: WorkflowTask): Promise<DirectoryUser[]> {
    if (task.assigneeUserId) return this.directory.users(task.organizationId, undefined, [task.assigneeUserId]);
    if (task.assigneeRoleId) return this.directory.usersInRole(task.organizationId, task.assigneeRoleId);
    return [];
  }

  private async send(
    recipient: DirectoryUser,
    message: { titleKey: string; bodyKey: string; params: Record<string, unknown>; link: string; organizationId: string },
  ): Promise<void> {
    await this.notifications
      .createLocalizedNotification(recipient.id, recipient.language, message)
      .catch((error: unknown) => this.logger.warn(`Aviso de flujo no enviado a ${recipient.id}: ${(error as Error)?.message ?? error}`));
  }
}
