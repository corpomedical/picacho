// The two discovery documents (spec §4.2 table).
//
//   Protected resource metadata (RFC 9728), at
//   /.well-known/oauth-protected-resource and …/api/mcp: which resource
//   this is (the host the request came in on), which authorization server
//   issues its tokens, the scopes, and that tokens ride in the header.
//
//   Authorization server metadata (RFC 8414), at
//   /.well-known/oauth-authorization-server: one issuer
//   (https://picacho.ai), its endpoints, S256 only, client metadata
//   documents supported, `iss` returned on every authorization response
//   (RFC 9207, which lets ChatGPT use its stable callback).
//
// Pure and alias-free.

import {
  AUTHORIZE_PATH,
  MCP_SCOPES,
  REGISTER_PATH,
  REVOKE_PATH,
  TOKEN_PATH,
  issuerFor,
  resourceFor,
} from "./config";

/** RFC 9728: the resource on this host, and the one authorization server. */
export function protectedResourceMetadata(origin: string): Record<string, unknown> {
  const issuer = issuerFor(origin);
  return {
    resource: resourceFor(origin),
    authorization_servers: [issuer],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Picacho",
    resource_documentation: `${issuer}/docs/api`,
  };
}

/** RFC 8414, for the issuer this host belongs to. Every endpoint lives on the issuer's own origin. */
export function authorizationServerMetadata(origin: string): Record<string, unknown> {
  const issuer = issuerFor(origin);
  return {
    issuer,
    authorization_endpoint: `${issuer}${AUTHORIZE_PATH}`,
    token_endpoint: `${issuer}${TOKEN_PATH}`,
    registration_endpoint: `${issuer}${REGISTER_PATH}`,
    revocation_endpoint: `${issuer}${REVOKE_PATH}`,
    scopes_supported: [...MCP_SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    // Public clients only: PKCE S256 is the proof, no secret is ever issued.
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${issuer}/docs/api`,
  };
}

/** The headers both documents are served with: public, cacheable for an hour, readable from any origin. */
export const METADATA_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  "cache-control": "public, max-age=3600",
  "access-control-allow-origin": "*",
};
