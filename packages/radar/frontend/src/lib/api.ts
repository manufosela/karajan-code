import type {
  Signal,
  SignalDetail,
  SignalFilters,
  SignalReviewResponse,
  ResearchItemStats,
  PaginationParams,
  PaginatedResponse,
  BackendPaginatedResponse,
} from "@/types/signal";
import type { Source, SourceUpdatePayload } from "@/types/source";
import type {
  Configuration,
  ConfigCategory,
  ConfigValue,
} from "@/types/configuration";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: unknown
  ) {
    super(`API Error ${status}: ${statusText}`);
    this.name = "ApiError";
  }
}

function getAuthHeaders(): HeadersInit {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("ofr-token");
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  const defaultHeaders: HeadersInit = {
    "Content-Type": "application/json",
    ...getAuthHeaders(),
  };

  const response = await fetch(url, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  });

  if (response.status === 401) {
    if (typeof window !== "undefined") {
      localStorage.removeItem("ofr-token");
      window.location.href = "/login";
    }
    throw new ApiError(response.status, response.statusText, "Unauthorized");
  }

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = await response.text();
    }
    throw new ApiError(response.status, response.statusText, body);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function buildQueryString(
  params: Record<string, unknown>
): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        searchParams.append(key, String(item));
      }
    } else {
      searchParams.append(key, String(value));
    }
  }

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : "";
}

/* ─── Signals ─────────────────────────────────────────────── */

/* Map frontend sort fields to backend SortByEnum values */
const SORT_BY_MAP: Record<string, string> = {
  publication_date: "date",
  scientific_strength_score: "relevance",
  strategic_relevance_score: "score",
  original_title: "created_at",
  journal_or_origin: "created_at",
  review_status: "created_at",
  strategic_buckets: "created_at",
  created_at: "created_at",
  date: "date",
  score: "score",
  relevance: "relevance",
};

export async function fetchSignals(
  filters: SignalFilters = {},
  pagination: PaginationParams = { page: 1, page_size: 20 }
): Promise<PaginatedResponse<Signal>> {
  const offset = (pagination.page - 1) * pagination.page_size;
  const backendParams: Record<string, unknown> = {
    ...filters,
    offset,
    limit: pagination.page_size,
    sort_order: pagination.sort_order || "desc",
  };
  if (pagination.sort_by) {
    backendParams.sort_by = SORT_BY_MAP[pagination.sort_by] || "created_at";
  }
  const qs = buildQueryString(backendParams);
  const raw = await request<BackendPaginatedResponse<Signal>>(`/signals${qs}`);
  return {
    items: raw.items,
    total: raw.total,
    page: pagination.page,
    page_size: pagination.page_size,
    total_pages: Math.max(1, Math.ceil(raw.total / pagination.page_size)),
  };
}

export async function fetchSignalById(id: string): Promise<SignalDetail> {
  return request<SignalDetail>(`/signals/${encodeURIComponent(id)}`);
}

export async function updateSignalStatus(
  id: string,
  status: string,
  notes?: string
): Promise<SignalReviewResponse> {
  return request<SignalReviewResponse>(
    `/signals/${encodeURIComponent(id)}/review`,
    {
      method: "PATCH",
      body: JSON.stringify({ review_status: status, reviewer_notes: notes }),
    }
  );
}

export async function fetchSignalStats(): Promise<ResearchItemStats> {
  return request<ResearchItemStats>("/signals/stats");
}

/* ─── Sources ─────────────────────────────────────────────── */

export async function fetchSources(): Promise<Source[]> {
  return request<Source[]>("/sources");
}

export async function fetchSourceById(id: string): Promise<Source> {
  return request<Source>(`/sources/${encodeURIComponent(id)}`);
}

