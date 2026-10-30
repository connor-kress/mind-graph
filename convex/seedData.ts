export type SeedNode = { label: string; children?: SeedNode[] };

export type SeedMap = {
  title: string;
  notes: { heading: string; paragraphs: string[] };
  /** The reference map; its root is labelled with the title. */
  children: SeedNode[];
};

export type SeedProject = { name: string; maps: SeedMap[] };

export const demoLibrary: SeedProject[] = [
  {
    name: "Example Project",
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
];
