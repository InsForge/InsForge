import { useCallback } from 'react';
import { partnershipService } from '../services/partnership.service';

/**
 * Hook to check if origins are partner sites
 * Delegates to the partnership service which handles caching and fetching
 */
export function usePartnerOrigin() {
  /**
   * Checks if an origin is a partner origin
   * The service handles caching, so first call fetches, subsequent calls return cached result
   */
  const isPartnerOrigin = useCallback(async (origin: string): Promise<boolean> => {
    const config = await partnershipService.fetchConfig();

    if (!config?.partner_sites || config.partner_sites.length === 0) {
      return false;
    }

    // Exact match only
    return config.partner_sites.includes(origin);
  }, []);

  return {
    isPartnerOrigin,
  };
}
