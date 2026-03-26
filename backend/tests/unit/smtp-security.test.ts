import { describe, it, expect, vi } from 'vitest';
import { isPrivateIp } from '../../src/services/email/smtp-config.service';

// ---------------------------------------------------------------------------
// Mock heavy dependencies so we can import isPrivateIp without side effects
// ---------------------------------------------------------------------------
vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: { getInstance: () => ({ getPool: () => ({}) }) },
}));
vi.mock('../../src/infra/security/encryption.manager', () => ({
  EncryptionManager: { encrypt: vi.fn(), decrypt: vi.fn() },
}));
vi.mock('../../src/utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('isPrivateIp', () => {
  // -------------------------------------------------------------------------
  // IPv4 — should be private
  // -------------------------------------------------------------------------
  describe('IPv4 private addresses', () => {
    it.each([
      ['127.0.0.1', 'loopback'],
      ['127.255.255.255', 'loopback range end'],
      ['10.0.0.1', 'class A private'],
      ['10.255.255.255', 'class A private end'],
      ['192.168.0.1', 'class C private'],
      ['192.168.255.255', 'class C private end'],
      ['172.16.0.1', '172.16 private start'],
      ['172.31.255.255', '172.31 private end'],
      ['169.254.1.1', 'link-local'],
      ['0.0.0.0', 'unspecified'],
    ])('%s (%s) is private', (ip) => {
      expect(isPrivateIp(ip)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // CGNAT (100.64.0.0/10) — should be private
  // -------------------------------------------------------------------------
  describe('CGNAT addresses (100.64.0.0/10)', () => {
    it.each([
      ['100.64.0.1', 'CGNAT start'],
      ['100.100.100.100', 'CGNAT mid'],
      ['100.127.255.255', 'CGNAT end'],
    ])('%s (%s) is private', (ip) => {
      expect(isPrivateIp(ip)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // IPv4 — should NOT be private
  // -------------------------------------------------------------------------
  describe('IPv4 public addresses', () => {
    it.each([
      ['8.8.8.8', 'Google DNS'],
      ['1.1.1.1', 'Cloudflare DNS'],
      ['172.32.0.1', 'just outside 172.16-31 range'],
      ['172.15.255.255', 'just below 172.16 range'],
      ['100.63.255.255', 'just below CGNAT range'],
      ['100.128.0.0', 'just above CGNAT range'],
      ['11.0.0.1', 'not 10.x'],
    ])('%s (%s) is public', (ip) => {
      expect(isPrivateIp(ip)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // IPv6 — should be private
  // -------------------------------------------------------------------------
  describe('IPv6 private addresses', () => {
    it.each([
      ['::1', 'loopback'],
      ['::', 'unspecified'],
      ['fe80::1', 'link-local'],
      ['fe80::', 'link-local base'],
      ['feb0::1', 'link-local fe80::/10 upper range'],
      ['fec0::1', 'site-local (deprecated)'],
      ['fef0::1', 'site-local fec0::/10 upper range'],
      ['fc00::1', 'unique local fc'],
      ['fd00::1', 'unique local fd'],
      ['fdff::1', 'unique local fd end'],
    ])('%s (%s) is private', (ip) => {
      expect(isPrivateIp(ip)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // IPv4-mapped IPv6 — should be private (SSRF prevention)
  // -------------------------------------------------------------------------
  describe('IPv4-mapped IPv6 addresses', () => {
    it.each([
      ['::ffff:127.0.0.1', 'mapped loopback'],
      ['::ffff:10.0.0.1', 'mapped class A private'],
      ['::ffff:192.168.1.1', 'mapped class C private'],
      ['::ffff:172.16.0.1', 'mapped 172.16 private'],
      ['::ffff:169.254.1.1', 'mapped link-local'],
      ['::ffff:100.64.0.1', 'mapped CGNAT'],
    ])('%s (%s) is private', (ip) => {
      expect(isPrivateIp(ip)).toBe(true);
    });

    it.each([
      ['::ffff:8.8.8.8', 'mapped Google DNS'],
      ['::ffff:1.1.1.1', 'mapped Cloudflare DNS'],
    ])('%s (%s) is public', (ip) => {
      expect(isPrivateIp(ip)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // IPv6 — should NOT be private
  // -------------------------------------------------------------------------
  describe('IPv6 public addresses', () => {
    it.each([
      ['2001:db8::1', 'documentation range'],
      ['2607:f8b0:4004:800::200e', 'Google public'],
      ['ff02::1', 'multicast (not private check scope)'],
    ])('%s (%s) is public', (ip) => {
      expect(isPrivateIp(ip)).toBe(false);
    });
  });
});
