import { GET as bareGet, OPTIONS as bareOptions } from "../../route";

// The path-suffixed form of the protected-resource metadata (RFC 9728
// §3.1: /.well-known/oauth-protected-resource + the resource's path), which
// every 401 from /api/mcp names. The same document as the bare form.

export const dynamic = "force-dynamic";

export function GET() {
  return bareGet();
}

export function OPTIONS() {
  return bareOptions();
}
