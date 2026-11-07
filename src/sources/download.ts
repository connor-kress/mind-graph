/** Characters that file systems don't allow in a name. */
const UNSAFE_IN_NAME = /[/\\:*?"<>|]/g;

/** Keeps a name within the 255 bytes that file systems allow, even if a character takes three. */
const MAX_NAME_LENGTH = 80;

/** A note's title as the start of a file name. */
const fileNameFrom = (title: string) =>
  title.replace(UNSAFE_IN_NAME, "_").slice(0, MAX_NAME_LENGTH);

/** File extensions for the image types a note can have. */
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

async function fetchFile(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Status ${response.status}`);
  return response;
}

/**
 * Saves a file under a name. Browsers ignore the name on a plain link to another
 * site, which stored files are on, so they would save it as its storage ID.
 */
function save(file: Blob, name: string) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // The browser has taken its own reference by the time this runs.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Saves a stored file under a name. */
export async function downloadFile(url: string, name: string) {
  const response = await fetchFile(url);
  save(await response.blob(), name);
}

/** A note's Markdown with its image links pointing at files, given each image's file by name. */
export function withImageFiles(markdown: string, files: Map<string, string>) {
  return markdown.replace(/\]\(asset:([A-Za-z0-9_-]+)/g, (link, name: string) => {
    const file = files.get(name);
    return file ? `](${file}` : link;
  });
}

/** A zip of a note and an `images` folder its links point into. */
export async function noteZip(
  title: string,
  markdown: string,
  images: { name: string; type: string; bytes: Uint8Array }[],
) {
  const { strToU8, zipSync } = await import("fflate");
  const files = new Map<string, string>();
  const entries: Parameters<typeof zipSync>[0] = {};
  for (const { name, type, bytes } of images) {
    const extension = IMAGE_EXTENSIONS[type];
    const file = `images/${name}${extension ? `.${extension}` : ""}`;
    files.set(name, file);
    // Images are compressed already, so trying again would only hold up the page.
    entries[file] = [bytes, { level: 0 }];
  }
  entries[`${fileNameFrom(title)}.md`] = strToU8(withImageFiles(markdown, files));
  return zipSync(entries);
}

/** Saves a note's Markdown under its title, in a zip with its images if it has any. */
export async function downloadNote(
  title: string,
  markdownUrl: string,
  assetUrls: Record<string, string | null>,
) {
  const fileName = fileNameFrom(title);
  const links = Object.entries(assetUrls).filter(
    (entry): entry is [string, string] => entry[1] !== null,
  );
  const [markdown, images] = await Promise.all([
    fetchFile(markdownUrl).then((response) => response.text()),
    Promise.all(
      links.map(async ([name, url]) => {
        const file = await (await fetchFile(url)).blob();
        return { name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) };
      }),
    ),
  ]);
  if (!images.length) {
    save(new Blob([markdown], { type: "text/markdown" }), `${fileName}.md`);
    return;
  }
  const zip = await noteZip(title, markdown, images);
  save(new Blob([zip as Uint8Array<ArrayBuffer>], { type: "application/zip" }), `${fileName}.zip`);
}
