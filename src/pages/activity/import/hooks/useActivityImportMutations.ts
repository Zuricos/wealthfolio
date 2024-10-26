import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  checkActivitiesImport,
  createActivities,
  saveAccountImportMapping,
} from '@/commands/activity-import';
import { useCalculateHistoryMutation } from '@/hooks/useCalculateHistory';
import { toast } from '@/components/ui/use-toast';
import { QueryKeys } from '@/lib/query-keys';
import { ImportMappingData } from '@/lib/types';

export function useActivityImportMutations({
  onSuccess,
  onError,
}: {
  onSuccess?: (activities: any[]) => void;
  onError?: (error: string) => void;
} = {}) {
  const queryClient = useQueryClient();

  const calculateHistoryMutation = useCalculateHistoryMutation({
    successTitle: 'Activities imported successfully.',
  });

  const confirmImportMutation = useMutation({
    mutationFn: createActivities,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QueryKeys.ACTIVITY_DATA] });
      calculateHistoryMutation.mutate({
        accountIds: undefined,
        forceFullCalculation: true,
      });
      toast({
        title: 'Import successful',
        description: 'Activities have been imported successfully.',
      });
    },
    onError: (error: any) => {
      console.log('error', error);
      toast({
        title: 'Uh oh! Something went wrong.',
        description: 'Please try again or report an issue if the problem persists.',
        variant: 'destructive',
      });
    },
  });

  const saveAndCheckImportMutation = useMutation({
    mutationFn: async ({
      data,
      activitiesToImport,
    }: {
      data: ImportMappingData;
      activitiesToImport: any[];
    }) => {
      // Save the mapping
      await saveAccountImportMapping(data);

      // Then check the activities
      return await checkActivitiesImport({
        account_id: data.accountId,
        activities: activitiesToImport,
      });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: [QueryKeys.IMPORT_MAPPING] });
      onSuccess?.(result);
    },
    onError: (error: any) => {
      const errorMessage = `Import failed: ${error.message}`;
      onError?.(errorMessage);
      toast({
        title: 'Error importing activities',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    confirmImportMutation,
    saveAndCheckImportMutation,
  };
}
