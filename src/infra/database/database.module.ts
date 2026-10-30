import { MikroORM } from "@mikro-orm/postgresql";
import { DynamicModule, Module, OnModuleDestroy } from "@nestjs/common";
import { initOrm } from "./orm-config";

class CloseOrm implements OnModuleDestroy {
  constructor(private readonly orm: MikroORM) {}

  async onModuleDestroy(): Promise<void> {
    await this.orm.close(true);
  }
}

@Module({})
export class DatabaseModule {
  static forRoot(clientUrl?: string): DynamicModule {
    return {
      module: DatabaseModule,
      global: true,
      providers: [
        {
          provide: MikroORM,
          useFactory: () => initOrm(clientUrl),
        },
        {
          provide: CloseOrm,
          useFactory: (orm: MikroORM) => new CloseOrm(orm),
          inject: [MikroORM],
        },
      ],
      exports: [MikroORM],
    };
  }
}
