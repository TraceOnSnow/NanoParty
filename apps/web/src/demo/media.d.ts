/** Images bundled into the static site are imported as URLs. */
declare module "*.gif" {
  const url: string;
  export default url;
}
