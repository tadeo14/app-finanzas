import { useMemo } from 'react';
import type { ReportSources } from '../domain/reports';
import { CARD_PAYMENT_CATEGORY_ID } from '../db/seed';
import { useAccounts, useInstallments, useSettings, useTransactions } from './useData';

const EXCLUDED = new Set([CARD_PAYMENT_CATEGORY_ID]);

/** Fuentes para los reportes (movimientos de cuenta + cuotas) y cotización. `src` es undefined mientras carga. */
export function useReportSources(): { src: ReportSources | undefined; usdRate: number | undefined } {
  const accounts = useAccounts();
  const transactions = useTransactions();
  const installments = useInstallments();
  const settings = useSettings();

  const src = useMemo<ReportSources | undefined>(
    () =>
      accounts && transactions && installments
        ? { accounts, transactions, installments, excludedCategoryIds: EXCLUDED }
        : undefined,
    [accounts, transactions, installments],
  );
  return { src, usdRate: settings?.usdRate };
}
