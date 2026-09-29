import { HoldedClient } from '../holded-client.js';
import { normalizeV2List, cursorParams } from '../utils/v2-pagination.js';
import { compactBody } from '../utils/body.js';
import {
  createProjectSchema,
  createTaskSchema,
  listProjectsSchema,
  listTasksSchema,
  projectIdSchema,
  taskIdSchema,
  updateProjectSchema,
  updateTaskSchema,
  withValidation,
} from '../validation.js';

/**
 * Projects and tasks tools backed by the Holded **Projects API v2**
 * (`https://api.holded.com/api/v2`, scopes `projects:projects.read|write`).
 *
 * Tool arguments are camelCase and mapped to the snake_case bodies documented
 * in the Holded OpenAPI spec (`https://api.holded.com/openapi/es.json`).
 */

const TASK_INPUT_PROPERTIES = {
  description: { type: 'string', description: 'Task description' },
  dueDate: { type: 'string', description: 'Due date (YYYY-MM-DD)' },
  priority: { type: 'integer', description: 'Task priority' },
  status: { type: 'string', description: 'Task status' },
  assignedTo: {
    type: 'array',
    items: { type: 'string' },
    description: 'IDs of the Holded users assigned to the task',
  },
};

interface TaskInput {
  projectId?: string;
  name?: string;
  description?: string | null;
  dueDate?: string | null;
  priority?: number | null;
  status?: string | null;
  assignedTo?: string[] | null;
}

function taskBody(input: TaskInput): Record<string, unknown> {
  return compactBody({
    project_id: input.projectId,
    name: input.name,
    description: input.description,
    due_date: input.dueDate,
    priority: input.priority,
    status: input.status,
    assigned_to: input.assignedTo,
  });
}

