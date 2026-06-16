/**
 * Order lifecycle hooks
 *
 * Safety net to ensure default values are always applied,
 * even if the order is created outside the custom controller
 * (e.g., via the admin panel).
 */

export default {
  beforeCreate(event) {
    const { data } = event.params;

    // Ensure orderStatus defaults to 'Pending'
    if (!data.orderStatus) {
      data.orderStatus = 'Pending';
    }

    // Ensure source defaults to 'website'
    if (!data.source) {
      data.source = 'website';
    }
  },
};
