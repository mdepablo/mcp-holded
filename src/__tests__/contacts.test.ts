import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockClient } from './mock-client.js';
import { getContactTools } from '../tools/contacts.js';

describe('Contact Tools', () => {
  let client: ReturnType<typeof createMockClient>;
  let tools: ReturnType<typeof getContactTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createMockClient();
    tools = getContactTools(client);
  });

  describe('list_contacts', () => {
    it('should list contacts with no args via v2', async () => {
      await tools.list_contacts.handler({});
    });

    it('should pass limit to API', async () => {
      await tools.list_contacts.handler({ limit: 10 });
    });

    it('should pass cursor to API', async () => {
      await tools.list_contacts.handler({ cursor: 'page:2' });
    });

    it('should pass limit and cursor together', async () => {
      await tools.list_contacts.handler({ limit: 20, cursor: 'page:3' });
    });

    it('should normalize v2 envelope with nextCursor and hasMore', async () => {
      const mockItems = [
        { id: 'c1', name: 'Alice' },
        { id: 'c2', name: 'Bob' },
      ];
      client.get = vi
        .fn()
        .mockResolvedValue({ items: mockItems, cursor: 'page:2', has_more: true });
      const result = (await tools.list_contacts.handler({})) as any;
      expect(result.items).toEqual(mockItems);
      expect(result.nextCursor).toBe('page:2');
      expect(result.hasMore).toBe(true);
    });

    it('should support fields filtering preserving nextCursor and hasMore', async () => {
      const mockItems = [{ id: 'c1', name: 'Alice', email: 'alice@example.com' }];
      client.get = vi
        .fn()
        .mockResolvedValue({ items: mockItems, cursor: 'page:2', has_more: true });
      const result = (await tools.list_contacts.handler({ fields: ['id', 'name'] })) as any;
      expect(result.items[0]).toEqual({ id: 'c1', name: 'Alice' });
      expect(result.items[0]).not.toHaveProperty('email');
      expect(result.nextCursor).toBe('page:2');
      expect(result.hasMore).toBe(true);
    });

    it('should support summary mode', async () => {
      const mockItems = Array.from({ length: 5 }, (_, i) => ({
        id: `c${i}`,
        name: `Contact ${i}`,
      }));
      client.get = vi
        .fn()
        .mockResolvedValue({ items: mockItems, cursor: 'page:2', has_more: true });
      const result = (await tools.list_contacts.handler({ summary: true })) as any;
      expect(result.count).toBe(5);
      expect(result.hasMore).toBe(true);
    });
  });

  describe('create_contact', () => {
    it('should create a contact with required fields (v2)', async () => {
      await tools.create_contact.handler({ name: 'Test Contact' });
    });

    it('should include reference code and tax identification number separately', async () => {
      const args = {
        name: 'Test Contact',
        email: 'test@example.com',
        phone: '+34600000000',
        code: 'CLIENT-001',
        vat_number: 'B12345678',
        type: 'client' as const,
      };
      await tools.create_contact.handler(args);
      expect(client.post).toHaveBeenCalledWith('/contacts', args);
    });

    it('should send is_person so companies are not created as individuals', async () => {
      await tools.create_contact.handler({
        name: 'Button Technologies (TEST)',
        type: 'client',
        is_person: false,
      });
      expect(client.post).toHaveBeenCalledWith('/contacts', {
        name: 'Button Technologies (TEST)',
        type: 'client',
        is_person: false,
      });
      expect((tools.create_contact.inputSchema.properties as any).is_person.type).toBe('boolean');
    });

    it('should use vat_number for NIF/CIF and code for the internal reference', async () => {
      const args = { name: 'Empresa SL', code: 'CLIENT-002', vat_number: 'B98765432' };
      await tools.create_contact.handler(args);
      const callArgs = (client.post as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(callArgs).not.toHaveProperty('vatnumber');
      expect(callArgs).toHaveProperty('code', 'CLIENT-002');
      expect(callArgs).toHaveProperty('vat_number', 'B98765432');
    });

    it('should include billing address', async () => {
      const args = {
        name: 'Test Contact',
        billAddress: {
          address: 'Calle Test 123',
          city: 'Madrid',
          postalCode: '28001',
          country: 'ES',
        },
      };
      await tools.create_contact.handler(args);
      expect(client.post).toHaveBeenCalledWith('/contacts', {
        name: 'Test Contact',
        bill_address: {
          address: 'Calle Test 123',
          city: 'Madrid',
          postal_code: '28001',
          country: 'ES',
        },
      });
    });

    it('should reject contact persons on create because Holded does not accept them there', async () => {
      await expect(
        tools.create_contact.handler({
          name: 'Empresa SL',
          contactPersons: [{ name: 'Ana García' }],
        })
      ).rejects.toThrow();
    });

    it('should reject contact person entries missing a name on update', async () => {
      await expect(
        tools.update_contact.handler({
          contactId: 'contact-123',
          contactPersons: [{ phone: '+34600000001' } as any],
        })
      ).rejects.toThrow();
    });

    it('should reject invalid email format in contact persons on update', async () => {
      await expect(
        tools.update_contact.handler({
          contactId: 'contact-123',
          contactPersons: [{ name: 'Ana García', email: 'not-a-valid-email' }],
        })
      ).rejects.toThrow();
    });

    it('contact_persons email field should have format: email in update inputSchema', () => {
      const contactPersonsItems = (tools.update_contact.inputSchema.properties as any)
        .contact_persons.items;
      expect(contactPersonsItems.properties.email.format).toBe('email');
    });

    it('should create a contact without contact persons', async () => {
      const args = { name: 'Solo Contact', email: 'solo@example.com' };
      await tools.create_contact.handler(args);
    });
  });

  describe('get_contact', () => {
    it('should get a contact by ID (v2)', async () => {
      await tools.get_contact.handler({ contactId: 'contact-123' });
    });
  });

  describe('update_contact', () => {
    it('should update a contact (v2)', async () => {
      const args = {
        contactId: 'contact-123',
        name: 'Updated Name',
        email: 'updated@example.com',
      };
      await tools.update_contact.handler(args);
      expect(client.put).toHaveBeenCalledWith('/contacts/contact-123', {
        name: 'Updated Name',
        email: 'updated@example.com',
      });
    });

    it('should update the internal code and tax identification number separately', async () => {
      await tools.update_contact.handler({
        contactId: 'contact-123',
        code: 'CLIENT-003',
        vat_number: 'A12345678',
      });
      expect(client.put).toHaveBeenCalledWith('/contacts/contact-123', {
        code: 'CLIENT-003',
        vat_number: 'A12345678',
      });
    });

    it('should update contactPersons', async () => {
      const args = {
        contactId: 'contact-123',
        contactPersons: [{ name: 'Maria López', email: 'maria@empresa.com' }],
      };
      await tools.update_contact.handler(args);
      expect(client.put).toHaveBeenCalledWith('/contacts/contact-123', {
        contact_persons: [{ name: 'Maria López', email: 'maria@empresa.com' }],
      });
    });

    it('should allow correcting whether a contact represents a person or company', async () => {
      await tools.update_contact.handler({ contactId: 'contact-123', is_person: false });
      expect(client.put).toHaveBeenCalledWith('/contacts/contact-123', { is_person: false });
    });
  });

  describe('delete_contact', () => {
    it('should delete a contact (v2)', async () => {
      await tools.delete_contact.handler({ contactId: 'contact-123' });
    });
  });

  describe('list_contact_attachments', () => {
    it('should list contact attachments (v2)', async () => {
      await tools.list_contact_attachments.handler({ contactId: 'contact-123' });
      expect(client.get).toHaveBeenCalledWith('/contacts/contact-123/attachments', undefined);
    });
  });

  describe('get_contact_attachment', () => {
    it('should get a specific attachment by filename (v2 breaking change)', async () => {
      await tools.get_contact_attachment.handler({
        contactId: 'contact-123',
        filename: 'invoice.pdf',
      });
      expect(client.get).toHaveBeenCalledWith(
        '/contacts/contact-123/attachments/invoice.pdf',
        undefined
      );
    });
  });
});
