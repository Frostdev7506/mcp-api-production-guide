import { createRemoteJWKSet, jwtVerify, SignJWT, errors } from "jose";
import { OAuthError, OAuthErrorCode, type OAuthTokenVerifier } from "@modelcontextprotocol/server";
import { z, ZodError } from "zod";

export const Principal = z.object({
  subject: z.string().min(1).max(128),
  tenant: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  scopes: z.array(z.string().max(64)).max(32),
});
export type Principal = z.infer<typeof Principal>;
export const ProviderMetadata = z.object({
  issuer: z.url(),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  jwks_uri: z.url(),
  response_types_supported: z.array(z.string()),
  code_challenge_methods_supported: z.array(z.string()).optional(),
  scopes_supported: z.array(z.string()).optional(),
  grant_types_supported: z.array(z.string()).optional(),
  token_endpoint_auth_methods_supported: z.array(z.string()).optional(),
  client_id_metadata_document_supported: z.boolean().optional(),
  registration_endpoint: z.url().optional(),
  authorization_response_iss_parameter_supported: z.boolean().optional(),
});

export function createVerifier(issuer: string, resource: URL, jwksUri: string, tenantClaim = "tenant_id"): OAuthTokenVerifier {
  const jwks = createRemoteJWKSet(new URL(jwksUri), { timeoutDuration: 3000 });
  return {
    async verifyAccessToken(token) {
      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer, audience: resource.href, algorithms: ["RS256", "ES256"],
        });
        if (typeof payload.exp !== "number" || typeof payload.scope !== "string") throw new Error("Missing claims");
        const principal = Principal.parse({
          subject: payload.sub,
          tenant: payload[tenantClaim],
          scopes: payload.scope.split(" "),
        });
        return {
          token, clientId: typeof payload.azp === "string" ? payload.azp : "unknown",
          scopes: principal.scopes, expiresAt: payload.exp, resource, extra: { principal },
        };
      } catch (error) {
        console.warn(JSON.stringify({ event: "token_rejected", reason: error instanceof errors.JOSEError ? error.code : error instanceof ZodError ? "invalid_identity_claims" : "invalid_token", invalid_fields: error instanceof ZodError ? error.issues.map(issue => issue.path.join(".")) : undefined }));
        throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid access token");
      }
    },
  };
}

export function delegateToApi(principal: Principal, secret: Uint8Array) {
  return new SignJWT({ tenant: principal.tenant, scope: principal.scopes.join(" ") })
    .setProtectedHeader({ alg: "HS256" }).setIssuer("urn:mcp-support:adapter")
    .setAudience("urn:mcp-support:api").setSubject(principal.subject)
    .setIssuedAt().setExpirationTime("60s").sign(secret);
}
