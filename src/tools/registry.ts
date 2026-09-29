import { HoldedClient } from '../holded-client.js';
import { getDocumentTools } from './documents.js';
import { getContactTools } from './contacts.js';
import { getProductTools } from './products.js';
import { getTreasuryTools } from './treasuries.js';
import { getExpensesAccountTools } from './expenses-accounts.js';
import { getNumberingSeriesTools } from './numbering-series.js';
import { getSalesChannelTools } from './sales-channels.js';
import { getPaymentTools } from './payments.js';
import { getTaxTools } from './taxes.js';
import { getContactGroupTools } from './contact-groups.js';
import { getRemittanceTools } from './remittances.js';
import { getServiceTools } from './services.js';
import { getWarehouseTools } from './warehouses.js';
import { getTimeTrackingTools } from './time-tracking.js';
import { getAccountingTools } from './accounting.js';
import { getTeamTools } from './team.js';
import { getLedgerTools } from './ledger.js';
import { getTreasuryV2Tools } from './treasury-v2.js';
import { getProjectTools } from './projects.js';

export interface ToolDefinition {
  description: string;
  inputSchema: Record<string, unknown>;
  readOnlyHint?: boolean;
  handler: (args: never) => Promise<unknown>;
}

export type ToolSet = Record<string, ToolDefinition>;

/** Tool modules keyed by the name accepted in `HOLDED_MODULES`. */
export const TOOL_MODULES: Record<string, (client: HoldedClient) => ToolSet> = {
  documents: getDocumentTools,
  contacts: getContactTools,
  products: getProductTools,
  treasuries: getTreasuryTools,
  'expenses-accounts': getExpensesAccountTools,
  'numbering-series': getNumberingSeriesTools,
  'sales-channels': getSalesChannelTools,
  payments: getPaymentTools,
  taxes: getTaxTools,
  'contact-groups': getContactGroupTools,
  remittances: getRemittanceTools,
  services: getServiceTools,
  warehouses: getWarehouseTools,
  projects: getProjectTools,
  'time-tracking': getTimeTrackingTools,
  accounting: getAccountingTools,
  team: getTeamTools,
  ledger: getLedgerTools,
  'treasury-v2': getTreasuryV2Tools,
};

export interface ToolSelection {
  /** Module names to load; `undefined` loads every module. */
  modules?: string[];
  /** When true, only tools flagged with `readOnlyHint` are exposed. */
  readOnly: boolean;
}

function isTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}

/**
 * Read the tool selection from the environment:
 * - `HOLDED_MODULES`: comma-separated module names (default: all modules).
 * - `HOLDED_READ_ONLY`: `true` to hide every write/destructive tool.
 */
export function loadToolSelection(env: NodeJS.ProcessEnv = process.env): ToolSelection {
  const rawModules = env.HOLDED_MODULES?.trim();
  const modules =
    rawModules && rawModules !== '*' && rawModules.toLowerCase() !== 'all'
      ? rawModules
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean)
      : undefined;

  if (modules) {
    const unknown = modules.filter((name) => !(name in TOOL_MODULES));
    if (unknown.length > 0) {
      throw new Error(
        `Unknown HOLDED_MODULES entries: ${unknown.join(', ')}. ` +
          `Valid modules: ${Object.keys(TOOL_MODULES).join(', ')}`
      );
    }
  }

  return { modules, readOnly: isTruthy(env.HOLDED_READ_ONLY) };
}

/** Build the tool set exposed by the server for a given client and selection. */
export function buildTools(client: HoldedClient, selection: ToolSelection): ToolSet {
  const moduleNames = selection.modules ?? Object.keys(TOOL_MODULES);
  const tools: ToolSet = {};
  for (const moduleName of moduleNames) {
    for (const [name, tool] of Object.entries(TOOL_MODULES[moduleName](client))) {
      if (selection.readOnly && tool.readOnlyHint !== true) {
        continue;
      }
      tools[name] = tool;
    }
  }
  return tools;
}
