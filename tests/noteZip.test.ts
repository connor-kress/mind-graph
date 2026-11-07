import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { MAX_ASSETS, MAX_RESULT_BYTES, imageTypeOf } from "../convex/model";
import { noteZip } from "../src/sources/download";
import { isNoteZip, NoteZipProblem, readNoteZip } from "../src/sources/noteZip";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 3, 4]);
const GIF = strToU8("GIF89a...");
const WEBP = strToU8("RIFF....WEBPVP8 ");

const zipFile = (files: Parameters<typeof zipSync>[0], name = "note.zip") =>
  new File([zipSync(files) as Uint8Array<ArrayBuffer>], name);

const problem = (zip: File) =>
  readNoteZip(zip).then(
    () => null,
    (error: Error) => error,
  );

/** A zip whose images claim to be a size when unzipped, as a crafted one can. */
function claimingImageSize(files: Parameters<typeof zipSync>[0], size: number) {
  const zip = zipSync(files);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let i = 0; i < zip.length - 46; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue;
    const name = zip.subarray(i + 46, i + 46 + view.getUint16(i + 28, true));
    if (new TextDecoder().decode(name).endsWith(".png")) view.setUint32(i + 24, size, true);
  }
  return new File([zip as Uint8Array<ArrayBuffer>], "note.zip");
}

