import { useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { useQuery } from '@tanstack/react-query';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import { Link } from 'react-router-dom';
import {
  Account,
  ActivityType,
  ActivityImport,
  ImportFormat,
  ImportMappingData,
} from '@/lib/types';
import { getAccountImportMapping } from '@/commands/activity-import';
import { useActivityImportMutations } from './hooks/useActivityImportMutations';

// Components
import { FileDropzone } from './components/file-dropzone';
import { ImportMappingTable } from './components/import-mapping-table';
import { QueryKeys } from '@/lib/query-keys';
import { getAccounts } from '@/commands/account';
import { ErrorViewer } from './components/csv-error-viewer';

import { useCsvParser } from './hooks/useCsvParser';
import { useImportMapping } from './hooks/useImportMapping';
import { isCashActivity, isImportMapComplete } from './utils/csvValidation';
import { validateActivities } from './utils/csvValidation';
import { Separator } from '@/components/ui/separator';

export function ActivityImportForm({
  onSuccess,
  onError,
}: {
  onSuccess: (activities: ActivityImport[]) => void;
  onError: (error: string) => void;
}) {
  const {
    csvData,
    headers,
    error,
    validationErrors,
    isLoading,
    selectedFile,
    isValidCsv,
    parseCsvFile,
    resetFileStates,
    setValidationErrors,
  } = useCsvParser();

  const { data: accounts } = useQuery<Account[], Error>({
    queryKey: [QueryKeys.ACCOUNTS],
    queryFn: getAccounts,
  });

  const {
    mapping,
    updateMapping,
    handleColumnMapping,
    handleActivityTypeMapping,
    handleSymbolMapping,
  } = useImportMapping();

  const { data: fetchedMapping } = useQuery({
    queryKey: [QueryKeys.IMPORT_MAPPING, mapping.accountId],
    queryFn: () => getAccountImportMapping(mapping.accountId),
    enabled: !!mapping.accountId,
  });

  console.log('fetchedMapping', fetchedMapping);

  // Update mapping when fetched mapping is available
  useEffect(() => {
    if (fetchedMapping) {
      updateMapping(fetchedMapping);
    }
  }, [fetchedMapping, updateMapping]);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      resetFileStates();
      parseCsvFile(file, mapping);
    },
    [parseCsvFile, mapping, resetFileStates],
  );

  const { saveAndCheckImportMutation } = useActivityImportMutations({
    onSuccess,
    onError: (error) => onError(`Import failed: ${error}`),
  });

  const getMappedValue = useCallback(
    (row: string[], field: ImportFormat): string => {
      const columnIndex = headers.indexOf(mapping.fieldMappings[field] || '');
      if (columnIndex === -1) return '';
      return row[columnIndex];
    },
    [headers, mapping.fieldMappings],
  );

  const isMapComplete = useCallback(() => {
    return isImportMapComplete(headers, mapping, csvData, getMappedValue);
  }, [headers, mapping, csvData, getMappedValue]);

  const getMappedActivityType = useCallback(
    (row: string[]): ActivityType => {
      const csvType = getMappedValue(row, ImportFormat.ActivityType);
      const normalizedCsvType = csvType.trim().toUpperCase();

      for (const [appType, csvTypes] of Object.entries(mapping.activityMappings)) {
        if (
          csvTypes?.some((mappedType) => {
            const normalizedMappedType = mappedType.trim().toUpperCase();
            return normalizedCsvType.startsWith(normalizedMappedType);
          })
        ) {
          return appType as ActivityType;
        }
      }
      return csvType as ActivityType; // Fallback to original value if no mapping found
    },
    [getMappedValue, mapping.activityMappings],
  );

  const handleImport = async () => {
    try {
      const activitiesToImport: ActivityImport[] = csvData.slice(1).map((row) => {
        const activityType = getMappedActivityType(row);
        const isCash = isCashActivity(activityType);

        let amount: number | undefined;
        let quantity: number;
        let unitPrice: number;

        // Try to get amount from the CSV if the field is mapped
        const rawAmount = getMappedValue(row, ImportFormat.Amount);
        if (rawAmount) {
          amount = parseFloat(rawAmount) || undefined;
        }

        if (isCash) {
          // For cash activities, calculate amount if not provided
          if (!amount) {
            quantity = parseFloat(getMappedValue(row, ImportFormat.Quantity)) || 1;
            unitPrice = parseFloat(getMappedValue(row, ImportFormat.UnitPrice)) || 0;
            amount = quantity * unitPrice;
          }
          // Set quantity and unitPrice to match the amount
          quantity = 1;
          unitPrice = amount || 0;
        } else {
          // For non-cash activities, use regular quantity and unit price
          quantity = parseFloat(getMappedValue(row, ImportFormat.Quantity));
          unitPrice = parseFloat(getMappedValue(row, ImportFormat.UnitPrice));
        }

        // Get currency from CSV if mapped, otherwise use account currency
        const currency =
          getMappedValue(row, ImportFormat.Currency) ||
          accounts?.find((a) => a.id === mapping.accountId)?.currency;

        // Get the raw symbol and use the mapped symbol if available
        const rawSymbol = getMappedValue(row, ImportFormat.Symbol).trim();
        const symbol = mapping.symbolMappings[rawSymbol] || rawSymbol;

        return {
          date: getMappedValue(row, ImportFormat.Date),
          assetId: symbol,
          symbol: symbol,
          activityType,
          quantity,
          unitPrice,
          currency,
          fee: parseFloat(getMappedValue(row, ImportFormat.Fee)) || 0,
          amount,
          accountId: mapping.accountId,
          isValid: false,
          isDraft: true,
          comment: '',
        };
      });

      // Validate activities
      const validationErrors = validateActivities(activitiesToImport);
      if (Object.keys(validationErrors).length > 0) {
        setValidationErrors(validationErrors);
        return;
      }

      await saveAndCheckImportMutation.mutateAsync({
        data: mapping,
        activitiesToImport,
      });
    } catch (error: any) {
      onError(`Import failed: ${error}`);
    }
  };

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    open: openFilePicker,
  } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
    },
    noClick: true,
  });

  return (
    <div className="flex h-[calc(100vh-theme(spacing.16))] flex-col overflow-hidden">
      <div className="flex h-full flex-col gap-4 overflow-hidden">
        <div className="shrink-0 space-y-4">
          <AccountSelection
            value={mapping.accountId}
            onChange={(id) => updateMapping({ accountId: id })}
            accounts={accounts}
          />
          <FileDropzone
            getRootProps={getRootProps}
            getInputProps={getInputProps}
            isDragActive={isDragActive}
            selectedFile={selectedFile}
            isLoading={isLoading}
            openFilePicker={openFilePicker}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <PreviewContent
            accountId={mapping.accountId}
            selectedFile={selectedFile}
            isValidCsv={isValidCsv}
            error={error}
            headers={headers}
            mapping={mapping}
            handleColumnMapping={handleColumnMapping}
            handleActivityTypeMapping={handleActivityTypeMapping}
            handleSymbolMapping={handleSymbolMapping}
            importFormatFields={Object.values(ImportFormat)}
            csvData={csvData}
            getMappedValue={getMappedValue}
            validationErrors={validationErrors}
          />
        </div>

        <div className="flex shrink-0 gap-4 pt-4">
          <Button asChild variant="outline">
            <Link to="/activities">Cancel</Link>
          </Button>
          {mapping.accountId && selectedFile && isMapComplete() && (
            <Button onClick={handleImport} disabled={saveAndCheckImportMutation.isPending}>
              {saveAndCheckImportMutation.isPending ? (
                <>
                  <Icons.Spinner className="mr-2 h-4 w-4 animate-spin" />
                  <span>Importing...</span>
                </>
              ) : (
                <span>Import Data</span>
              )}
            </Button>
          )}
          {mapping.accountId && selectedFile && !isMapComplete() && (
            <p className="flex items-center text-sm text-red-400">
              <Icons.AlertTriangle className="mr-2 h-4 w-4" />
              Please map all columns and activity types before importing.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function AccountSelection({
  value,
  onChange,
  accounts,
}: {
  value: string;
  onChange: (value: string) => void;
  accounts: Account[] | undefined;
}) {
  console.log('AccountSelection', value);
  return (
    <div className="mb-4">
      <label htmlFor="accountId" className="mb-1 block text-sm font-medium">
        Select Account
      </label>
      <Select onValueChange={onChange} value={value}>
        <SelectTrigger>
          <SelectValue placeholder="Select an account" />
        </SelectTrigger>
        <SelectContent>
          {accounts ? (
            accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name}
              </SelectItem>
            ))
          ) : (
            <SelectItem value="">Loading accounts...</SelectItem>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}

function PreviewContent({
  accountId,
  selectedFile,
  isValidCsv,
  error,
  headers,
  mapping,
  handleColumnMapping,
  handleActivityTypeMapping,
  handleSymbolMapping,
  importFormatFields,
  csvData,
  getMappedValue,
  validationErrors,
}: {
  accountId: string;
  selectedFile: File | null;
  isValidCsv: boolean;
  error: string | null;
  headers: string[];
  mapping: ImportMappingData;
  handleColumnMapping: (field: ImportFormat, value: string) => void;
  handleActivityTypeMapping: (csvActivity: string, activityType: ActivityType) => void;
  handleSymbolMapping: (csvSymbol: string, newSymbol: string) => void;
  importFormatFields: ImportFormat[];
  csvData: string[][];
  getMappedValue: (row: string[], field: ImportFormat) => string;
  validationErrors: Record<string, string[]>;
}) {
  if (!accountId) {
    return (
      <div className="mt-2">
        <p className="text-sm text-muted-foreground">Please select an account to proceed.</p>
      </div>
    );
  }

  if (!selectedFile) {
    return (
      <div className="mt-2">
        <p className="text-sm text-muted-foreground">Please select a file to proceed.</p>
      </div>
    );
  }

  if (!isValidCsv || error || Object.keys(validationErrors).length > 0) {
    return (
      <ErrorViewer
        parsingError={!!error}
        validationErrors={validationErrors}
        csvData={csvData}
        mapping={mapping}
      />
    );
  }

  return (
    <>
      <Separator className="my-4 opacity-50" />
      <ImportMappingTable
        importFormatFields={importFormatFields}
        mapping={mapping}
        headers={headers}
        csvData={csvData}
        handleColumnMapping={handleColumnMapping}
        handleActivityTypeMapping={handleActivityTypeMapping}
        handleSymbolMapping={handleSymbolMapping}
        getMappedValue={getMappedValue}
      />
    </>
  );
}
