import { DataSource, DataSourceOptions } from 'typeorm';

import { AppConfig } from '../config/app-config';

const { database } = AppConfig.load(process.env);

/**
 * Standalone DataSource used by the TypeORM CLI (migration:generate / run /
 * revert). The running application builds its options from AppConfig
 * instead - see src/config/database.config.ts.
 */
export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: database.host,
  port: database.port,
  username: database.username,
  password: database.password,
  database: database.name,
  synchronize: false,
  logging: database.logging,
  entities: [__dirname + '/../modules/**/entities/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
};

const dataSource = new DataSource(dataSourceOptions);

export default dataSource;