export function getProjectTools(client: HoldedClient) {
  return {
    list_projects: {
      description:
        'List Holded projects (Projects API v2). Cursor-paginated: pass the previous `nextCursor` as `cursor` to fetch the next page. ' +
        'Each project has id, name, description, contact_id/contact_name, start_date, due_date, status, tags, billable, number_of_tasks and completed_tasks. ' +
        'Use `status` = "active" or "in_progress" to get only ongoing projects.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          status: {
            type: 'string',
            enum: ['active', 'in_progress', 'completed', 'cancelled', 'waiting', 'budgeted'],
            description: 'Filter projects by status',
          },
          limit: { type: 'integer', description: 'Max items per page (default 50, max 200)' },
          cursor: { type: 'string', description: 'Cursor from a previous response nextCursor' },
        },
        required: [],
      },
      readOnlyHint: true,
      handler: withValidation(listProjectsSchema, async (args) => {
        const params = cursorParams(args);
        if (args.status) {
          params.status = args.status;
        }
        return normalizeV2List(await client.get('/projects', params));
      }),
    },

    get_project: {
      description: 'Get a single Holded project by ID (Projects API v2).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          projectId: { type: 'string', description: 'Project ID (24-char hex ObjectId)' },
        },
        required: ['projectId'],
      },
      readOnlyHint: true,
      handler: withValidation(projectIdSchema, async (args) =>
        client.get(`/projects/${args.projectId}`, undefined)
      ),
    },

    get_project_summary: {
      description:
        'Get the aggregated time and cost summary of a Holded project (Projects API v2).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          projectId: { type: 'string', description: 'Project ID (24-char hex ObjectId)' },
        },
        required: ['projectId'],
      },
      readOnlyHint: true,
      handler: withValidation(projectIdSchema, async (args) =>
        client.get(`/projects/${args.projectId}/summary`, undefined)
      ),
    },

    create_project: {
      description: 'WRITE: creates a real project in Holded (Projects API v2). Returns { id }.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Project name' },
          description: { type: 'string', description: 'Project description' },
          dueDate: { type: 'string', description: 'Due date (YYYY-MM-DD)' },
          contactId: { type: 'string', description: 'ID of the associated client contact' },
        },
        required: ['name'],
      },
      handler: withValidation(createProjectSchema, async (args) =>
        client.post(
          '/projects',
          compactBody({
            name: args.name,
            description: args.description,
            due_date: args.dueDate,
            contact_id: args.contactId,
          })
        )
      ),
    },

    update_project: {
      description:
        'WRITE: updates an existing Holded project (Projects API v2). Only the fields provided are sent.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          projectId: { type: 'string', description: 'Project ID' },
          name: { type: 'string', description: 'Project name' },
          description: { type: 'string', description: 'Project description' },
          startDate: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
          dueDate: { type: 'string', description: 'Due date (YYYY-MM-DD)' },
          contactId: { type: 'string', description: 'ID of the associated client contact' },
          status: { type: 'integer', description: 'Project status code (0-4)' },
          billable: { type: 'boolean', description: 'Whether the project is billable' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Project tags' },
          allowNotifications: {
            type: 'boolean',
            description: 'Whether project notifications are allowed',
          },
        },
        required: ['projectId'],
      },
      handler: withValidation(updateProjectSchema, async (args) =>
        client.put(
          `/projects/${args.projectId}`,
          compactBody({
            name: args.name,
            description: args.description,
            start_date: args.startDate,
            due_date: args.dueDate,
            contact_id: args.contactId,
            status: args.status,
            billable: args.billable,
            tags: args.tags,
            allow_notifications: args.allowNotifications,
          })
        )
      ),
    },

    delete_project: {
      description:
        'DESTRUCTIVE: permanently deletes a Holded project AND all its time entries (Projects API v2). This cannot be undone.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          projectId: { type: 'string', description: 'Project ID' },
        },
        required: ['projectId'],
      },
      handler: withValidation(projectIdSchema, async (args) =>
        client.delete(`/projects/${args.projectId}`)
      ),
    },

    list_tasks: {
      description:
        'List Holded project tasks (Projects API v2). Cursor-paginated. ' +
        'The API has no project filter: `projectId` is applied client-side on the returned page, so keep paginating while `hasMore` is true.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          projectId: {
            type: 'string',
            description: 'Keep only tasks of this project — applied client-side on the page',
          },
          limit: { type: 'integer', description: 'Max items per page (default 50, max 200)' },
          cursor: { type: 'string', description: 'Cursor from a previous response nextCursor' },
        },
        required: [],
      },
      readOnlyHint: true,
      handler: withValidation(listTasksSchema, async (args) => {
        const normalized = normalizeV2List(await client.get('/tasks', cursorParams(args)));
        if (!args.projectId) {
          return normalized;
        }
        return {
          ...normalized,
          items: normalized.items.filter(
            (task) => (task as { project_id?: string }).project_id === args.projectId
          ),
        };
      }),
    },

    get_task: {
      description: 'Get a single Holded task by ID (Projects API v2).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          taskId: { type: 'string', description: 'Task ID (24-char hex ObjectId)' },
        },
        required: ['taskId'],
      },
      readOnlyHint: true,
      handler: withValidation(taskIdSchema, async (args) =>
        client.get(`/tasks/${args.taskId}`, undefined)
      ),
    },

    create_task: {
      description:
        'WRITE: creates a real task inside a Holded project (Projects API v2). Returns { id }.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...TASK_INPUT_PROPERTIES,
          projectId: { type: 'string', description: 'Project the task belongs to' },
          name: { type: 'string', description: 'Task name' },
        },
        required: ['projectId', 'name'],
      },
      handler: withValidation(createTaskSchema, async (args) =>
        client.post('/tasks', taskBody(args))
      ),
    },

    update_task: {
      description:
        'WRITE: updates an existing Holded task (Projects API v2). Only the fields provided are sent.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          ...TASK_INPUT_PROPERTIES,
          taskId: { type: 'string', description: 'Task ID' },
          projectId: { type: 'string', description: 'Move the task to this project' },
          name: { type: 'string', description: 'Task name' },
        },
        required: ['taskId'],
      },
      handler: withValidation(updateTaskSchema, async (args) => {
        const { taskId, ...fields } = args;
        return client.put(`/tasks/${taskId}`, taskBody(fields));
      }),
    },

    delete_task: {
      description:
        'DESTRUCTIVE: permanently deletes a Holded task (Projects API v2). This cannot be undone.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          taskId: { type: 'string', description: 'Task ID' },
        },
        required: ['taskId'],
      },
      handler: withValidation(taskIdSchema, async (args) => client.delete(`/tasks/${args.taskId}`)),
    },
  };
}
