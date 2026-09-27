import { data } from "react-router";

// Thrown from the loader so the server answers with a real 404 status and the
// root error boundary renders the page.
export function loader() {
  throw data(null, { status: 404 });
}

// Never rendered, but without a component React Router treats this as a
// resource route and answers with the bare loader data instead of HTML.
export default function NotFound() {
  return null;
}
