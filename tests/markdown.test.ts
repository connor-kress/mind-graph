import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { followNoteLink } from "../src/sources/followNoteLink";
import { Markdown } from "../src/sources/Markdown";

const render = (markdown: string) => renderToStaticMarkup(createElement(Markdown, null, markdown));

describe("notes as rendered", () => {
  test("display math the runner fences renders whole, also in a list", () => {
    const html = render("- the vectors\n\n  $$\n  a_1,\\qquad\n  a_2\n  $$\n\n  are dependent");
    expect(html).not.toContain("katex-error");
    expect(html).toContain("katex-display");
    expect(html).toContain("a_1");
    expect(html).toMatch(/<p>are dependent<\/p>/);
  });

  test("raw HTML is skipped and images are only placeholders", () => {
    const html = render(
      "<script>alert(1)</script>\n\nHi <b>there</b> ![Cat](https://example.com/cat.png)",
    );
    expect(html).not.toMatch(/<script|<b>|<img|example\.com/);
    expect(html).toContain("[Cat]");
  });

  test("only the note's own images are shown", () => {
    const html = renderToStaticMarkup(
      createElement(
        Markdown,
        { assets: { "p1-a": "https://files.test/a.png" } },
        "![A](asset:p1-a) ![B](asset:p1-b) ![C](asset:toString) [D](asset:p1-a)",
      ),
    );
    expect(html).toContain('<img src="https://files.test/a.png" alt="A" loading="lazy"/>');
    expect(html).toContain("[B]");
    expect(html).toContain("[C]");
    expect(html).not.toContain('href="asset:');
  });

  test("math is typeset, without commands that link or load anything", () => {
    expect(render("$x^2$")).toContain('class="katex"');
    const html = render(
      "$\\href{https://example.com}{x}$ $\\includegraphics{https://example.com/a.png}$",
    );
    expect(html).not.toMatch(/<a |<img|href=/);
  });

  test("unsafe links lose their address, and footnotes link within the note", () => {
    expect(render("[x](javascript:alert(1))")).not.toContain("javascript:");
    const html = render("A claim.[^1]\n\n[^1]: The source.");
    const ref = html.match(/<a href="(#[^"]+)" id="([^"]+)"[^>]*>/);
    expect(ref).not.toBeNull();
    expect(ref![0]).not.toContain("_blank");
    // The footnote links back to the reference.
    expect(html).toContain(`href="#${ref![2]}"`);
  });
});

describe("links within a note", () => {
  /** A link whose note may contain the target, recording what was done to it. */
  function setup(target: { id: string; focusable: boolean } | null) {
    const log: string[] = [];
    const element = target && {
      tabIndex: 0,
      matches: () => target.focusable,
      focus: (options: FocusOptions) => log.push(`focus ${JSON.stringify(options)}`),
      scrollIntoView: () => log.push("scroll"),
    };
    const note = {
      querySelector: (selector: string) => {
        log.push(selector);
        return selector === `[id="${target?.id.replace(/"/g, '\\"')}"]` ? element : null;
      },
    };
    const event = {
      preventDefault: () => log.push("prevent"),
      currentTarget: {
        closest: (selector: string) => (selector === ".note-markdown" ? note : null),
      },
    };
    return { log, element, event: event as unknown as Parameters<typeof followNoteLink>[0] };
  }

  test("scroll to and focus their target in the same note, without changing the hash", () => {
    const { log, element, event } = setup({ id: 'user-content-fn-"1"', focusable: false });
    followNoteLink(event, '#user-content-fn-"1"');
    expect(log).toEqual([
      "prevent",
      '[id="user-content-fn-\\"1\\""]',
      'focus {"preventScroll":true}',
      "scroll",
    ]);
    // Footnotes become focusable, but links keep their place in the tab order.
    expect(element?.tabIndex).toBe(-1);
    const link = setup({ id: "ref", focusable: true });
    followNoteLink(link.event, "#ref");
    expect(link.element?.tabIndex).toBe(0);
  });

  test("do nothing but stay on the page when the target is missing", () => {
    const { log, event } = setup(null);
    followNoteLink(event, "#nowhere");
    expect(log).toEqual(["prevent", '[id="nowhere"]', '[id="nowhere"]']);
    // A malformed escape is only looked up as written.
    const malformed = setup(null);
    followNoteLink(malformed.event, "#a%E0");
    expect(malformed.log).toEqual(["prevent", '[id="a%E0"]']);
  });

  test("find a target named by an escaped fragment", () => {
    const { log, event } = setup({ id: "fnref-1", focusable: true });
    followNoteLink(event, "#fnref%2D1");
    expect(log).toEqual([
      "prevent",
      '[id="fnref%2D1"]',
      '[id="fnref-1"]',
      'focus {"preventScroll":true}',
      "scroll",
    ]);
  });
});
