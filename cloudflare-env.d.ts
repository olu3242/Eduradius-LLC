declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    /** `sites` | `token`. Unset: dev server uses `sites`; built Workers deny owner access. */
    WORKSPACE_AUTH_MODE?: string;
    /** Token mode secret (>= 32 chars). Set as a secret, never a plain var. */
    WORKSPACE_ACCESS_TOKEN?: string;
    /** Sites mode owner allowlists (comma-separated). Required outside dev. */
    WORKSPACE_OWNER_IDS?: string;
    WORKSPACE_OWNER_EMAILS?: string;
  }
}
