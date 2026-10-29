export type SeedNode = { label: string; children?: SeedNode[] };

export type SeedMap = {
  title: string;
  notes: { heading: string; paragraphs: string[] };
  /** The reference map; its root is labelled with the title. */
  children: SeedNode[];
};

export type SeedFolder = { name: string; maps: SeedMap[] };

/** Inline notes (the format topics used before sources) as Markdown. */
export function notesMarkdown(notes: SeedMap["notes"]) {
  return [`# ${notes.heading}`, ...notes.paragraphs].join("\n\n") + "\n";
}

export const demoLibrary: SeedFolder[] = [
  {
    name: "Biology 101",
    maps: [
      {
        title: "Cellular respiration",
        notes: {
          heading: "Lecture 7: Cellular respiration",
          paragraphs: [
            "Glycolysis splits glucose into two pyruvate molecules in the cytoplasm, for a net gain of 2 ATP.",
            "Pyruvate is converted to acetyl-CoA, which enters the Krebs cycle in the mitochondrial matrix.",
            "The Krebs cycle produces NADH and FADH₂, which carry electrons to the electron transport chain.",
            "The electron transport chain, on the inner mitochondrial membrane, produces most of the cell's ATP.",
          ],
        },
        children: [
          {
            label: "Glycolysis",
            children: [{ label: "Cytoplasm" }, { label: "2 ATP" }],
          },
          {
            label: "Krebs cycle",
            children: [{ label: "Matrix" }, { label: "NADH" }],
          },
          {
            label: "Electron transport chain",
            children: [{ label: "Inner membrane" }, { label: "Most ATP" }],
          },
        ],
      },
      {
        title: "Photosynthesis",
        notes: {
          heading: "Lecture 8: Photosynthesis",
          paragraphs: [
            "The light-dependent reactions happen in the thylakoid membranes, splitting water and releasing oxygen.",
            "They produce ATP and NADPH, which power the Calvin cycle.",
            "The Calvin cycle, in the stroma, fixes carbon dioxide into sugar.",
          ],
        },
        children: [
          {
            label: "Light reactions",
            children: [{ label: "Thylakoid" }, { label: "Release O₂" }, { label: "ATP + NADPH" }],
          },
          {
            label: "Calvin cycle",
            children: [{ label: "Stroma" }, { label: "Fixes CO₂" }],
          },
        ],
      },
      {
        title: "Cell structure",
        notes: {
          heading: "Lecture 3: Cell structure",
          paragraphs: [
            "The nucleus holds the cell's DNA and controls gene expression.",
            "Ribosomes build proteins, either free in the cytoplasm or on the rough ER.",
            "The plasma membrane is a phospholipid bilayer that controls what enters and leaves the cell.",
          ],
        },
        children: [
          { label: "Nucleus", children: [{ label: "DNA" }] },
          { label: "Ribosomes", children: [{ label: "Proteins" }, { label: "Rough ER" }] },
          { label: "Plasma membrane", children: [{ label: "Phospholipid bilayer" }] },
        ],
      },
    ],
  },
  {
    name: "Statistics 3022",
    maps: [
      {
        title: "Hypothesis testing",
        notes: {
          heading: "Week 5: Hypothesis testing",
          paragraphs: [
            "The null hypothesis states there is no effect; the alternative states there is one.",
            "The p-value is the probability of data at least this extreme if the null is true.",
            "Rejecting a true null is a Type I error; failing to reject a false null is a Type II error.",
          ],
        },
        children: [
          { label: "Hypotheses", children: [{ label: "Null" }, { label: "Alternative" }] },
          { label: "p-value" },
          { label: "Errors", children: [{ label: "Type I" }, { label: "Type II" }] },
        ],
      },
    ],
  },
  {
    name: "Organic Chemistry",
    maps: [
      {
        title: "Functional groups",
        notes: {
          heading: "Chapter 2: Functional groups",
          paragraphs: [
            "Alcohols contain a hydroxyl group (–OH) and can form hydrogen bonds.",
            "Carbonyl groups (C=O) appear in aldehydes and ketones.",
            "Carboxylic acids combine a carbonyl and a hydroxyl, and are acidic.",
          ],
        },
        children: [
          { label: "Alcohols", children: [{ label: "–OH" }] },
          { label: "Carbonyls", children: [{ label: "Aldehydes" }, { label: "Ketones" }] },
          { label: "Carboxylic acids", children: [{ label: "–COOH" }] },
        ],
      },
    ],
  },
];
