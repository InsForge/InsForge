/* eslint-disable no-console */
import { Etcd3, Lease } from 'etcd3';
import * as os from 'os';

interface EtcdServiceRegistryOptions {
  appKey?: string;
  port?: number;
  etcdHosts?: string;
  etcdUsername?: string;
  etcdPassword?: string;
  etcdTimeout?: number;
  ttl?: number;
  maxRetries?: number;
}

class EtcdServiceRegistry {
  private appKey: string;
  private port: number;
  private etcdHosts?: string;
  private etcdUsername: string;
  private etcdPassword: string;
  private etcdTimeout: number;
  private ttl: number;
  private maxRetries: number;
  private currentLease: Lease | null;
  private retryCount: number;
  private etcd: Etcd3 | null;
  private serviceKey: string | null;
  private serviceValue: string | null;

  constructor(options: EtcdServiceRegistryOptions = {}) {
    this.appKey = options.appKey || '';
    this.port = options.port || 7130;
    this.etcdHosts = options.etcdHosts;
    this.etcdUsername = options.etcdUsername || '';
    this.etcdPassword = options.etcdPassword || '';
    this.etcdTimeout = options.etcdTimeout || 5000;
    this.ttl = options.ttl || 10;
    this.maxRetries = options.maxRetries || 5;

    this.currentLease = null;
    this.retryCount = 0;
    this.etcd = null;
    this.serviceKey = null;
    this.serviceValue = null;
  }

  getLocalIPAddress(): string {
    const interfaces = os.networkInterfaces();
    let ipAddress = '127.0.0.1';

    for (const devName in interfaces) {
      const iface = interfaces[devName];
      if (!iface) {
        continue;
      }

      for (let i = 0; i < iface.length; i++) {
        const alias = iface[i];
        if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
          ipAddress = alias.address;
          break;
        }
      }
    }

    return ipAddress;
  }

  initializeEtcd(): void {
    if (!this.etcdHosts) {
      console.warn('ETCD_HOSTS environment variable is required');
      return;
    }
    if (!this.appKey) {
      console.warn('APP_KEY environment variable is required');
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const etcdConfig: any = {
      hosts: this.etcdHosts.split(',').map((host: string) => host.trim()),
      dialTimeout: this.etcdTimeout,
      keepaliveTime: 30000,
      keepaliveTimeout: 5000,
      retryDelay: 1000,
      maxRetries: 3,
    };

    if (this.etcdUsername && this.etcdPassword) {
      etcdConfig.auth = {
        username: this.etcdUsername,
        password: this.etcdPassword,
      };
    }

    console.log(`Connecting to etcd cluster: ${this.etcdHosts}`);
    this.etcd = new Etcd3(etcdConfig);
  }

  async testConnection(): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await this.etcd!.get('__connection_test__');
    } catch (error) {
      console.warn('etcd connection test warning:', error instanceof Error ? error.message : error);
    }
  }

  async register(): Promise<void> {
    if (!this.etcd) {
      this.initializeEtcd();
    }
    if (!this.etcd) {
      console.error(
        'Failed to initialize etcd client, you can ignore this error if etcd is not used'
      );
      return;
    }

    const ipAddress = this.getLocalIPAddress();
    this.serviceKey = `/services/${this.appKey}/${ipAddress}`;
    this.serviceValue = this.port.toString();

    try {
      await this.testConnection();

      this.currentLease = this.etcd.lease(this.ttl);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.currentLease.on('lost', (err: any) => {
        console.error('Lease lost:', err.message || err);
        this.retryCount = 0;
        setTimeout(() => this.register(), 1000);
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.currentLease.on('keepaliveFailed', (err: any) => {
        console.warn('Keepalive failed:', err.message || err);
      });

      this.currentLease.on('keepaliveEstablished', () => {
        console.log('Keepalive stream established');
      });

      await this.currentLease.grant();
      await this.currentLease.put(this.serviceKey).value(this.serviceValue);

      console.log(`Service registered: ${this.serviceKey} = ${this.serviceValue}`);

      this.retryCount = 0;
    } catch (error) {
      this.retryCount++;
      const delay = Math.min(5000 * Math.pow(2, this.retryCount - 1), 30000);

      console.error(
        `Failed to register service (attempt ${this.retryCount}/${this.maxRetries}):`,
        error instanceof Error ? error.message : error
      );

      if (this.retryCount >= this.maxRetries) {
        console.error('Max retries reached. Service registration failed permanently.');
        console.error('Service registration failed after max retries');
        return;
      }

      console.log(`Retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.register();
    }
  }

  async unregister(): Promise<void> {
    console.log('Unregistering service...');
    if (this.currentLease) {
      try {
        await this.currentLease.revoke();
        console.log('Lease revoked');
      } catch (error) {
        console.error('Failed to revoke lease:', error);
      }
    }
  }
}

export { EtcdServiceRegistry };
