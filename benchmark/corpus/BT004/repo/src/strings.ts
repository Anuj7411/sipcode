export const camelCase = (s) => s.replace(/[-_](.)/g, (_, c) => c.toUpperCase());
export const snakeCase = (s) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()).replace(/^_/, '');
export const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
