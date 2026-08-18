"use client";

import { useState, useCallback } from "react";
import { useFetch } from "./useFetch";
import { fetchSignals } from "@/lib/api";
import type {
  Signal,
  SignalFilters,
  PaginationParams,
  PaginatedResponse,
} from "@/types/signal";

interface UseSignalsResult {
  signals: Signal[];
  total: number;
  totalPages: number;
  page: number;
  loading: boolean;
  error: string | null;
  filters: SignalFilters;
  pagination: PaginationParams;
  setFilters: (f: SignalFilters) => void;
  setPagination: (p: Partial<PaginationParams>) => void;
  refetch: () => void;
}

const DEFAULT_PAGINATION: PaginationParams = {
  page: 1,
  page_size: 20,
  sort_by: "created_at",
  sort_order: "desc",
};

export function useSignals(
  initialFilters: SignalFilters = {},
  initialPagination: PaginationParams = DEFAULT_PAGINATION
): UseSignalsResult {
  const [filters, setFilters] = useState<SignalFilters>(initialFilters);
  const [pagination, setPaginationState] =
    useState<PaginationParams>(initialPagination);

  const setPagination = useCallback((p: Partial<PaginationParams>) => {
    setPaginationState((prev) => ({ ...prev, ...p }));
  }, []);

  const { data, loading, error, refetch } = useFetch<PaginatedResponse<Signal>>(
    () => fetchSignals(filters, pagination),
    [JSON.stringify(filters), JSON.stringify(pagination)]
  );

  return {
    signals: data?.items ?? [],
    total: data?.total ?? 0,
    totalPages: data?.total_pages ?? 0,
    page: data?.page ?? 1,
    loading,
    error,
    filters,
    pagination,
    setFilters: (f: SignalFilters) => {
      setFilters(f);
      setPaginationState((prev) => ({ ...prev, page: 1 }));
    },
    setPagination,
    refetch,
  };
}
