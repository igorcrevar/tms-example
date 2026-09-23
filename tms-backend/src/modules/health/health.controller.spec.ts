import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';

import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let dataSource: { query: jest.Mock };

  const buildController = async (query: jest.Mock): Promise<HealthController> => {
    dataSource = { query };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: getDataSourceToken(), useValue: dataSource }],
    }).compile();

    return module.get<HealthController>(HealthController);
  };

  it('reports ok when the database answers', async () => {
    controller = await buildController(jest.fn().mockResolvedValue([{ '?column?': 1 }]));

    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(result.details.database).toEqual({ status: 'up' });
    expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('throws 503 when the database is unreachable', async () => {
    controller = await buildController(jest.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
