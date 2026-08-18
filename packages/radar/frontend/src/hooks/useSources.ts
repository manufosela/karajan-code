"use client";

import { useState } from "react";
import { useFetch } from "./useFetch";
import { fetchSources, updateSource } from "@/lib/api";
import type { Source, SourceUpdatePayload } from "@/types/source";

interface UseSourcesResult {
  sources: Source[];
  loading: boolean;
  error: string | null;
  updating: boolean;
  update: (id: string, data: SourceUpdatePayload) => Promise<void>;
  refetch: () => void;
}

export function useSources(): UseSourcesResult {
  const [updating, setUpdating] = useState(false);
  const { data, loading, error, refetch } = useFetch<Source[]>(
    () => fetchSources(),
    []
  );

  const update = async (id: string, payload: SourceUpdatePayload) => {
    setUpdating(true);
    try {
      await updateSource(id, payload);
      refetch();
    } finally {
      setUpdating(false);
    }
  };

  return {
    sources: data ?? [],
    loading,
    error,
    updating,
    update,
    refetch,
  };
}
