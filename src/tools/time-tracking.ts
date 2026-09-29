import { HoldedClient } from '../holded-client.js';
import { normalizeV2List, cursorParams } from '../utils/v2-pagination.js';
import { compactBody } from '../utils/body.js';
import {
  createProjectTimeSchema,
  listProjectTimesSchema,
  projectTimesSchema,
  projectTimeIdSchema,
  updateProjectTimeSchema,
  withValidation,
} from '../validation.js';

/**
 * Time-tracking tools backed by the Holded **Projects API v2**
 * (`https://api.holded.com/api/v2`): list, read, create, update and delete
 * the hours logged against Holded projects.
 *
 * v2 returns a **flat cursor-paginated list** of time entries at
 * `GET /project-times`. The global endpoint does not accept date filters, so
 * date-range and approved-only filters are applied client-side on the returned
 * cursor page. `GET /projects/{id}/times` accepts `startDate`/`endDate`
 * server-side, so they are forwarded there as well.
 */

/** A single time-tracking entry as returned by the Holded Projects API. */
interface HoldedTimeEntry extends Record<string, unknown> {
  /** Duration of the entry in seconds. */
  duration?: number;
  /** Day of the entry: ISO `YYYY-MM-DD` (v2) or Unix seconds at local midnight (legacy). */
  date?: number | string | null;
  /** Approval flag: boolean (v2) or 0/1 (legacy). */
  approved?: boolean | number;
}

/** Writable project-time fields as accepted by the MCP tools (camelCase). */
interface ProjectTimeInput {
  duration?: number;
  hours?: number;
  userId?: string;
  description?: string | null;
  date?: string | null;
  taskId?: string | null;
  costPerHour?: string | null;
  category?: string | null;
}

/** Map MCP camelCase arguments to the snake_case body expected by Holded v2. */
function projectTimeBody(input: ProjectTimeInput): Record<string, unknown> {
  const duration =
    input.duration ?? (input.hours !== undefined ? Math.round(input.hours * 3600) : undefined);
  return compactBody({
    duration,
    user_id: input.userId,
    description: input.description,
    date: input.date,
    task_id: input.taskId,
    cost_per_hour: input.costPerHour,
    category: input.category,
  });
}

/** Resolve an entry's calendar day as `YYYY-MM-DD`, whatever format Holded returned. */
function entryDay(date: HoldedTimeEntry['date']): string | undefined {
  if (typeof date === 'number') {
    return unixToLocalISODate(date);
  }
  if (typeof date === 'string' && date.length >= 10) {
    return date.slice(0, 10);
  }
  return undefined;
}

/**
 * Format a Unix timestamp (seconds) as a `YYYY-MM-DD` calendar date using the
 * host's local timezone.
 *
 * Holded stores each entry's `date` as **local midnight** expressed in Unix
 * seconds. Because the MCP runs on the user's machine (same timezone the hours
 * were logged in), local extraction reproduces the intended calendar day —
 * whereas UTC extraction can be off by one near the date boundary.
 *
 * @param unixSeconds - Unix timestamp in seconds.
 * @returns The calendar date as `YYYY-MM-DD`.
 */
export function unixToLocalISODate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Decide whether a single time entry passes the optional client-side filters.
 *
 * @param entry - The time entry to test.
 * @param filters - Optional `startDate`/`endDate` (inclusive, `YYYY-MM-DD`) and
 *   `approvedOnly` flag.
 * @returns `true` when the entry should be kept.
 */
function entryMatches(
  entry: HoldedTimeEntry,
  filters: { startDate?: string; endDate?: string; approvedOnly?: boolean }
): boolean {
  if (filters.approvedOnly && entry.approved !== 1 && entry.approved !== true) {
    return false;
  }
  const entryDate = entryDay(entry.date);
  if ((filters.startDate || filters.endDate) && entryDate) {
    if (filters.startDate && entryDate < filters.startDate) {
      return false;
    }
    if (filters.endDate && entryDate > filters.endDate) {
      return false;
    }
  }
  return true;
}

const PROJECT_TIME_INPUT_PROPERTIES = {
  duration: { type: 'integer', description: 'Duration in seconds (e.g. 5400 = 1h30)' },
  hours: {
    type: 'number',
    description: 'Duration in decimal hours (e.g. 1.5). Alternative to `duration`',
  },
  userId: { type: 'string', description: 'Holded user ID whose time is being logged' },
  description: { type: 'string', description: 'Description of the work done' },
  date: { type: 'string', description: 'Day of the entry (YYYY-MM-DD)' },
  taskId: { type: 'string', description: 'Optional task ID within the project' },
  costPerHour: { type: 'string', description: 'Cost per hour as a decimal string, e.g. "35.00"' },
  category: { type: 'string', description: 'Optional category of the entry' },
};

