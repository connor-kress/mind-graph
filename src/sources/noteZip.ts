import {
  imageTypeOf,
  kindOfFile,
  MAX_ASSETS,
  MAX_RESULT_BYTES,
  MAX_SOURCE_BYTES,
} from "../../convex/model";

/** Why a zip can't be added as a note, to show to whoever chose it. */
export class NoteZipProblem extends Error {}

export const isNoteZip = (name: string) => name.toLowerCase().endsWith(".zip");

/** Unzipping happens all at once in the page, so this keeps an archive from taking it down. */
const MAX_ZIP_BYTES = 512 * 1024 * 1024;

const inMB = (bytes: number) => `${bytes / 1024 / 1024} MB`;

/** What macOS adds to a zip: a `__MACOSX` folder and `._` files, which can be called `._<note>.md`. */
const isSystemFile = (path: string) => /(^|\/)(__MACOSX\/|\._)/.test(path);

/** Where a Markdown link leads, which can be in angle brackets and hold balanced parentheses. */
const LINK_TARGET = /\]\(\s*(<[^<>\n]+>|(?:[^\s()]|\([^\s()]*\))+)/g;

/** The path in the zip of a link in a note in a folder, which ends in a slash unless it's the top. */
function linkedPath(folder: string, target: string) {
  let link = target.replace(/^<|>$/g, "");
  try {
    link = decodeURIComponent(link);
  } catch {
    // A literal % in a file name.
  }
  const parts: string[] = [];
  for (const part of `${folder}${link}`.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part) parts.push(part);
  }
  return parts.join("/");
}

/**
 * The note in a zip: its only Markdown file, as a download of a note holds it,
 * at the top or in a folder from zipping it again. Links to its images point at
 * the names they will be stored under, and other files in the zip are left out.
 */
async function unpack(zip: File) {
  const { strFromU8, unzipSync } = await import("fflate");
  const bytes = new Uint8Array(await zip.arrayBuffer());
  const paths: string[] = [];
  unzipSync(bytes, {
    filter: ({ name }) => {
      paths.push(name);
      return false;
    },
  });
  // Only what's wanted gets inflated, up to the size it claims, so its limit can be checked first.
  const read = (wanted: Set<string>, limit: number) => {
    let total = 0;
    return unzipSync(bytes, {
      filter: ({ name, originalSize }) => {
        if (!wanted.has(name)) return false;
        if (originalSize > limit) {
          throw new NoteZipProblem(`${name} in ${zip.name} is larger than ${inMB(limit)}`);
        }
        total += originalSize;
        if (total > MAX_ZIP_BYTES) {
          throw new NoteZipProblem(`${zip.name} is larger than ${inMB(MAX_ZIP_BYTES)} unzipped`);
        }
        return true;
      },
    });
  };

  const notes = paths.filter((path) => !isSystemFile(path) && kindOfFile(path) === "md");
  if (!notes.length) throw new NoteZipProblem(`${zip.name} doesn't have a Markdown note in it`);
  if (notes.length > 1) {
    throw new NoteZipProblem(
      `${zip.name} has more than one Markdown note. Upload them one by one.`,
    );
  }
  const [path] = notes;
  const folder = path.slice(0, path.lastIndexOf("/") + 1);
  const text = strFromU8(read(new Set([path]), MAX_SOURCE_BYTES)[path]);

  const files = new Set(paths.filter((file) => !isSystemFile(file)));
  const linked = new Set(
    [...text.matchAll(LINK_TARGET)]
      .map(([, target]) => linkedPath(folder, target))
      .filter((file) => files.has(file)),
  );
  if (linked.size > MAX_ASSETS) {
    throw new NoteZipProblem(`${zip.name} has more than ${MAX_ASSETS} images`);
  }
  const contents = read(linked, MAX_RESULT_BYTES);
  const images: { name: string; type: string; bytes: Uint8Array<ArrayBuffer> }[] = [];
  const names = new Map<string, string>();
  let number = 0;
  for (const file of linked) {
    const type = imageTypeOf(contents[file]);
    if (!type) continue;
    // Not from the file's own name, which may not be one a stored image can have, nor
    // any name the note still links to, such as an image that was missing when it was saved.
    let name;
    do name = `img${++number}`;
    while (text.includes(`asset:${name}`));
    names.set(file, name);
    images.push({ name, type, bytes: contents[file] as Uint8Array<ArrayBuffer> });
  }
  return {
    name: path.slice(folder.length),
    markdown: text.replace(LINK_TARGET, (link, target: string) => {
      const name = names.get(linkedPath(folder, target));
      return name ? `](asset:${name}` : link;
    }),
    images,
  };
}

/** The note in a zip, or a `NoteZipProblem` saying why there isn't one. */
export async function readNoteZip(zip: File) {
  if (zip.size > MAX_ZIP_BYTES) {
    throw new NoteZipProblem(`${zip.name} is larger than ${inMB(MAX_ZIP_BYTES)}`);
  }
  try {
    return await unpack(zip);
  } catch (error) {
    if (error instanceof NoteZipProblem) throw error;
    console.error(error);
    throw new NoteZipProblem(`Couldn't read ${zip.name} as a zip`);
  }
}
