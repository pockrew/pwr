/** Bun's text loader embeds migration SQL in both development and compiled executables. */
declare module "*.sql" {
  const sql: string;
  export default sql;
}