export function getTimeTrackingTools(client: HoldedClient) {
  return {
    // List time tracking across all projects (v2 flat cursor-paginated list)
    list_project_times: {
      description:
        'List time-tracking entries across all Holded projects (Projects API v2). Returns a cursor-paginated flat list of entries; pass the previous `nextCursor` as `cursor` to fetch the next page. Each entry contains id, duration (seconds), date (YYYY-MM-DD), approved, user_id, user_name, task_id, description and cost fields. ' +
        'The approvedOnly, startDate, and endDate filters are applied client-side on the current page — use pagination to iterate over the full dataset. Read-only.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          limit: {
            type: 'number',
            description: 'Max items per cursor page (default: 50)',
          },
          cursor: {
            type: 'string',
            description: 'Cursor token from a previous response nextCursor to fetch the next page',
          },
          startDate: {
            type: 'string',
            description:
              'Keep only entries on or after this date (YYYY-MM-DD, inclusive) — applied client-side on the returned page',
          },
          endDate: {
            type: 'string',
            description:
              'Keep only entries on or before this date (YYYY-MM-DD, inclusive) — applied client-side on the returned page',
          },
          approvedOnly: {
            type: 'boolean',
            description:
              'Keep only approved entries (approved) — applied client-side on the returned page. Default: false',
          },
        },
        required: [],
      },
      readOnlyHint: true,
      handler: withValidation(listProjectTimesSchema, async (args) => {
        const { startDate, endDate, approvedOnly, limit, cursor } = args;
        const params = cursorParams({ limit, cursor });
        const raw = await client.get('/project-times', params);
        const normalized = normalizeV2List(raw);
        if (startDate || endDate || approvedOnly) {
          const filteredItems = normalized.items.filter((item) =>
            entryMatches(item as HoldedTimeEntry, { startDate, endDate, approvedOnly })
          );
          return { ...normalized, items: filteredItems };
        }
        return normalized;
      }),
    },

    // List time tracking for a single project (v2)
    list_project_times_by_project: {
      description:
        'List time-tracking entries for a single Holded project (Projects API v2). Returns a cursor-paginated flat list of entries for the given projectId. Pass the previous `nextCursor` as `cursor` to fetch the next page. ' +
        'startDate/endDate are sent to Holded as server-side filters; approvedOnly is applied client-side on the current page. Read-only.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          projectId: {
            type: 'string',
            description: 'The Holded project ID',
          },
          limit: {
            type: 'number',
            description: 'Max items per cursor page (default: 50)',
          },
          cursor: {
            type: 'string',
            description: 'Cursor token from a previous response nextCursor to fetch the next page',
          },
          startDate: {
            type: 'string',
            description:
              'Keep only entries on or after this date (YYYY-MM-DD, inclusive) — server-side filter',
          },
          endDate: {
            type: 'string',
            description:
              'Keep only entries on or before this date (YYYY-MM-DD, inclusive) — server-side filter',
          },
          approvedOnly: {
            type: 'boolean',
            description:
              'Keep only approved entries — applied client-side on the returned page. Default: false',
          },
        },
        required: ['projectId'],
      },
      readOnlyHint: true,
      handler: withValidation(projectTimesSchema, async (args) => {
        const { projectId, startDate, endDate, approvedOnly, limit, cursor } = args;
        const params = cursorParams({ limit, cursor });
        if (startDate) {
          params.startDate = startDate;
        }
        if (endDate) {
          params.endDate = endDate;
        }
        const raw = await client.get(`/projects/${projectId}/times`, params);
        const normalized = normalizeV2List(raw);
        if (startDate || endDate || approvedOnly) {
          const filteredItems = normalized.items.filter((item) =>
            entryMatches(item as HoldedTimeEntry, { startDate, endDate, approvedOnly })
          );
          return { ...normalized, items: filteredItems };
        }
        return normalized;
      }),
    },

    // Get a single time-tracking entry (v2)
    get_project_time: {
      description:
        'Get a single time-tracking entry by project ID and time-tracking ID (Projects API v2). Read-only.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          projectId: {
            type: 'string',
            description: 'The Holded project ID',
          },
          timeTrackingId: {
            type: 'string',
            description: 'The time-tracking entry ID (timeId)',
          },
        },
        required: ['projectId', 'timeTrackingId'],
      },
      readOnlyHint: true,
      handler: withValidation(projectTimeIdSchema, async (args) => {
        return client.get(`/projects/${args.projectId}/times/${args.timeTrackingId}`, undefined);
      }),
    },

    create_project_time: {
      description:
        'WRITE: logs a real time entry (parte de horas / imputación) against a Holded project (Projects API v2). ' +
        'Provide the duration either as `duration` (seconds) or `hours` (decimal, e.g. 1.5). ' +
        '`userId` is the Holded user whose time is logged — required by the API for direct calls. Returns { id }.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...PROJECT_TIME_INPUT_PROPERTIES,
          projectId: { type: 'string', description: 'The Holded project ID' },
        },
        required: ['projectId'],
      },
      handler: withValidation(createProjectTimeSchema, async (args) => {
        const { projectId, ...fields } = args;
        return client.post(`/projects/${projectId}/times`, projectTimeBody(fields));
      }),
    },

    update_project_time: {
      description:
        'WRITE: updates an existing project time entry in Holded (Projects API v2). ' +
        'Only the fields provided are sent. Duration can be given as `duration` (seconds) or `hours`.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...PROJECT_TIME_INPUT_PROPERTIES,
          projectId: { type: 'string', description: 'The Holded project ID' },
          timeTrackingId: { type: 'string', description: 'The time entry ID (timeId)' },
        },
        required: ['projectId', 'timeTrackingId'],
      },
      handler: withValidation(updateProjectTimeSchema, async (args) => {
        const { projectId, timeTrackingId, ...fields } = args;
        return client.put(
          `/projects/${projectId}/times/${timeTrackingId}`,
          projectTimeBody(fields)
        );
      }),
    },

    delete_project_time: {
      description:
        'DESTRUCTIVE: permanently deletes a project time entry in Holded (Projects API v2). This cannot be undone.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          projectId: { type: 'string', description: 'The Holded project ID' },
          timeTrackingId: { type: 'string', description: 'The time entry ID (timeId)' },
        },
        required: ['projectId', 'timeTrackingId'],
      },
      handler: withValidation(projectTimeIdSchema, async (args) =>
        client.delete(`/projects/${args.projectId}/times/${args.timeTrackingId}`)
      ),
    },
  };
}
