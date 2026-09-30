import { describe, it, expect } from 'vitest';
import { HoldedClient } from '../holded-client.js';
import { TOOL_MODULES, buildTools, loadToolSelection } from '../tools/registry.js';

describe('tool registry', () => {
  const client = new HoldedClient('pat_test_key');

  it('loads every module when HOLDED_MODULES is not set', () => {
    const selection = loadToolSelection({});
    expect(selection).toEqual({ modules: undefined, readOnly: false });

    const tools = buildTools(client, selection);
    expect(tools).toHaveProperty('list_documents');
    expect(tools).toHaveProperty('list_projects');
    expect(tools).toHaveProperty('create_project_time');
  });

  it('treats "all" and "*" as every module', () => {
    expect(loadToolSelection({ HOLDED_MODULES: 'all' }).modules).toBeUndefined();
    expect(loadToolSelection({ HOLDED_MODULES: '*' }).modules).toBeUndefined();
  });

  it('restricts tools to the selected modules', () => {
    const selection = loadToolSelection({ HOLDED_MODULES: 'projects, time-tracking' });
    const tools = buildTools(client, selection);

    expect(tools).toHaveProperty('list_projects');
    expect(tools).toHaveProperty('list_project_times');
    expect(tools).not.toHaveProperty('list_documents');
    expect(tools).not.toHaveProperty('list_employees');
  });

  it('exposes only the safe contact directory when contacts-safe is selected', () => {
    const selection = loadToolSelection({
      HOLDED_MODULES: 'contacts-safe',
      HOLDED_READ_ONLY: 'true',
    });
    const tools = buildTools(client, selection);

    expect(Object.keys(tools)).toEqual(['list_client_directory']);
    expect(tools.list_client_directory.readOnlyHint).toBe(true);
  });

  it('rejects unknown module names', () => {
    expect(() => loadToolSelection({ HOLDED_MODULES: 'projects,proyectos' })).toThrow(
      /Unknown HOLDED_MODULES entries: proyectos/
    );
  });

  it('hides write tools when HOLDED_READ_ONLY is true', () => {
    const selection = loadToolSelection({
      HOLDED_MODULES: 'projects,time-tracking,team',
      HOLDED_READ_ONLY: 'true',
    });
    const tools = buildTools(client, selection);

    expect(tools).toHaveProperty('list_projects');
    expect(tools).toHaveProperty('list_employee_times');
    expect(tools).not.toHaveProperty('create_project');
    expect(tools).not.toHaveProperty('clock_in_employee');
    expect(tools).not.toHaveProperty('delete_project_time');
    expect(Object.values(tools).every((tool) => tool.readOnlyHint === true)).toBe(true);
  });

  it('exposes no duplicated tool names across modules', () => {
    const seen = new Map<string, string>();
    for (const [moduleName, factory] of Object.entries(TOOL_MODULES)) {
      for (const toolName of Object.keys(factory(client))) {
        expect(seen.get(toolName), `${toolName} in ${moduleName}`).toBeUndefined();
        seen.set(toolName, moduleName);
      }
    }
  });
});
