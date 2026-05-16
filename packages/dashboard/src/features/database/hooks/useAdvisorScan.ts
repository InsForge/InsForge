import { useMutation } from '@tanstack/react-query';
import { databaseService } from '#features/database/services/database.service';

export function useAdvisorScan() {
  return useMutation({
    mutationKey: ['database', 'advisor', 'scan'],
    mutationFn: () => databaseService.runAdvisorScan(),
  });
}
