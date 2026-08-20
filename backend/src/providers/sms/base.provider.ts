import type { RawSmsConfig } from '@/services/sms/sms-config.service.js';

/**
 * SMS provider interface
 * Defines the contract that all SMS providers must implement
 */
export interface SmsProvider {
  /**
   * Send an SMS message
   * @param to - Recipient phone number (E.164)
   * @param body - Message text
   * @param config - Resolved SMS configuration (credentials already decrypted)
   */
  send(to: string, body: string, config: RawSmsConfig): Promise<void>;
}
