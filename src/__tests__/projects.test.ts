import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockClient } from './mock-client.js';
import { getProjectTools } from '../tools/projects.js';

describe('Project Tools (v2)', () => {
  let client: ReturnType<typeof createMockClient>;
  let tools: ReturnType<typeof getProjectTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createMockClient();
    tools = getProjectTools(client);
  });

  describe('projects', () => {
    it('list_projects forwards status and cursor params and normalizes', async () => {
      vi.mocked(client.get).mockResolvedValueOnce({
        items: [{ id: 'p1' }],
        has_more: true,
        cursor: 'page:2',
      });
      const result = await tools.list_projects.handler({ status: 'active', limit: 20 });
      expect(client.get).toHaveBeenCalledWith('/projects', { limit: 20, status: 'active' });
      expect(result).toEqual({ items: [{ id: 'p1' }], hasMore: true, nextCursor: 'page:2' });
    });

    it('list_projects rejects unknown status values', async () => {
      await expect(tools.list_projects.handler({ status: 'open' })).rejects.toThrow(
        /Validation error/
      );
    });

    it('get_project and get_project_summary hit their routes', async () => {
      await tools.get_project.handler({ projectId: 'p1' });
      await tools.get_project_summary.handler({ projectId: 'p1' });
      expect(client.get).toHaveBeenCalledWith('/projects/p1', undefined);
      expect(client.get).toHaveBeenCalledWith('/projects/p1/summary', undefined);
    });

    it('create_project maps camelCase args to the v2 body', async () => {
      await tools.create_project.handler({
        name: 'Web nova',
        dueDate: '2026-12-31',
        contactId: 'c1',
      });
      expect(client.post).toHaveBeenCalledWith('/projects', {
        name: 'Web nova',
        due_date: '2026-12-31',
        contact_id: 'c1',
      });
    });

    it('create_project requires a name', async () => {
      await expect(tools.create_project.handler({})).rejects.toThrow(/name/);
      expect(client.post).not.toHaveBeenCalled();
    });

    it('update_project sends only provided fields, keeping explicit nulls', async () => {
      await tools.update_project.handler({
        projectId: 'p1',
        status: 2,
        billable: true,
        dueDate: null,
        allowNotifications: false,
      });
      expect(client.put).toHaveBeenCalledWith('/projects/p1', {
        status: 2,
        billable: true,
        due_date: null,
        allow_notifications: false,
      });
    });

    it('delete_project deletes by id', async () => {
      await tools.delete_project.handler({ projectId: 'p1' });
      expect(client.delete).toHaveBeenCalledWith('/projects/p1');
    });
  });

  describe('tasks', () => {
    it('list_tasks filters by project client-side', async () => {
      vi.mocked(client.get).mockResolvedValueOnce({
        items: [
          { id: 't1', project_id: 'p1' },
          { id: 't2', project_id: 'p2' },
        ],
        has_more: false,
      });
      const result = await tools.list_tasks.handler({ projectId: 'p1' });
      expect(client.get).toHaveBeenCalledWith('/tasks', {});
      expect(result.items).toEqual([{ id: 't1', project_id: 'p1' }]);
    });

    it('get_task fetches one task', async () => {
      await tools.get_task.handler({ taskId: 't1' });
      expect(client.get).toHaveBeenCalledWith('/tasks/t1', undefined);
    });

    it('create_task maps fields to snake_case', async () => {
      await tools.create_task.handler({
        projectId: 'p1',
        name: 'Maquetar',
        assignedTo: ['u1'],
        priority: 2,
      });
      expect(client.post).toHaveBeenCalledWith('/tasks', {
        project_id: 'p1',
        name: 'Maquetar',
        priority: 2,
        assigned_to: ['u1'],
      });
    });

    it('update_task and delete_task address the task directly', async () => {
      await tools.update_task.handler({ taskId: 't1', status: 'done' });
      expect(client.put).toHaveBeenCalledWith('/tasks/t1', { status: 'done' });

      await tools.delete_task.handler({ taskId: 't1' });
      expect(client.delete).toHaveBeenCalledWith('/tasks/t1');
    });
  });
});
