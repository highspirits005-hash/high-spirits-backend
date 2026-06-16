/**
 * Custom order routes
 *
 * Defines the public-facing POST /api/orders endpoint
 * that uses the custom controller's create method.
 */

export default {
  routes: [
    {
      method: 'POST',
      path: '/orders/create',
      handler: 'order.create',
      config: {
        auth: false,
        description: 'Create a new order',
      },
    },
  ],
};
