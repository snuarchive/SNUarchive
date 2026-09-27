// Schema types for use in components, which must not import the server-only
// client module.
import type { components } from "./schema";

export type Schemas = components["schemas"];
