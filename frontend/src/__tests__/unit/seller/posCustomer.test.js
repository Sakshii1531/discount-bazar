import { posBillCustomer, posCustomerIdOf } from '@/lib/posCustomer';

describe('posBillCustomer (POS bill customer label)', () => {
  it('shows the linked customer first', () => {
    const order = { posCustomer: { _id: 'c1', name: 'Ravi Kumar', phone: '9876500011' }, walkInCustomer: { name: '' } };
    expect(posBillCustomer(order)).toEqual({ name: 'Ravi Kumar', phone: '9876500011', isWalkIn: false });
  });

  it('falls back to typed details when no customer is linked (or it is a bare id)', () => {
    expect(posBillCustomer({ posCustomer: 'c1', walkInCustomer: { name: 'Asha', phone: '98' } })).toMatchObject({ name: 'Asha', phone: '98' });
  });

  it('is "Walk-in" only when nobody was chosen or typed', () => {
    expect(posBillCustomer({})).toEqual({ name: 'Walk-in', phone: '', isWalkIn: true });
    expect(posBillCustomer({}, 'Walk-in Customer').name).toBe('Walk-in Customer');
  });

  it('reads the customer id whether populated or not', () => {
    expect(posCustomerIdOf({ posCustomer: { _id: 'c1', name: 'Ravi' } })).toBe('c1');
    expect(posCustomerIdOf({ posCustomer: 'c2' })).toBe('c2');
    expect(posCustomerIdOf({})).toBe('');
  });
});
