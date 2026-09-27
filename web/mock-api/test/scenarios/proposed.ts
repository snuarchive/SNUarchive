// Endpoints proposed to the backend but not in the contract yet, so their
// own responses are not contract-checked; the lists they reorder are.
import { describe, expect, it } from "vitest";
import type { H } from "../harness";

export function proposedScenarios(h: H) {
  describe("proposed: favourites order", () => {
    it("reorders the viewer's favourites everywhere they are listed", async () => {
      const c = await h.student();
      const before = (await c.get("/me/favorites/ids")).json.ids as number[];
      expect(before.length).toBeGreaterThan(1);
      const reversed = [...before].reverse();

      const res = await c.put("/me/favorites/order", {
        json: { ids: reversed },
        unchecked: true,
      });
      expect(res.status).toBe(204);

      expect((await c.get("/me/favorites/ids")).json.ids).toEqual(reversed);
      const page = (await c.get("/me/favorites")).json;
      expect(page.items.map((x: { id: number }) => x.id)).toEqual(reversed);
      const home = (await c.get("/courses/home")).json;
      expect(home.favorites[0].id).toBe(reversed[0]);
    });

    it("puts a newly pinned course first", async () => {
      const c = await h.student();
      const before = (await c.get("/me/favorites/ids")).json.ids as number[];
      await c.put("/me/favorites/order", {
        json: { ids: [...before].reverse() },
        unchecked: true,
      });
      const home = (await c.get("/courses/home")).json;
      const candidate = [...home.votingOpen, ...home.recentlyUpdated].find(
        (x: { id: number }) => !before.includes(x.id),
      );
      expect(candidate).toBeDefined();
      await c.put(`/courses/${candidate.id}/favorite`);
      expect((await c.get("/me/favorites/ids")).json.ids[0]).toBe(candidate.id);
    });

    it("refuses a list that is not exactly the viewer's favourites", async () => {
      const c = await h.student();
      const ids = (await c.get("/me/favorites/ids")).json.ids as number[];
      const res = await c.put("/me/favorites/order", {
        json: { ids: ids.slice(1) },
        unchecked: true,
      });
      expect(res.status).toBe(422);
      expect(res.json.error.details.fields[0].field).toBe("ids");
    });

    it("needs the CSRF token like any write", async () => {
      const c = await h.student();
      const ids = (await c.get("/me/favorites/ids")).json.ids as number[];
      const res = await c.put("/me/favorites/order", {
        json: { ids },
        csrf: false,
        unchecked: true,
      });
      expect(res.status).toBe(403);
    });
  });
}
