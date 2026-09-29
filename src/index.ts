#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { RateLimiter } from './utils/rate-limiter.js';
import { TenantManager, extractTenantId } from './utils/tenant-context.js';
import { loadTenantConfigs, validateTenantConfigs } from './utils/tenant-config.js';
import { buildTools, loadToolSelection } from './tools/registry.js';

// Initialize multi-tenancy support
const tenantConfigs = loadTenantConfigs();
validateTenantConfigs(tenantConfigs);

const tenantManager = new TenantManager();
for (const config of tenantConfigs) {
  tenantManager.registerTenant(config);
}

// Get default client for tools registration (backward compatibility)
const defaultTenant = tenantManager.getDefaultTenant();
if (!defaultTenant) {
  console.error('Error: No default tenant available');
  process.exit(1);
}
const client = defaultTenant.client;

// Initialize rate limiter with per-tool configuration
const rateLimiter = new RateLimiter({
  maxRequests: 100, // Default: 100 requests per minute
  windowMs: 60000, // 1 minute window
  toolLimits: {
    // Stricter limits for destructive operations
    create_document: { maxRequests: 20, windowMs: 60000 },
    delete_document: { maxRequests: 10, windowMs: 60000 },
    create_contact: { maxRequests: 20, windowMs: 60000 },
    delete_contact: { maxRequests: 10, windowMs: 60000 },
    update_contact: { maxRequests: 30, windowMs: 60000 },
    update_document: { maxRequests: 30, windowMs: 60000 },
    // More lenient for read operations
    list_contacts: { maxRequests: 200, windowMs: 60000 },
    list_documents: { maxRequests: 200, windowMs: 60000 },
    get_contact: { maxRequests: 200, windowMs: 60000 },
    get_document: { maxRequests: 200, windowMs: 60000 },
    // Read-heavy endpoints that can return large unpaginated payloads
    list_project_times: { maxRequests: 60, windowMs: 60000 },
    list_project_times_by_project: { maxRequests: 60, windowMs: 60000 },
    get_daily_ledger: { maxRequests: 60, windowMs: 60000 },
    get_chart_of_accounts: { maxRequests: 60, windowMs: 60000 },
    // v2 write/destructive operations
    create_employee: { maxRequests: 20, windowMs: 60000 },
    delete_employee: { maxRequests: 10, windowMs: 60000 },
    create_salary_record: { maxRequests: 20, windowMs: 60000 },
    delete_salary_record: { maxRequests: 10, windowMs: 60000 },
    create_ledger_entry: { maxRequests: 20, windowMs: 60000 },
    create_bank_movement: { maxRequests: 20, windowMs: 60000 },
    delete_bank_account: { maxRequests: 10, windowMs: 60000 },
    update_employee: { maxRequests: 30, windowMs: 60000 },
    update_salary_record: { maxRequests: 30, windowMs: 60000 },
    update_bank_account: { maxRequests: 30, windowMs: 60000 },
    delete_employee_time: { maxRequests: 10, windowMs: 60000 },
    delete_invoicing_forecast: { maxRequests: 10, windowMs: 60000 },
    delete_service: { maxRequests: 10, windowMs: 60000 },
    delete_warehouse: { maxRequests: 10, windowMs: 60000 },
    delete_product: { maxRequests: 10, windowMs: 60000 },
    delete_project: { maxRequests: 10, windowMs: 60000 },
    delete_task: { maxRequests: 10, windowMs: 60000 },
    delete_project_time: { maxRequests: 10, windowMs: 60000 },
  },
});

// Tool selection (HOLDED_MODULES / HOLDED_READ_ONLY) applies to every tenant
const toolSelection = loadToolSelection();
const allTools = buildTools(client, toolSelection);

// Create server
const server = new Server(
  {
    name: 'mcp-holded',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: Object.entries(allTools).map(([name, tool]) => ({
      name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: { readOnlyHint: tool.readOnlyHint === true },
    })),
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Extract tenant ID from request arguments
  const requestedTenantId = extractTenantId(args);

  // Get tenant context (use requested tenant or default)
  const tenantContext = requestedTenantId
    ? tenantManager.getTenant(requestedTenantId)
    : tenantManager.getDefaultTenant();

  if (!tenantContext) {
    const errorMsg = requestedTenantId
      ? `Tenant '${requestedTenantId}' not found`
      : 'No default tenant available';
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: errorMsg }),
        },
      ],
      isError: true,
    };
  }

  // Check if tenant is enabled
  if (!tenantContext.config.enabled) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: 'Tenant disabled',
            message: `Tenant '${tenantContext.tenantId}' is currently disabled`,
          }),
        },
      ],
      isError: true,
    };
  }

  // Get tools with tenant-specific client
  const tenantTools = buildTools(tenantContext.client, toolSelection);

  const tool = tenantTools[name];
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  // Check rate limit before executing tool
  const rateLimit = await rateLimiter.checkLimit(name);
  if (!rateLimit.allowed) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: 'Rate limit exceeded',
            message: `Too many requests for tool '${name}'. Please retry after ${rateLimit.retryAfter} seconds.`,
            retryAfter: rateLimit.retryAfter,
            resetTime: rateLimit.resetTime,
          }),
        },
      ],
      isError: true,
    };
  }

  try {
    const result = await tool.handler(args as never);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Holded MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
