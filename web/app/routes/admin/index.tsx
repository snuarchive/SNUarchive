import { redirect } from "react-router";

// The legacy admin view opened on the report queue tab.
export function loader() {
  return redirect("/admin/review/reports");
}
