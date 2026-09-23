import {
  addMoney,
  applyBasisPoints,
  compareMoney,
  isNegativeMoney,
  moneyColumn,
  subtractMoney,
  toMoney,
  toDecimal,
} from './money';

describe('money', () => {
  it('declares the column the conventions require', () => {
    expect(moneyColumn).toEqual({ type: 'numeric', precision: 38, scale: 18 });
  });

  it('adds without the drift a float would introduce', () => {
    expect(addMoney('0.1', '0.2')).toBe('0.300000000000000000');
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('keeps all eighteen decimal places', () => {
    expect(addMoney('0.000000000000000001', '0.000000000000000002')).toBe('0.000000000000000003');
  });

  it('holds precision across a large notional', () => {
    expect(addMoney('12345678901234567890.123456789012345678', '0.000000000000000001')).toBe(
      '12345678901234567890.123456789012345679',
    );
  });

  it('normalises scale so equal amounts compare and serialise alike', () => {
    expect(toMoney(toDecimal('5'))).toBe('5.000000000000000000');
    expect(compareMoney('5', '5.000000000000000000')).toBe(0);
  });

  it('subtracts into negatives', () => {
    expect(subtractMoney('1', '2.5')).toBe('-1.500000000000000000');
    expect(isNegativeMoney(subtractMoney('1', '2.5'))).toBe(true);
  });

  it('orders amounts', () => {
    expect(compareMoney('10', '9.999999999999999999')).toBe(1);
    expect(compareMoney('9.999999999999999999', '10')).toBe(-1);
  });

  it('applies basis points exactly', () => {
    // 250 bps of 1000 is 25
    expect(applyBasisPoints('1000', 250)).toBe('25.000000000000000000');
    expect(applyBasisPoints('1000', 10_000)).toBe('1000.000000000000000000');
  });

  it('refuses fractional basis points', () => {
    expect(() => applyBasisPoints('1000', 2.5)).toThrow(/must be an integer/);
  });

  it('refuses a value that is not a finite number', () => {
    expect(() => toDecimal('not money')).toThrow(/finite monetary value/);
  });
});
