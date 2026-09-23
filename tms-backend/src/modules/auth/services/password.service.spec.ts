import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();
  const password = 'correct horse battery staple';

  it('hashes with argon2id and verifies the result', async () => {
    const hash = await service.hash(password);

    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    await expect(service.verify(hash, password)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await service.hash(password);

    await expect(service.verify(hash, 'wrong password entirely')).resolves.toBe(false);
  });

  it('salts, so the same password hashes differently each time', async () => {
    await expect(service.hash(password)).resolves.not.toBe(await service.hash(password));
  });

  it('returns false instead of throwing on a malformed hash', async () => {
    await expect(service.verify('not-a-hash', password)).resolves.toBe(false);
  });
});
