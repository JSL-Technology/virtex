import {
  EventSubscriber,
  EntitySubscriberInterface,
  Connection,
} from 'typeorm';


@EventSubscriber()
export class OrganizationSubscriber implements EntitySubscriberInterface {
  constructor(connection: Connection) {




  }






}