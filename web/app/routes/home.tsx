import type { Route } from "./+types/home";

export function meta(): Route.MetaDescriptors {
  return [{ title: "SNU Archive" }];
}

export default function Home() {
  return <main>SNU Archive</main>;
}
