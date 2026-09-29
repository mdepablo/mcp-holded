import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockClient } from './mock-client.js';
import { getTeamTools } from '../tools/team.js';

describe('Team Tools — employees', () => {
  let client: ReturnType<typeof createMockClient>;
  let tools: ReturnType<typeof getTeamTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createMockClient();
    tools = getTeamTools(client);
  });

  it('list_employees calls the v2 group with cursor params and normalizes', async () => {
    (client.get as any).mockResolvedValue({ items: [{ id: 'e1' }], nextCursor: 'c2' });

    const result = await tools.list_employees.handler({ limit: 10, cursor: 'c1' });

    expect(result).toEqual({ items: [{ id: 'e1' }], nextCursor: 'c2' });
  });

  it('get_employee fetches a single employee on v2', async () => {
    await tools.get_employee.handler({ employeeId: 'abc123' });
  });

  it('create_employee posts the data verbatim on v2', async () => {
    const data = { name: 'Jane', email: 'jane@acme.com' };
    await tools.create_employee.handler({ data });
  });

  it('update_employee_contract puts to the contract subresource', async () => {
    const data = { salary: 30000 };
    await tools.update_employee_contract.handler({ employeeId: 'abc', data });
  });

  it('delete_employee deletes on v2', async () => {
    await tools.delete_employee.handler({ employeeId: 'abc' });
  });
});

describe('Team Tools — time tracking', () => {
  let client: ReturnType<typeof createMockClient>;
  let tools: ReturnType<typeof getTeamTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createMockClient();
    tools = getTeamTools(client);
  });

  it('clock_in_employee posts to the clock-in action without a body', async () => {
    await tools.clock_in_employee.handler({ employeeId: 'e1' });
    expect(client.post).toHaveBeenCalledWith('/employees/e1/clock-in', undefined);
  });

  it('clock_out_employee sends the optional geolocation', async () => {
    await tools.clock_out_employee.handler({ employeeId: 'e1', latitude: 41.39, longitude: 2.17 });
    expect(client.post).toHaveBeenCalledWith('/employees/e1/clock-out', {
      latitude: 41.39,
      longitude: 2.17,
    });
  });

  it('pause/unpause_employee post to their actions', async () => {
    await tools.pause_employee.handler({ employeeId: 'e1' });
    await tools.unpause_employee.handler({ employeeId: 'e1' });
    expect(client.post).toHaveBeenCalledWith('/employees/e1/pause', undefined);
    expect(client.post).toHaveBeenCalledWith('/employees/e1/unpause', undefined);
  });

  it('list_employee_times lists globally by default', async () => {
    (client.get as any).mockResolvedValue([]);
    await tools.list_employee_times.handler({});
    expect(client.get).toHaveBeenCalledWith('/employee-times', {});
  });

  it('list_employee_times sends date filters server-side when scoped to an employee', async () => {
    (client.get as any).mockResolvedValue([]);
    await tools.list_employee_times.handler({
      employeeId: 'e1',
      limit: 5,
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
    expect(client.get).toHaveBeenCalledWith('/employees/e1/times', {
      limit: 5,
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
  });

  it('list_employee_times filters the global list client-side by day', async () => {
    (client.get as any).mockResolvedValue({
      items: [
        { id: 'a', start_at: '2026-09-01T09:00:00' },
        { id: 'b', start_at: '2026-09-15T09:00:00' },
      ],
      has_more: false,
    });
    const result = await tools.list_employee_times.handler({ startDate: '2026-09-10' });
    expect(client.get).toHaveBeenCalledWith('/employee-times', {});
    expect(result.items).toEqual([{ id: 'b', start_at: '2026-09-15T09:00:00' }]);
  });

  it('create_employee_time maps fields and pauses to snake_case', async () => {
    await tools.create_employee_time.handler({
      employeeId: 'e1',
      startAt: '2026-07-01T09:00:00',
      endAt: '2026-07-01T17:00:00',
      pauses: [{ startAt: '2026-07-01T14:00:00', endAt: '2026-07-01T15:00:00' }],
    });
    expect(client.post).toHaveBeenCalledWith('/employees/e1/times', {
      start_at: '2026-07-01T09:00:00',
      end_at: '2026-07-01T17:00:00',
      pauses: [{ start_at: '2026-07-01T14:00:00', end_at: '2026-07-01T15:00:00' }],
    });
  });

  it('create_employee_time rejects date-times with timezone', async () => {
    await expect(
      tools.create_employee_time.handler({
        employeeId: 'e1',
        startAt: '2026-07-01T09:00:00Z',
        endAt: '2026-07-01T17:00:00Z',
      })
    ).rejects.toThrow(/Validation error/);
    expect(client.post).not.toHaveBeenCalled();
  });

  it('update/delete_employee_time address the time record directly', async () => {
    await tools.update_employee_time.handler({
      timeId: 't1',
      startAt: '2026-07-01T08:00:00',
      endAt: '2026-07-01T16:00:00',
    });
    expect(client.put).toHaveBeenCalledWith('/employee-times/t1', {
      start_at: '2026-07-01T08:00:00',
      end_at: '2026-07-01T16:00:00',
    });

    await tools.delete_employee_time.handler({ timeId: 't1' });
    expect(client.delete).toHaveBeenCalledWith('/employee-times/t1');
  });
});

describe('Team Tools — salary records', () => {
  let client: ReturnType<typeof createMockClient>;
  let tools: ReturnType<typeof getTeamTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createMockClient();
    tools = getTeamTools(client);
  });

  it('list_salary_records lists on v2 with cursor params', async () => {
    (client.get as any).mockResolvedValue({ items: [] });
    await tools.list_salary_records.handler({ limit: 20 });
  });

  it('get_salary_record fetches one record', async () => {
    await tools.get_salary_record.handler({ salaryRecordId: 's1' });
  });

  it('create/update/delete_salary_record hit the CRUD routes', async () => {
    const data = { employeeId: 'e1', lines: [] };
    await tools.create_salary_record.handler({ data });

    await tools.update_salary_record.handler({ salaryRecordId: 's1', data });

    await tools.delete_salary_record.handler({ salaryRecordId: 's1' });
  });

  it('get_salary_record_defaults fetches the defaults', async () => {
    await tools.get_salary_record_defaults.handler();
  });
});
