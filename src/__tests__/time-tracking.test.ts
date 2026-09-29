import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockClient } from './mock-client.js';
import { getTimeTrackingTools, unixToLocalISODate } from '../tools/time-tracking.js';

// Unix timestamp for local midnight on the given calendar day in the test host's timezone.
function localMidnightUnix(year: number, month: number, day: number): number {
  return Math.floor(new Date(year, month - 1, day).getTime() / 1000);
}

describe('Time Tracking Tools (v2)', () => {
  let client: ReturnType<typeof createMockClient>;
  let tools: ReturnType<typeof getTimeTrackingTools>;

  const day1 = localMidnightUnix(2026, 6, 1);
  const day2 = localMidnightUnix(2026, 6, 2);
  const day3 = localMidnightUnix(2026, 6, 3);

  /** Flat v2 time entries (no nested project structure). */
  const flatItems = [
    {
      timeId: 't1',
      duration: 28800,
      date: day1,
      approved: 1,
      projectId: 'project-1',
      projectName: 'SAP',
    },
    {
      timeId: 't2',
      duration: 28800,
      date: day2,
      approved: 0,
      projectId: 'project-1',
      projectName: 'SAP',
    },
    {
      timeId: 't3',
      duration: 9000,
      date: day3,
      approved: 1,
      projectId: 'project-1',
      projectName: 'SAP',
    },
  ];

  /** Simulate a v2 envelope with cursor. */
  const v2Page = { items: flatItems, cursor: 'page:2' };

  beforeEach(() => {
    vi.clearAllMocks();
    client = createMockClient();
    tools = getTimeTrackingTools(client);
  });

  describe('list_project_times', () => {
    it('calls /project-times on the v2 API base', async () => {
      await tools.list_project_times.handler({});
    });

    it('passes limit and cursor as query params', async () => {
      await tools.list_project_times.handler({ limit: 10, cursor: 'page:3' });
    });

    it('returns a normalizeV2List envelope with items and nextCursor', async () => {
      vi.mocked(client.get).mockResolvedValueOnce(v2Page);
      const result = await tools.list_project_times.handler({});
      expect(Array.isArray(result.items)).toBe(true);
      expect(result.items).toHaveLength(3);
      expect(result.nextCursor).toBe('page:2');
    });

    it('filters approved-only client-side on the returned page', async () => {
      vi.mocked(client.get).mockResolvedValueOnce(v2Page);
      const result = await tools.list_project_times.handler({ approvedOnly: true });
      const ids = (result.items as Array<{ timeId: string }>).map((e) => e.timeId);
      expect(ids).toEqual(['t1', 't3']);
    });

    it('filters by inclusive date range client-side on the returned page', async () => {
      vi.mocked(client.get).mockResolvedValueOnce(v2Page);
      const result = await tools.list_project_times.handler({
        startDate: '2026-06-02',
        endDate: '2026-06-02',
      });
      const ids = (result.items as Array<{ timeId: string }>).map((e) => e.timeId);
      expect(ids).toEqual(['t2']);
    });
  });

  describe('list_project_times_by_project', () => {
    it('calls /projects/{id}/times on the v2 API base', async () => {
      vi.mocked(client.get).mockResolvedValueOnce({ items: [] });
      await tools.list_project_times_by_project.handler({ projectId: 'project-1' });
    });

    it('passes limit and cursor as query params', async () => {
      vi.mocked(client.get).mockResolvedValueOnce({ items: [] });
      await tools.list_project_times_by_project.handler({
        projectId: 'project-1',
        limit: 5,
        cursor: 'abc',
      });
    });

    it('returns normalized v2 list and applies approvedOnly client-side', async () => {
      vi.mocked(client.get).mockResolvedValueOnce(v2Page);
      const result = await tools.list_project_times_by_project.handler({
        projectId: 'project-1',
        approvedOnly: true,
      });
      const ids = (result.items as Array<{ timeId: string }>).map((e) => e.timeId);
      expect(ids).toEqual(['t1', 't3']);
    });
  });

  describe('get_project_time', () => {
    it('calls /projects/{id}/times/{timeId} on the v2 API base', async () => {
      await tools.get_project_time.handler({ projectId: 'project-1', timeTrackingId: 't1' });
    });
  });

  describe('v2 entry shape (ISO date, boolean approved)', () => {
    const v2Items = [
      { id: 'a', duration: 3600, date: '2026-09-01', approved: true },
      { id: 'b', duration: 3600, date: '2026-09-02', approved: false },
      { id: 'c', duration: 3600, date: '2026-09-03', approved: true },
    ];

    it('filters by ISO date and boolean approved client-side', async () => {
      vi.mocked(client.get).mockResolvedValueOnce({ items: v2Items, has_more: false });
      const result = await tools.list_project_times.handler({
        startDate: '2026-09-02',
        approvedOnly: true,
      });
      expect((result.items as Array<{ id: string }>).map((e) => e.id)).toEqual(['c']);
    });

    it('forwards startDate/endDate as query params on the per-project endpoint', async () => {
      vi.mocked(client.get).mockResolvedValueOnce({ items: [] });
      await tools.list_project_times_by_project.handler({
        projectId: 'p1',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
      });
      expect(client.get).toHaveBeenCalledWith('/projects/p1/times', {
        startDate: '2026-09-01',
        endDate: '2026-09-30',
      });
    });
  });

  describe('create_project_time', () => {
    it('posts a snake_case body with duration in seconds', async () => {
      await tools.create_project_time.handler({
        projectId: 'p1',
        duration: 5400,
        userId: 'u1',
        description: 'Reunión',
        date: '2026-09-30',
        taskId: 't1',
      });
      expect(client.post).toHaveBeenCalledWith('/projects/p1/times', {
        duration: 5400,
        user_id: 'u1',
        description: 'Reunión',
        date: '2026-09-30',
        task_id: 't1',
      });
    });

    it('converts decimal hours to seconds', async () => {
      await tools.create_project_time.handler({ projectId: 'p1', hours: 1.5, userId: 'u1' });
      expect(client.post).toHaveBeenCalledWith('/projects/p1/times', {
        duration: 5400,
        user_id: 'u1',
      });
    });

    it('requires duration or hours', async () => {
      await expect(
        tools.create_project_time.handler({ projectId: 'p1', userId: 'u1' })
      ).rejects.toThrow(/duration/);
      expect(client.post).not.toHaveBeenCalled();
    });
  });

  describe('update/delete_project_time', () => {
    it('puts only the provided fields', async () => {
      await tools.update_project_time.handler({
        projectId: 'p1',
        timeTrackingId: 'x1',
        description: 'Corregido',
      });
      expect(client.put).toHaveBeenCalledWith('/projects/p1/times/x1', {
        description: 'Corregido',
      });
    });

    it('deletes the entry under its project', async () => {
      await tools.delete_project_time.handler({ projectId: 'p1', timeTrackingId: 'x1' });
      expect(client.delete).toHaveBeenCalledWith('/projects/p1/times/x1');
    });
  });

  describe('unixToLocalISODate', () => {
    it('formats a local-midnight timestamp to its calendar day', () => {
      expect(unixToLocalISODate(day2)).toBe('2026-06-02');
    });
  });
});
