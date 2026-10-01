import { ReviewError } from "@/lib/server/errors";

export type DataTableKind = "queue" | "batches" | "batchItems";
export type DataTableRow = Record<string, unknown> & {
  id?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type DataTableFilter = {
  type: "and";
  filters: Array<{
    columnName: string;
    condition: "eq" | "neq";
    value: string | number | boolean;
  }>;
};

const TABLE_CONFIG: Record<
  DataTableKind,
  { env: string; name: string }
> = {
  queue: {
    env: "N8N_REVIEW_QUEUE_TABLE_ID",
    name: "outreach_review_queue_v3",
  },
  batches: {
    env: "N8N_REVIEW_BATCHES_TABLE_ID",
    name: "outreach_batches_v3",
  },
  batchItems: {
    env: "N8N_REVIEW_BATCH_ITEMS_TABLE_ID",
    name: "outreach_batch_items_v3",
  },
};

const tableIdCache = new Map<DataTableKind, string>();

export async function listRows(
  table: DataTableKind,
  options: {
    filter?: DataTableFilter;
    limit?: number;
    sortBy?: string;
  } = {},
): Promise<DataTableRow[]> {
  const tableId = await resolveTableId(table);
  const params = new URLSearchParams({
    limit: String(options.limit ?? 250),
  });
  if (options.filter) params.set("filter", JSON.stringify(options.filter));
  if (options.sortBy) params.set("sortBy", options.sortBy);

  const response = await n8nFetch<{
    data?: DataTableRow[];
    nextCursor?: string | null;
  }>(`/data-tables/${encodeURIComponent(tableId)}/rows?${params}`);

  return Array.isArray(response.data) ? response.data : [];
}

export async function findRow(
  table: DataTableKind,
  filter: DataTableFilter,
): Promise<DataTableRow | null> {
  const rows = await listRows(table, { filter, limit: 2 });
  if (rows.length > 1) {
    throw new ReviewError(
      `The ${table} table contains duplicate canonical records.`,
      409,
      "DUPLICATE_CANONICAL_RECORD",
    );
  }
  return rows[0] ?? null;
}

export async function insertRows(
  table: DataTableKind,
  data: DataTableRow[],
): Promise<DataTableRow[]> {
  const tableId = await resolveTableId(table);
  const response = await n8nFetch<unknown>(
    `/data-tables/${encodeURIComponent(tableId)}/rows`,
    {
      method: "POST",
      body: JSON.stringify({ data, returnType: "all" }),
    },
  );
  return Array.isArray(response) ? (response as DataTableRow[]) : [];
}

export async function updateRows(
  table: DataTableKind,
  filter: DataTableFilter,
  data: DataTableRow,
): Promise<DataTableRow[]> {
  const tableId = await resolveTableId(table);
  const response = await n8nFetch<unknown>(
    `/data-tables/${encodeURIComponent(tableId)}/rows/update`,
    {
      method: "PATCH",
      body: JSON.stringify({
        filter,
        data,
        returnData: true,
        dryRun: false,
      }),
    },
  );
  return Array.isArray(response) ? (response as DataTableRow[]) : [];
}

export async function upsertRow(
  table: DataTableKind,
  filter: DataTableFilter,
  data: DataTableRow,
): Promise<DataTableRow> {
  const tableId = await resolveTableId(table);
  const response = await n8nFetch<DataTableRow | boolean>(
    `/data-tables/${encodeURIComponent(tableId)}/rows/upsert`,
    {
      method: "POST",
      body: JSON.stringify({
        filter,
        data,
        returnData: true,
        dryRun: false,
      }),
    },
  );
  if (!response || response === true) {
    throw new ReviewError(
      `n8n did not return the upserted ${table} row.`,
      502,
      "N8N_UPSERT_INVALID_RESPONSE",
    );
  }
  return response;
}

export function andFilter(
  ...filters: DataTableFilter["filters"]
): DataTableFilter {
  return { type: "and", filters };
}

export function eq(
  columnName: string,
  value: string | number | boolean,
): DataTableFilter["filters"][number] {
  return { columnName, condition: "eq", value };
}

async function resolveTableId(table: DataTableKind): Promise<string> {
  const cached = tableIdCache.get(table);
  if (cached) return cached;

  const config = TABLE_CONFIG[table];
  const explicit = process.env[config.env]?.trim();
  if (explicit) {
    tableIdCache.set(table, explicit);
    return explicit;
  }

  const params = new URLSearchParams({
    limit: "100",
    filter: JSON.stringify({ name: config.name }),
  });
  const response = await n8nFetch<{
    data?: Array<{ id?: string; name?: string }>;
  }>(`/data-tables?${params}`);
  const matches = (response.data ?? []).filter((item) => item.name === config.name);

  if (matches.length !== 1 || !matches[0]?.id) {
    throw new ReviewError(
      `Expected exactly one n8n data table named ${config.name}.`,
      503,
      "N8N_REVIEW_TABLE_NOT_READY",
    );
  }

  tableIdCache.set(table, matches[0].id);
  return matches[0].id;
}

async function n8nFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = String(process.env.N8N_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const apiKey = String(process.env.N8N_REVIEW_API_KEY ?? "").trim();

  if (!baseUrl || !apiKey) {
    throw new ReviewError(
      "The n8n review connection is not configured.",
      503,
      "N8N_REVIEW_NOT_CONFIGURED",
    );
  }

  let endpoint: URL;
  try {
    endpoint = new URL(`${baseUrl}${path}`);
  } catch {
    throw new ReviewError(
      "N8N_BASE_URL is invalid.",
      503,
      "N8N_BASE_URL_INVALID",
    );
  }

  const controller = new AbortController();
  const timeoutMs = Number(process.env.N8N_REQUEST_TIMEOUT_MS ?? 10_000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      ...init,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-N8N-API-KEY": apiKey,
        ...init.headers,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const requestId =
        response.headers.get("x-request-id") ??
        response.headers.get("cf-ray") ??
        "unavailable";
      console.error("n8n review request failed", {
        status: response.status,
        path: endpoint.pathname,
        requestId,
      });
      throw new ReviewError(
        "n8n rejected the review request.",
        response.status === 401 || response.status === 403 ? 503 : 502,
        "N8N_REVIEW_REQUEST_FAILED",
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ReviewError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ReviewError(
        "n8n did not respond before the review timeout.",
        504,
        "N8N_REVIEW_TIMEOUT",
      );
    }
    throw new ReviewError(
      "The review console could not reach n8n.",
      502,
      "N8N_REVIEW_UNREACHABLE",
    );
  } finally {
    clearTimeout(timeout);
  }
}
