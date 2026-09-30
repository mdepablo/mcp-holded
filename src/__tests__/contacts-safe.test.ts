import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockClient } from './mock-client.js';
import { getSafeContactTools } from '../tools/contacts-safe.js';

describe('Safe Contact Tools', () => {
  let client: ReturnType<typeof createMockClient>;
  let tools: ReturnType<typeof getSafeContactTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createMockClient();
    tools = getSafeContactTools(client);
  });

  it('returns only the fixed allowlist, including the client accounting code', async () => {
    vi.mocked(client.get).mockResolvedValueOnce({
      items: [
        {
          id: 'contact-1',
          name: 'Empresa Ejemplo SL',
          trade_name: 'Ejemplo',
          type: 'client',
          is_person: false,
          code: 'B12345678',
          vat_number: 'ESB12345678',
          iban: 'ES9121000418450200051332',
          swift: 'CAIXESBBXXX',
          sepa_ref: 'SEPA-PRIVATE',
          email: 'private@example.test',
          phone: '+34123456789',
          bill_address: {
            address: 'Calle Pública 1',
            city: 'Barcelona',
            postal_code: '08001',
            province: 'Barcelona',
            country: 'España',
            country_code: 'ES',
            info: 'Private free text that must not leak',
          },
          client_record: { num: 430000001, name: 'Clientes nacionales' },
          supplier_record: { num: 400000001, name: 'Suppliers' },
          defaults: { payment_method: 'direct-debit', discount: 20 },
          shipping_addresses: [{ address: 'Private shipping address' }],
          notes: [{ description: 'Internal note' }],
          contact_persons: [{ name: 'Private person', email: 'person@example.test' }],
          custom_fields: [{ field: 'private', value: 'secret' }],
          extra_emails: ['other@example.test'],
          social_networks: { linkedin: 'https://example.test/private' },
          custom_id: 'external-private-id',
          unexpected_future_sensitive_field: 'never forward arbitrary API fields',
        },
        {
          id: 'supplier-1',
          name: 'Proveedor Ejemplo',
          type: 'supplier',
          supplier_record: { num: 400000001 },
          iban: 'ES0000000000000000000000',
        },
        {
          id: 'debtor-1',
          name: 'Cliente moroso',
          type: 'debtor',
          client_record: { num: '430000002' },
        },
      ],
      cursor: 'next-page',
      has_more: true,
      future_metadata: 'do not forward response envelope extras',
    });

    const result = await tools.list_client_directory.handler({ limit: 10, cursor: 'previous' });

    expect(client.get).toHaveBeenCalledWith('/contacts', { limit: 10, cursor: 'previous' });
    expect(result).toEqual({
      items: [
        {
          id: 'contact-1',
          name: 'Empresa Ejemplo SL',
          trade_name: 'Ejemplo',
          type: 'client',
          is_person: false,
          code: 'B12345678',
          vat_number: 'ESB12345678',
          bill_address: {
            address: 'Calle Pública 1',
            city: 'Barcelona',
            postal_code: '08001',
            province: 'Barcelona',
            country: 'España',
            country_code: 'ES',
          },
          accounting_code: '430000001',
        },
        {
          id: 'debtor-1',
          name: 'Cliente moroso',
          type: 'debtor',
          accounting_code: '430000002',
        },
      ],
      nextCursor: 'next-page',
      hasMore: true,
    });
  });

  it('omits malformed or absent address/accounting fields', async () => {
    vi.mocked(client.get).mockResolvedValueOnce({
      items: [{ id: 'client-1', type: 'client', bill_address: 'not an object' }],
      has_more: false,
    });

    const result = await tools.list_client_directory.handler({});

    expect(result.items).toEqual([{ id: 'client-1', type: 'client' }]);
  });

  it('does not expose a caller-controlled field selection', () => {
    expect(tools.list_client_directory.inputSchema.properties).toEqual({
      limit: expect.any(Object),
      cursor: expect.any(Object),
    });
    expect(tools.list_client_directory.readOnlyHint).toBe(true);
  });
});
