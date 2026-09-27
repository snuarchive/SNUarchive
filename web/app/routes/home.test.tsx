import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./home";

describe("Home", () => {
  it("renders the site name", () => {
    render(<Home />);
    expect(screen.getByRole("main")).toHaveTextContent("SNU Archive");
  });
});
