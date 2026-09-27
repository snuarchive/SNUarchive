// Endpoints this app has proposed to the backend but the contract does not
// have yet, typed in openapi-typescript's shape so the client accepts them.
// The mock implements them. See docs/frontend/plan.md, 6 ("제안").
import type { components } from "./schema";

type NoParams = {
  query?: never;
  header?: never;
  path?: never;
  cookie?: never;
};

type ErrorResponse = {
  headers: { [name: string]: unknown };
  content: { "application/json": components["schemas"]["Error"] };
};

export interface ProposedPaths {
  "/me/favorites/order": {
    parameters: NoParams;
    get?: never;
    /**
     * Sets the viewer's favourites order. `ids` must list exactly the
     * viewer's pinned course ids, first shown first; otherwise 422 with a
     * field error on `ids`. Lists of favourites (`/me/favorites`,
     * `/me/favorites/ids`, `/courses/home` `favorites`) follow this order,
     * and a newly pinned course goes first.
     */
    put: {
      parameters: NoParams;
      requestBody: {
        content: { "application/json": { ids: number[] } };
      };
      responses: {
        204: { headers: { [name: string]: unknown }; content?: never };
        401: ErrorResponse;
        403: ErrorResponse;
        422: ErrorResponse;
      };
    };
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}