describe("imageTypeOf", () => {
  it("knows the image types a note can have by their bytes", () => {
    expect(imageTypeOf(PNG)).toBe("image/png");
    expect(imageTypeOf(JPEG)).toBe("image/jpeg");
    expect(imageTypeOf(GIF)).toBe("image/gif");
    expect(imageTypeOf(WEBP)).toBe("image/webp");
  });

  it("refuses anything else, whatever it's called", () => {
    expect(imageTypeOf(strToU8("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeUndefined();
    expect(imageTypeOf(strToU8("RIFF....WAVE"))).toBeUndefined();
    expect(imageTypeOf(new Uint8Array())).toBeUndefined();
  });
});

describe("isNoteZip", () => {
  it("goes by the file's extension", () => {
    expect(isNoteZip("a.ZIP")).toBe(true);
    expect(isNoteZip("zip.md")).toBe(false);
  });
});

describe("readNoteZip", () => {
  it("reads back what a note's download holds", async () => {
    const markdown = 'Text ![a](asset:img1) and ![b](asset:crop_2 "A title") and ![a](asset:img1).';
    const zip = await noteZip("Lecture 4", markdown, [
      { name: "img1", type: "image/png", bytes: PNG },
      { name: "crop_2", type: "image/jpeg", bytes: JPEG },
    ]);
    const note = await readNoteZip(new File([zip as Uint8Array<ArrayBuffer>], "Lecture 4 (1).zip"));
    expect(note.name).toBe("Lecture 4.md");
    expect(note.markdown).toBe(
      'Text ![a](asset:img1) and ![b](asset:img2 "A title") and ![a](asset:img1).',
    );
    expect(note.images.map(({ name, type }) => [name, type])).toEqual([
      ["img1", "image/png"],
      ["img2", "image/jpeg"],
    ]);
    expect([...note.images[1].bytes]).toEqual([...JPEG]);
  });

  it("finds a note and its images in a folder, past what zip tools add", async () => {
    const note = await readNoteZip(
      zipFile({
        "Notes/": new Uint8Array(),
        "Notes/.DS_Store": strToU8("junk"),
        "Notes/Cells.markdown": strToU8("![a](images/a.png) ![b](./images/../b.jpg)"),
        "Notes/images/a.png": PNG,
        "Notes/b.jpg": JPEG,
        "__MACOSX/Notes/._Cells.markdown": strToU8("junk"),
      }),
    );
    expect(note.name).toBe("Cells.markdown");
    expect(note.markdown).toBe("![a](asset:img1) ![b](asset:img2)");
  });

  it("follows links however Markdown can write them", async () => {
    const note = await readNoteZip(
      zipFile({
        "n.md": strToU8(
          "![a](<my pic.png>) ![b](my%20pic.png) ![c](fig(1).png) ![d]( fig(1).png )",
        ),
        "my pic.png": PNG,
        "fig(1).png": JPEG,
      }),
    );
    expect(note.markdown).toBe(
      "![a](asset:img1) ![b](asset:img1) ![c](asset:img2) ![d](asset:img2 )",
    );
    expect(note.images).toHaveLength(2);
  });

  it("leaves other links alone, and files nothing links to out", async () => {
    const markdown =
      "![a](missing.png) [site](https://example.com/a.png) ![b](data.txt) ![c](/a.png)";
    const note = await readNoteZip(
      zipFile({
        "n.md": strToU8(markdown),
        "unused.png": PNG,
        "data.txt": strToU8("not an image"),
      }),
    );
    expect(note.markdown).toBe(markdown);
    expect(note.images).toEqual([]);
  });

  it("doesn't pick up an image a link reaches through a system folder", async () => {
    const note = await readNoteZip(
      zipFile({ "n.md": strToU8("![a](__MACOSX/a.png)"), "__MACOSX/a.png": PNG }),
    );
    expect(note.images).toEqual([]);
  });

  it("reads a note whose title starts with a dot, as its download is named", async () => {
    const note = await readNoteZip(
      new File([(await noteZip(".plans", "Text", [])) as Uint8Array<ArrayBuffer>], ".plans.zip"),
    );
    expect(note.name).toBe(".plans.md");
  });

  it("ignores a note's macOS shadow beside it", async () => {
    const note = await readNoteZip(zipFile({ "n.md": strToU8("Text"), "._n.md": strToU8("junk") }));
    expect(note.name).toBe("n.md");
  });

  it("doesn't name an image after a link the note still has to one that's missing", async () => {
    const note = await readNoteZip(
      zipFile({ "n.md": strToU8("![old](asset:img1) ![new](a.png)"), "a.png": PNG }),
    );
    expect(note.markdown).toBe("![old](asset:img1) ![new](asset:img2)");
    expect(note.images.map((image) => image.name)).toEqual(["img2"]);
  });

  it("says when a zip isn't one note", async () => {
    expect(await problem(zipFile({ "a.png": PNG }))).toEqual(
      new NoteZipProblem("note.zip doesn't have a Markdown note in it"),
    );
    expect(await problem(zipFile({ "a.md": strToU8("a"), "b/b.md": strToU8("b") }))).toEqual(
      new NoteZipProblem("note.zip has more than one Markdown note. Upload them one by one."),
    );
    expect(await problem(new File(["not a zip"], "note.zip"))).toEqual(
      new NoteZipProblem("Couldn't read note.zip as a zip"),
    );
  });

  it("refuses images that would be too much all together", async () => {
    const files: Parameters<typeof zipSync>[0] = {};
    let links = "";
    for (let i = 0; i < 60; i++) {
      files[`${i}.png`] = PNG;
      links += `![](${i}.png)`;
    }
    files["n.md"] = strToU8(links);
    expect(await problem(claimingImageSize(files, MAX_RESULT_BYTES))).toEqual(
      new NoteZipProblem("note.zip is larger than 512 MB unzipped"),
    );
  });

  it("keeps to the limits on images, without inflating what's too large", async () => {
    const tooLarge = new Uint8Array(MAX_RESULT_BYTES + 1);
    tooLarge.set(PNG);
    expect(await problem(zipFile({ "n.md": strToU8("![a](a.png)"), "a.png": tooLarge }))).toEqual(
      new NoteZipProblem("a.png in note.zip is larger than 10 MB"),
    );
    // An image that isn't linked isn't looked at.
    expect(
      (await readNoteZip(zipFile({ "n.md": strToU8("Text"), "a.png": tooLarge }))).markdown,
    ).toBe("Text");

    const files: Parameters<typeof zipSync>[0] = {};
    let links = "";
    for (let i = 0; i <= MAX_ASSETS; i++) {
      files[`${i}.png`] = PNG;
      links += `![](${i}.png)`;
    }
    files["n.md"] = strToU8(links);
    expect(await problem(zipFile(files))).toEqual(
      new NoteZipProblem(`note.zip has more than ${MAX_ASSETS} images`),
    );
  });
});
