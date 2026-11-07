import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { noteZip, withImageFiles } from "../src/sources/download";

describe("withImageFiles", () => {
  it("points a note's image links at their files", () => {
    expect(
      withImageFiles(
        "![a](asset:fig_1) and ![b](asset:fig_10)",
        new Map([
          ["fig_1", "images/fig_1.png"],
          ["fig_10", "images/fig_10.jpg"],
        ]),
      ),
    ).toBe("![a](images/fig_1.png) and ![b](images/fig_10.jpg)");
  });

  it("leaves the same words anywhere but an image's link", () => {
    const files = new Map([["fig", "images/fig.png"]]);
    const text = "See `asset:fig` and [a site](https://example.com/asset:fig).";
    expect(withImageFiles(text, files)).toBe(text);
  });

  it("leaves links to images it doesn't have", () => {
    expect(withImageFiles("![a](asset:gone)", new Map())).toBe("![a](asset:gone)");
  });
});

describe("noteZip", () => {
  const png = new Uint8Array([1, 2, 3]);

  it("holds the note under its title and the images it links to", async () => {
    const files = unzipSync(
      await noteZip("Lecture 4", "![a](asset:fig)", [
        { name: "fig", type: "image/png", bytes: png },
      ]),
    );
    expect(Object.keys(files).sort()).toEqual(["Lecture 4.md", "images/fig.png"]);
    expect(strFromU8(files["Lecture 4.md"])).toBe("![a](images/fig.png)");
    expect([...files["images/fig.png"]]).toEqual([...png]);
  });

  it("handles an image named like an object's own property", async () => {
    const files = unzipSync(
      await noteZip("n", "![a](asset:__proto__)", [
        { name: "__proto__", type: "image/png", bytes: png },
      ]),
    );
    expect(Object.keys(files).sort()).toEqual(["images/__proto__.png", "n.md"]);
    expect(strFromU8(files["n.md"])).toBe("![a](images/__proto__.png)");
  });

  it("keeps a title from making folders", async () => {
    const files = unzipSync(await noteZip("a/b: c", "text", []));
    expect(Object.keys(files)).toEqual(["a_b_ c.md"]);
  });

  it("keeps a long title extractable", async () => {
    const [name] = Object.keys(unzipSync(await noteZip("字".repeat(250), "text", [])));
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(255);
  });

  it("gives each image type its extension", async () => {
    const names = Object.keys(
      unzipSync(
        await noteZip("n", "", [
          { name: "a", type: "image/jpeg", bytes: png },
          { name: "b", type: "image/webp", bytes: png },
          { name: "c", type: "image/gif", bytes: png },
        ]),
      ),
    );
    expect(names).toEqual(
      expect.arrayContaining(["images/a.jpg", "images/b.webp", "images/c.gif"]),
    );
  });
});
