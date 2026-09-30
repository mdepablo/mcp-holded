import { HoldedClient } from '../holded-client.js';
import { normalizeV2List, cursorParams } from '../utils/v2-pagination.js';

interface HoldedAddress extends Record<string, unknown> {
  address?: unknown;
  city?: unknown;
  postal_code?: unknown;
  province?: unknown;
  country?: unknown;
  country_code?: unknown;
}

interface HoldedContact extends Record<string, unknown> {
  id?: unknown;
  name?: unknown;
  trade_name?: unknown;
  type?: unknown;
  is_person?: unknown;
  code?: unknown;
  vat_number?: unknown;
  bill_address?: unknown;
  client_record?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function pickString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

function safeContact(contact: HoldedContact): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of ['id', 'name', 'trade_name', 'type', 'code', 'vat_number'] as const) {
    const value = contact[key];
    if (typeof value === 'string') {
      result[key] = value;
    }
  }

  if (typeof contact.is_person === 'boolean') {
    result.is_person = contact.is_person;
  }

  const address = asRecord(contact.bill_address) as HoldedAddress | undefined;
  if (address) {
    const safeAddress: Record<string, string> = {};
    for (const key of [
      'address',
      'city',
      'postal_code',
      'province',
      'country',
      'country_code',
    ] as const) {
      const value = pickString(address, key);
      if (value !== undefined) {
        safeAddress[key] = value;
      }
    }
    if (Object.keys(safeAddress).length > 0) {
      result.bill_address = safeAddress;
    }
  }

  const clientRecord = asRecord(contact.client_record);
  const accountingCode = clientRecord?.num;
  if (typeof accountingCode === 'string' || typeof accountingCode === 'number') {
    result.accounting_code = String(accountingCode);
  }

  return result;
}

function isClientContact(contact: HoldedContact): boolean {
  return (
    contact.type === 'client' ||
    contact.type === 'debtor' ||
    asRecord(contact.client_record) !== undefined
  );
}

/**
 * A read-only contact directory with a fixed output allowlist.
 *
 * This module deliberately does not expose the raw contact tools. The API
 * response is projected field-by-field; user-supplied field selections and
 * unexpected Holded response properties are never forwarded to the caller.
 */
export function getSafeContactTools(client: HoldedClient) {
  return {
    list_client_directory: {
      description:
        'List only client/debtor contacts from Holded using a fixed safe-field allowlist. Returns identity, public billing address, tax identifiers, contact type and the client accounting code (e.g. 430...). Never returns bank details, emails, phone numbers, notes, custom fields, payment settings, contact persons, shipping addresses or attachments. Cursor-paginated.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          limit: {
            type: 'integer',
            description: 'Maximum contacts per page (Holded default 25, maximum 100)',
          },
          cursor: {
            type: 'string',
            description: 'Cursor from a previous response nextCursor',
          },
        },
        required: [],
      },
      readOnlyHint: true,
      handler: async (args: { limit?: number; cursor?: string } = {}) => {
        const normalized = normalizeV2List(await client.get('/contacts', cursorParams(args)));
        const result: {
          items: Record<string, unknown>[];
          nextCursor?: string;
          hasMore?: boolean;
        } = {
          items: normalized.items
            .map((item) => item as HoldedContact)
            .filter(isClientContact)
            .map(safeContact),
        };

        if (normalized.nextCursor !== undefined) {
          result.nextCursor = normalized.nextCursor;
        }
        if (normalized.hasMore !== undefined) {
          result.hasMore = normalized.hasMore;
        }

        return result;
      },
    },
  };
}
