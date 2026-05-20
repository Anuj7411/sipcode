import { service } from '../core/CustomerService.js';
export const handler = () => service.greet({ id: 'x' });
