export function validate(order) {
  return !!order && !!order.amount;
}
