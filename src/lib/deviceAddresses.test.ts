import { describe, expect, it } from 'vitest';
import { sameAddresses, withInterfaceAddresses } from './deviceAddresses';

let n = 0;
const id = () => `new-${++n}`;
const ifaces = [
  { ip: '192.0.2.1', interface: 'Vlan10' },
  { ip: '198.51.100.1', interface: 'Vlan20' },
  { ip: '203.0.113.1/24', interface: 'Loopback0' },
  { ip: '127.0.0.1', interface: 'lo' },
  { ip: '', interface: 'Gi1/0/1' },
];

describe("a device's own interface addresses, under its checks", () => {
  it('lists every interface address, the one it is managed on as the primary', () => {
    const got = withInterfaceAddresses([], '192.0.2.1', ifaces, id);
    expect(got.map((a) => [a.label, a.address, a.isPrimary])).toEqual([
      ['Vlan10', '192.0.2.1', true],
      ['Vlan20', '198.51.100.1', false],
      ['Loopback0', '203.0.113.1', false],
    ]);
  });

  it('keeps what was typed — its id, its label — and the management address stays primary', () => {
    const had = [{ id: 'mine', label: 'Management', address: '192.0.2.1', isPrimary: true }, { id: 'other', label: 'OOB', address: '192.0.2.99', isPrimary: false }];
    const got = withInterfaceAddresses(had, '192.0.2.1', ifaces, id);
    expect(got[0]).toEqual(had[0]);
    expect(got[1]).toEqual(had[1]);
    expect(got.filter((a) => a.isPrimary).map((a) => a.address)).toEqual(['192.0.2.1']);
    expect(got.map((a) => a.address)).toEqual(['192.0.2.1', '192.0.2.99', '198.51.100.1', '203.0.113.1']);
  });

  it('makes the address it was reached on the primary even where another was', () => {
    const had = [{ id: 'a', label: 'Vlan20', address: '198.51.100.1', isPrimary: true }];
    const got = withInterfaceAddresses(had, '192.0.2.1', ifaces, id);
    expect(got.filter((a) => a.isPrimary).map((a) => a.address)).toEqual(['192.0.2.1']);
  });

  it('read a second time, changes nothing', () => {
    const once = withInterfaceAddresses([], '192.0.2.1', ifaces, id);
    const twice = withInterfaceAddresses(once, '192.0.2.1', ifaces, id);
    expect(twice).toEqual(once);
    expect(sameAddresses(once, twice)).toBe(true);
  });

  it('with no interface table, still has the address that answered', () => {
    expect(withInterfaceAddresses([], '192.0.2.1', [], id).map((a) => [a.label, a.address, a.isPrimary])).toEqual([['Discovered', '192.0.2.1', true]]);
  });
});

describe('addresses nothing off the link can reach', () => {
  const local = [
    { ip: '192.0.2.1', interface: 'Vlan10' },
    { ip: 'fe80::1', interface: 'Vlan10' },
    { ip: 'FE80::0211:22ff:fe33:4455%eth0/64', interface: 'eth0' },
    { ip: 'febf::1', interface: 'eth1' },
    { ip: '169.254.10.20', interface: 'Gi0/0' },
    { ip: '169.254.0.1/16', interface: 'Gi0/1' },
    { ip: '2001:db8::1', interface: 'Loopback0' },
    { ip: '169.25.4.1', interface: 'Vlan30' },
  ];

  it('are not listed: IPv6 link-local and IPv4 self-assigned', () => {
    const got = withInterfaceAddresses([], '192.0.2.1', local, id);
    expect(got.map((a) => a.address)).toEqual(['192.0.2.1', '2001:db8::1', '169.25.4.1']);
  });

  it('but one somebody typed, or the one that was dialled, stays', () => {
    const had = [{ id: 'mine', label: 'Lab', address: '169.254.10.20', isPrimary: true }];
    const got = withInterfaceAddresses(had, '169.254.10.20', local, id);
    expect(got[0]).toEqual(had[0]);
    expect(got.filter((a) => a.address.startsWith('169.254.')).length).toBe(1);
    expect(got.some((a) => /^fe[89ab]/i.test(a.address))).toBe(false);
  });
});
