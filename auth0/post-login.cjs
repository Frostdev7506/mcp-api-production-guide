// Replace both constants with your deployment values before deploying this Action.
const MCP_RESOURCE = "https://YOUR_MCP_HOST/mcp";
const TENANT_CLAIM = "https://YOUR_MCP_HOST/tenant_id";

exports.onExecutePostLogin = async (event, api) => {
  if (event.resource_server?.identifier !== MCP_RESOURCE) return;
  const tenant = event.user.app_metadata?.tenant_id;
  if (typeof tenant !== "string" || tenant.trim() !== tenant || !/^[a-z][a-z0-9-]{0,63}$/.test(tenant)) {
    api.access.deny("Account has no valid company assignment.");
    return;
  }
  api.accessToken.setCustomClaim(TENANT_CLAIM, tenant);
};
