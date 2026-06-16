/**
 * order controller
 *
 * Custom controller that overrides the default create method
 * to enforce server-side validation, total calculation, and order ID generation.
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::order.order', ({ strapi }) => ({

  /**
   * POST /api/orders
   *
   * Creates a new order with server-side validation and processing.
   * Strips any client-supplied orderId, totalAmount, or orderStatus.
   */
  async create(ctx) {
    try {
      // Extract the request body — support both wrapped { data: {...} } and flat payload
      const body = ctx.request.body?.data || ctx.request.body;

      if (!body || typeof body !== 'object') {
        return ctx.badRequest('Request body is required.');
      }

      // Extract only allowed fields (strip orderId, totalAmount, orderStatus, source)
      const orderData = {
        customerName: body.customerName,
        phone: body.phone,
        email: body.email,
        address: body.address,
        items: body.items,
        notes: body.notes,
        whatsappMessage: body.whatsappMessage,
      };

      // Delegate to the service layer
      const orderService = strapi.service('api::order.order') as any;
      const result = await orderService.createOrder(orderData);

      if (!result.success) {
        return ctx.badRequest('Validation failed.', {
          errors: result.errors,
        });
      }

      // Return clean response
      ctx.status = 201;
      ctx.body = {
        success: true,
        orderId: result.order.orderId,
        status: result.order.orderStatus,
      };
    } catch (error) {
      strapi.log.error('Order creation failed:', error);
      return ctx.internalServerError('An unexpected error occurred while creating the order.');
    }
  },
}));
