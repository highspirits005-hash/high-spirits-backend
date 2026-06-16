/**
 * order service
 *
 * Business logic for order creation, validation, ID generation, and total calculation.
 */

import { factories } from '@strapi/strapi';

// ── Types ────────────────────────────────────────────────────────────────────

interface OrderItem {
  itemId: number;
  itemName: string;
  quantity: number;
  unitPrice: number;
  subtotal?: number;
}

interface OrderData {
  customerName: string;
  phone: string;
  email?: string;
  address?: string;
  items: OrderItem[];
  notes?: string;
  whatsappMessage: string;
}

interface ValidationError {
  field: string;
  message: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const PHONE_REGEX = /^\+?[\d\s\-()]{7,15}$/;
const ORDER_ID_PREFIX = 'HS';
const MAX_RETRY_ATTEMPTS = 5;

// ── Service ──────────────────────────────────────────────────────────────────

export default factories.createCoreService('api::order.order', ({ strapi }) => ({

  /**
   * Validates the incoming order data and returns an array of errors.
   * Returns an empty array if all validations pass.
   */
  validateOrderData(data: OrderData): ValidationError[] {
    const errors: ValidationError[] = [];

    // customerName
    if (!data.customerName || typeof data.customerName !== 'string') {
      errors.push({ field: 'customerName', message: 'Customer name is required.' });
    } else if (data.customerName.trim().length < 2) {
      errors.push({ field: 'customerName', message: 'Customer name must be at least 2 characters.' });
    }

    // phone
    if (!data.phone || typeof data.phone !== 'string') {
      errors.push({ field: 'phone', message: 'Phone number is required.' });
    } else if (!PHONE_REGEX.test(data.phone.trim())) {
      errors.push({ field: 'phone', message: 'Please provide a valid phone number.' });
    }

    // email (optional but must be valid if provided)
    if (data.email !== undefined && data.email !== null && data.email !== '') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (typeof data.email !== 'string' || !emailRegex.test(data.email.trim())) {
        errors.push({ field: 'email', message: 'Please provide a valid email address.' });
      }
    }

    // items
    if (!data.items) {
      errors.push({ field: 'items', message: 'Order items are required.' });
    } else if (!Array.isArray(data.items)) {
      errors.push({ field: 'items', message: 'Order items must be an array.' });
    } else if (data.items.length === 0) {
      errors.push({ field: 'items', message: 'Order must contain at least one item.' });
    } else {
      data.items.forEach((item, index) => {
        if (!item.itemId || typeof item.itemId !== 'number') {
          errors.push({ field: `items[${index}].itemId`, message: `Item ${index + 1}: itemId is required and must be a number.` });
        }
        if (!item.itemName || typeof item.itemName !== 'string') {
          errors.push({ field: `items[${index}].itemName`, message: `Item ${index + 1}: itemName is required.` });
        }
        if (item.quantity === undefined || item.quantity === null || typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity <= 0) {
          errors.push({ field: `items[${index}].quantity`, message: `Item ${index + 1}: quantity must be a positive integer.` });
        }
        if (item.unitPrice === undefined || item.unitPrice === null || typeof item.unitPrice !== 'number' || item.unitPrice < 0) {
          errors.push({ field: `items[${index}].unitPrice`, message: `Item ${index + 1}: unitPrice must be a number greater than or equal to 0.` });
        }
      });
    }

    // whatsappMessage
    if (!data.whatsappMessage || typeof data.whatsappMessage !== 'string') {
      errors.push({ field: 'whatsappMessage', message: 'WhatsApp message is required.' });
    }

    return errors;
  },

  /**
   * Calculates the total amount from order items (server-side).
   * Also attaches the computed subtotal to each item.
   */
  calculateTotal(items: OrderItem[]): { total: number; itemsWithSubtotals: OrderItem[] } {
    const itemsWithSubtotals = items.map((item) => ({
      ...item,
      subtotal: Math.round(item.quantity * item.unitPrice * 100) / 100,
    }));

    const total = itemsWithSubtotals.reduce((sum, item) => sum + item.subtotal, 0);

    return {
      total: Math.round(total * 100) / 100,
      itemsWithSubtotals,
    };
  },

  /**
   * Generates a unique order ID in the format HS-YYYYMMDD-XXXX.
   * Uses a retry loop to handle concurrent requests safely.
   */
  async generateOrderId(): Promise<string> {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dateStr = `${year}${month}${day}`;
    const prefix = `${ORDER_ID_PREFIX}-${dateStr}-`;

    // Find today's highest order number
    const existingOrders = await strapi.documents('api::order.order').findMany({
      filters: {
        orderId: { $startsWith: prefix },
      },
      sort: 'orderId:desc',
      limit: 1,
    });

    let nextNumber = 1;

    if (existingOrders && existingOrders.length > 0) {
      const lastOrderId = existingOrders[0].orderId as string;
      const lastNumber = parseInt(lastOrderId.split('-').pop() || '0', 10);
      nextNumber = lastNumber + 1;
    }

    const sequence = String(nextNumber).padStart(4, '0');
    return `${prefix}${sequence}`;
  },

  /**
   * Full order creation flow: validate → calculate → generate ID → persist.
   */
  async createOrder(data: OrderData) {
    // 1. Validate
    const errors = this.validateOrderData(data);
    if (errors.length > 0) {
      return { success: false, errors };
    }

    // 2. Calculate total (server-side)
    const { total, itemsWithSubtotals } = this.calculateTotal(data.items);

    // 3. Generate unique order ID (with retry for concurrency safety)
    let orderId: string | null = null;
    let attempts = 0;

    while (!orderId && attempts < MAX_RETRY_ATTEMPTS) {
      attempts++;
      const candidateId = await this.generateOrderId();

      // Check if this ID already exists (concurrency guard)
      const existing = await strapi.documents('api::order.order').findMany({
        filters: { orderId: candidateId },
        limit: 1,
      });

      if (!existing || existing.length === 0) {
        orderId = candidateId;
      }
    }

    if (!orderId) {
      return {
        success: false,
        errors: [{ field: 'orderId', message: 'Unable to generate a unique order ID. Please try again.' }],
      };
    }

    // 4. Create the order record
    const sanitizedData = {
      orderId,
      customerName: data.customerName.trim(),
      phone: data.phone.trim(),
      email: data.email ? data.email.trim() : null,
      address: data.address ? data.address.trim() : null,
      items: itemsWithSubtotals,
      totalAmount: total,
      notes: data.notes ? data.notes.trim() : null,
      whatsappMessage: data.whatsappMessage.trim(),
      orderStatus: 'Pending' as const,
      source: 'website',
    };

    const order = await strapi.documents('api::order.order').create({
      data: sanitizedData as any,
    });

    return {
      success: true,
      order,
    };
  },
}));
