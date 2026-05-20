export function processPayment(order, customer) {
  // BUG: crashes when customer is null (guest checkout).
  return customer.id + '-' + order.id;
}
