import { TypeOrmModuleOptions } from '@nestjs/typeorm';

import { AppConfig } from './app-config';

export function buildTypeOrmOptions(config: AppConfig): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    host: config.database.host,
    port: config.database.port,
    username: config.database.username,
    password: config.database.password,
    database: config.database.name,
    autoLoadEntities: true,
    // Migrations are the only way schema changes reach any environment.
    synchronize: false,
    logging: config.database.logging,
    migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
  };
}
