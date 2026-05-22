export abstract class AbstractSmsProvider {
  abstract send(to: string, body: string): Promise<void>;
}
