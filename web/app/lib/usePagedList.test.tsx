import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  createMemoryRouter,
  RouterProvider,
  useLoaderData,
  useLocation,
} from "react-router";
import { describe, expect, it } from "vitest";
import { usePagedList } from "./usePagedList";

type Page = { items: string[]; nextCursor: string | null };

function List() {
  const first = useLoaderData<Page>();
  const location = useLocation();
  const list = usePagedList(
    first,
    (cursor) => `/more${location.search}&cursor=${cursor}`,
  );
  return (
    <>
      <ul>
        {list.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <button disabled={list.loading || !list.cursor} onClick={list.loadMore}>
        more
      </button>
    </>
  );
}

function fixture(more?: (request: Request) => Promise<Page>) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        Component: List,
        HydrateFallback: () => null,
        loader: ({ request }) => {
          const filter = new URL(request.url).searchParams.get("filter");
          return { items: [`${filter}1`], nextCursor: "next" };
        },
      },
      {
        path: "/more",
        loader: ({ request }) =>
          more
            ? more(request)
            : {
                items: [`${new URL(request.url).searchParams.get("filter")}2`],
                nextCursor: null,
              },
      },
    ],
    { initialEntries: ["/?filter=a"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("usePagedList navigation", () => {
  it("drops previous pages on a filter change and loads the new filter's next page", async () => {
    const router = fixture();
    await screen.findByText("a1");
    fireEvent.click(screen.getByRole("button", { name: "more" }));
    await screen.findByText("a2");
    await act(() => router.navigate("/?filter=b"));
    expect(screen.queryByText("a2")).not.toBeInTheDocument();
    expect(screen.getByText("b1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "more" }));
    await screen.findByText("b2");
    expect(screen.queryByText("a2")).not.toBeInTheDocument();
  });

  it("drops appended rows after a redirect to the same address", async () => {
    const router = fixture();
    await screen.findByText("a1");
    fireEvent.click(screen.getByRole("button", { name: "more" }));
    await screen.findByText("a2");
    await act(() => router.navigate("/?filter=a", { replace: true }));
    expect(screen.queryByText("a2")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "more" })).toBeEnabled();
  });

  it("aborts a previous page request and ignores its late response", async () => {
    let release!: (page: Page) => void;
    let signal: AbortSignal | undefined;
    const held = new Promise<Page>((resolve) => {
      release = resolve;
    });
    const router = fixture(async (request) => {
      signal = request.signal;
      return held;
    });
    await screen.findByText("a1");
    fireEvent.click(screen.getByRole("button", { name: "more" }));
    await waitFor(() => expect(signal).toBeDefined());
    await act(() => router.navigate("/?filter=b"));
    await waitFor(() => expect(signal?.aborted).toBe(true));
    await act(async () => release({ items: ["late-a2"], nextCursor: null }));
    expect(screen.queryByText("late-a2")).not.toBeInTheDocument();
    expect(screen.getByText("b1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "more" })).toBeEnabled();
  });
});
