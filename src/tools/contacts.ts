import { HoldedClient } from '../holded-client.js';
import { normalizeV2List, cursorParams } from '../utils/v2-pagination.js';
import {
  contactIdSchema,
  contactAttachmentSchema,
  createContactSchema,
  updateContactSchema,
  withValidation,
} from '../validation.js';

function toContactApiPayload(
  args: object,
  includeContactPersons: boolean
): Record<string, unknown> {
  const { billAddress, tradename, contactPersons, ...payload } = args as Record<string, unknown>;
  const body = payload;
  delete body.contactId;

  if (billAddress && body.bill_address === undefined) {
    const address = billAddress as Record<string, unknown>;
    const { postalCode, countryCode, ...apiAddress } = address;
    body.bill_address = {
      ...apiAddress,
      ...(postalCode === undefined ? {} : { postal_code: postalCode }),
      ...(countryCode === undefined ? {} : { country_code: countryCode }),
    };
  }

  if (tradename !== undefined && body.trade_name === undefined) {
    body.trade_name = tradename;
  }

  if (includeContactPersons && contactPersons !== undefined && body.contact_persons === undefined) {
    body.contact_persons = contactPersons;
  }

  return body;
}

export function getContactTools(client: HoldedClient) {
  return {
    // List Contacts
    list_contacts: {
      description:
        'List contacts (Holded API v2). Cursor-paginated: pass the previous response nextCursor as cursor. Response fields are snake_case; amounts are strings with decimal comma.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          limit: {
            type: 'number',
            description: 'Max items per page (server-paginated; use limit to control page size)',
          },
          cursor: {
            type: 'string',
            description: 'Cursor from a previous response nextCursor',
          },
          summary: {
            type: 'boolean',
            description: 'Return only count and pagination metadata without items (default: false)',
          },
          fields: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Project only these fields per item (e.g. ["id", "name", "email"]). Reduces response size.',
          },
        },
        required: [],
      },
      readOnlyHint: true,
      handler: async (
        args: {
          limit?: number;
          cursor?: string;
          summary?: boolean;
          fields?: string[];
        } = {}
      ) => {
        const result = normalizeV2List(await client.get('/contacts', cursorParams(args)));

        if (args.fields?.length) {
          result.items = (result.items as Array<Record<string, unknown>>).map((item) => {
            const picked: Record<string, unknown> = {};
            for (const f of args.fields as string[]) if (f in item) picked[f] = item[f];
            return picked;
          });
        }

        if (args.summary) {
          const out: Record<string, unknown> = { count: result.items.length };
          if (result.nextCursor) out.nextCursor = result.nextCursor;
          if (result.hasMore !== undefined) out.hasMore = result.hasMore;
          return out;
        }

        return result;
      },
    },

    // Create Contact
    create_contact: {
      description: 'Create a new contact (Holded API v2)',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: {
            type: 'string',
            description: 'Contact name',
          },
          email: {
            type: 'string',
            description: 'Contact email',
          },
          phone: {
            type: 'string',
            description: 'Contact phone number',
          },
          mobile: {
            type: 'string',
            description: 'Contact mobile number',
          },
          website: {
            type: 'string',
            description: 'Contact website URL',
          },
          code: {
            type: 'string',
            description: 'Holded internal reference code for the contact',
          },
          vat_number: {
            type: 'string',
            description: 'Tax identification number (NIF/CIF/VAT)',
          },
          trade_name: {
            type: 'string',
            description: 'Trade name',
          },
          is_person: {
            type: 'boolean',
            description: 'True for a natural person; false for a company',
          },
          type: {
            type: 'string',
            enum: ['client', 'supplier', 'lead', 'debtor', 'creditor'],
            description: 'Contact type',
          },
          billAddress: {
            type: 'object',
            description: 'Legacy camelCase alias for bill_address',
            properties: {
              address: { type: 'string' },
              city: { type: 'string' },
              postalCode: { type: 'string' },
              postal_code: { type: 'string' },
              province: { type: 'string' },
              country: { type: 'string' },
              countryCode: { type: 'string' },
              country_code: { type: 'string' },
              info: { type: 'string' },
            },
          },
          tradename: {
            type: 'string',
            description: 'Legacy alias for trade_name',
          },
          bill_address: {
            type: 'object',
            description: 'Billing address using Holded API field names',
            properties: {
              address: { type: 'string' },
              city: { type: 'string' },
              postal_code: { type: 'string' },
              province: { type: 'string' },
              country: { type: 'string' },
              country_code: { type: 'string' },
              info: { type: 'string' },
            },
          },
        },
        required: ['name'],
      },
      destructiveHint: true,
      handler: withValidation(createContactSchema, async (args) => {
        return client.post('/contacts', toContactApiPayload(args, false));
      }),
    },

    // Get Contact
    get_contact: {
      description: 'Get a specific contact by ID (Holded API v2)',
      inputSchema: {
        type: 'object' as const,
        properties: {
          contactId: {
            type: 'string',
            description: 'Contact ID',
          },
        },
        required: ['contactId'],
      },
      readOnlyHint: true,
      handler: withValidation(contactIdSchema, async (args) => {
        return client.get(`/contacts/${args.contactId}`, undefined);
      }),
    },

    // Update Contact
    update_contact: {
      description: 'Update an existing contact (Holded API v2)',
      inputSchema: {
        type: 'object' as const,
        properties: {
          contactId: {
            type: 'string',
            description: 'Contact ID to update',
          },
          name: {
            type: 'string',
            description: 'Contact name',
          },
          email: {
            type: 'string',
            description: 'Contact email',
          },
          phone: {
            type: 'string',
            description: 'Contact phone number',
          },
          mobile: {
            type: 'string',
            description: 'Contact mobile number',
          },
          website: {
            type: 'string',
            description: 'Contact website URL',
          },
          code: {
            type: 'string',
            description: 'Holded internal reference code for the contact',
          },
          vat_number: {
            type: 'string',
            description: 'Tax identification number (NIF/CIF/VAT)',
          },
          trade_name: {
            type: 'string',
            description: 'Trade name',
          },
          is_person: {
            type: 'boolean',
            description: 'True for a natural person; false for a company',
          },
          type: {
            type: 'string',
            enum: ['client', 'supplier', 'lead', 'debtor', 'creditor'],
            description: 'Contact type',
          },
          billAddress: {
            type: 'object',
            description: 'Legacy camelCase alias for bill_address',
            properties: {
              address: { type: 'string' },
              city: { type: 'string' },
              postalCode: { type: 'string' },
              postal_code: { type: 'string' },
              province: { type: 'string' },
              country: { type: 'string' },
              countryCode: { type: 'string' },
              country_code: { type: 'string' },
              info: { type: 'string' },
            },
          },
          tradename: {
            type: 'string',
            description: 'Legacy alias for trade_name',
          },
          bill_address: {
            type: 'object',
            description: 'Billing address using Holded API field names',
            properties: {
              address: { type: 'string' },
              city: { type: 'string' },
              postal_code: { type: 'string' },
              province: { type: 'string' },
              country: { type: 'string' },
              country_code: { type: 'string' },
              info: { type: 'string' },
            },
          },
          contact_persons: {
            type: 'array',
            description: 'Contact persons associated with the contact',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                phone: { type: 'string' },
                email: { type: 'string', format: 'email' },
              },
              required: ['name'],
            },
          },
          contactPersons: {
            type: 'array',
            description: 'Legacy camelCase alias for contact_persons',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                phone: { type: 'string' },
                email: { type: 'string', format: 'email' },
              },
              required: ['name'],
            },
          },
        },
        required: ['contactId'],
      },
      destructiveHint: true,
      handler: withValidation(updateContactSchema, async (args) => {
        const { contactId } = args;
        return client.put(`/contacts/${contactId}`, toContactApiPayload(args, true));
      }),
    },

    // Delete Contact
    delete_contact: {
      description: 'Delete a contact (Holded API v2)',
      inputSchema: {
        type: 'object' as const,
        properties: {
          contactId: {
            type: 'string',
            description: 'Contact ID to delete',
          },
        },
        required: ['contactId'],
      },
      destructiveHint: true,
      handler: withValidation(contactIdSchema, async (args) => {
        return client.delete(`/contacts/${args.contactId}`);
      }),
    },

    // Get Contact Attachments List
    list_contact_attachments: {
      description:
        'Get list of attachments for a contact (Holded API v2). Use the filenames from the response with get_contact_attachment.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          contactId: {
            type: 'string',
            description: 'Contact ID',
          },
        },
        required: ['contactId'],
      },
      readOnlyHint: true,
      handler: withValidation(contactIdSchema, async (args) => {
        return client.get(`/contacts/${args.contactId}/attachments`, undefined);
      }),
    },

    // Get Contact Attachment
    get_contact_attachment: {
      description:
        'Get a specific attachment from a contact by filename (Holded API v2). ' +
        'BREAKING CHANGE from v1: the path parameter changed from attachmentId (numeric/UUID) to filename (string). ' +
        'Obtain filenames from list_contact_attachments first.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          contactId: {
            type: 'string',
            description: 'Contact ID',
          },
          filename: {
            type: 'string',
            description: 'Attachment filename as returned by list_contact_attachments',
          },
        },
        required: ['contactId', 'filename'],
      },
      readOnlyHint: true,
      handler: withValidation(contactAttachmentSchema, async (args) => {
        return client.get(`/contacts/${args.contactId}/attachments/${args.filename}`, undefined);
      }),
    },
  };
}
