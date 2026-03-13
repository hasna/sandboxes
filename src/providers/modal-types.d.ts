declare module "modal" {
  export class ModalClient {
    constructor(opts?: Record<string, unknown>);
    apps: {
      fromName(name: string, opts?: { createIfMissing?: boolean }): Promise<unknown>;
    };
    images: {
      fromRegistry(name: string): unknown;
    };
    sandboxes: {
      create(app: unknown, image: unknown, opts?: Record<string, unknown>): Promise<unknown>;
    };
    functions: {
      fromName(app: string, name: string): Promise<unknown>;
    };
  }
}
