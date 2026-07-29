"use client";

import { useFetch } from "./useFetch";
import { fetchSignalById, updateSignalStatus } from "@/lib/api";
import type { Signal, ReviewStatus } from "@/types/signal";
import { useState } from "react";

interface UseSignalDetailResult {
  signal: Signal | null;
  loading: boolean;
  error: string | null;
  updating: boolean;
  updateStatus: (status: ReviewStatus, notes?: string) => Promise<void>;
  refetch: () => void;
}

export function useSignalDetail(id: string): UseSignalDetailResult {
  const [updating, setUpdating] = useState(false);
  const { data, loading, error, refetch } = useFetch<Signal>(
    () => fetchSignalById(id),
    [id]
  );

  const updateStatus = async (status: ReviewStatus, notes?: string) => {
    setUpdating(true);
    try {
      await updateSignalStatus(id, status, notes);
      refetch();
    } finally {
      setUpdating(false);
    }
  };

  return { signal: data, loading, error, updating, updateStatus, refetch };
}
