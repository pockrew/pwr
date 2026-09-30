/// <reference types="vite/client" />

declare module "*.sql" {
  const sql: string;
  export default sql;
}