export async function updateSource(
  id: string,
  data: SourceUpdatePayload
): Promise<Source> {
  return request<Source>(
    `/sources/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    }
  );
}

export async function triggerSourceFetch(id: string): Promise<{ message: string }> {
  return request<{ message: string }>(
    `/sources/${encodeURIComponent(id)}/fetch`,
    {
      method: "POST",
    }
  );
}

/* ─── Configuration ───────────────────────────────────────── */

export async function fetchConfiguration(
  category?: ConfigCategory
): Promise<Configuration[]> {
  const qs = category ? buildQueryString({ category }) : "";
  return request<Configuration[]>(`/configuration${qs}`);
}

export async function fetchConfigurationByKey(
  category: ConfigCategory,
  key: string
): Promise<Configuration> {
  return request<Configuration>(
    `/configuration/${encodeURIComponent(category)}/${encodeURIComponent(key)}`
  );
}

export async function updateConfiguration(
  category: ConfigCategory,
  key: string,
  value: ConfigValue
): Promise<Configuration> {
  return request<Configuration>(
    `/configuration/${encodeURIComponent(category)}/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      body: JSON.stringify({ value }),
    }
  );
}

/* ─── Schedule ────────────────────────────────────────────── */

import type { ScheduleResponse, ScheduleUpdatePayload, RunNowResponse } from "@/types/schedule";

export async function fetchSchedule(): Promise<ScheduleResponse> {
  return request<ScheduleResponse>("/configuration/schedule");
}

export async function updateSchedule(
  data: ScheduleUpdatePayload
): Promise<ScheduleResponse> {
  return request<ScheduleResponse>("/configuration/schedule", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function triggerIngestionNow(): Promise<RunNowResponse> {
  return request<RunNowResponse>("/configuration/schedule/run-now", {
    method: "POST",
  });
}

/* ─── Health ──────────────────────────────────────────────── */

export interface HealthStatus {
  status: string;
  version: string;
  uptime_seconds: number;
}

export async function fetchHealthStatus(): Promise<HealthStatus> {
  return request<HealthStatus>("/health");
}

/* ─── Auth / Users ───────────────────────────────────────────── */

import type {
  User,
  LoginResponse,
  UserCreatePayload,
  UserUpdatePayload,
  ActiveUser,
} from "@/types/auth";

export async function loginUser(
  email: string,
  password: string
): Promise<LoginResponse> {
  return request<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function fetchCurrentUser(): Promise<User> {
  return request<User>("/auth/me");
}

export async function fetchUsers(): Promise<User[]> {
  return request<User[]>("/auth/users");
}

export async function createUser(data: UserCreatePayload): Promise<User> {
  return request<User>("/auth/users", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateUser(
  id: string,
  data: UserUpdatePayload
): Promise<User> {
  return request<User>(`/auth/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deactivateUser(id: string): Promise<User> {
  return request<User>(`/auth/users/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function fetchActiveUsers(): Promise<ActiveUser[]> {
  return request<ActiveUser[]>("/auth/active-users");
}

/* ─── Analytics ───────────────────────────────────────────── */

import type {
  AnalyticsTrendsResponse,
  AnalyticsScoresResponse,
  AnalyticsIngestionResponse,
  CostEstimateResponse,
} from "@/types/analytics";

export async function fetchAnalyticsTrends(
  period: string = "30d"
): Promise<AnalyticsTrendsResponse> {
  const qs = buildQueryString({ period });
  return request<AnalyticsTrendsResponse>(`/analytics/trends${qs}`);
}

export async function fetchAnalyticsScores(): Promise<AnalyticsScoresResponse> {
  return request<AnalyticsScoresResponse>("/analytics/scores");
}

export async function fetchAnalyticsIngestion(): Promise<AnalyticsIngestionResponse> {
  return request<AnalyticsIngestionResponse>("/analytics/ingestion");
}

export async function fetchCostEstimate(): Promise<CostEstimateResponse> {
  return request<CostEstimateResponse>("/analytics/costs");
}

export { ApiError };
