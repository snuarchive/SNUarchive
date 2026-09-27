import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import ArchiveLayout, { loader } from "./layout";

function renderAt(url: string) {
  const Stub = createRoutesStub([
    {
      Component: ArchiveLayout,
      loader,
      children: [
        { path: "/", Component: () => null },
        { path: "/courses/:courseId", Component: () => null },
      ],
    },
  ]);
  render(<Stub initialEntries={[url]} />);
}

describe("ArchiveLayout search form", () => {
  it("submits to the open course so the course stays selected", async () => {
    renderAt("/courses/abc?q=미적분");
    const form = await screen.findByRole("search");
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/courses/abc");
  });

  it("fills the input from the q parameter", async () => {
    renderAt("/?q=미적분");
    expect(await screen.findByRole("searchbox")).toHaveValue("미적분");
  });

  it("leaves the input empty without q", async () => {
    renderAt("/");
    expect(await screen.findByRole("searchbox")).toHaveValue("");
  });
});
