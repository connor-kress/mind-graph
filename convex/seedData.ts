export type SeedNode = { label: string; children?: SeedNode[] };

export const demoTopic = {
  course: "Biology 101",
  title: "Cellular respiration",
};

export const demoNotes = {
  heading: "Lecture 7: Cellular respiration",
  paragraphs: [
    "Glycolysis splits glucose into two pyruvate molecules in the cytoplasm, for a net gain of 2 ATP.",
    "Pyruvate is converted to acetyl-CoA, which enters the Krebs cycle in the mitochondrial matrix.",
    "The Krebs cycle produces NADH and FADH₂, which carry electrons to the electron transport chain.",
    "The electron transport chain, on the inner mitochondrial membrane, produces most of the cell's ATP.",
  ],
};

export const demoReferenceTree: SeedNode = {
  label: "Cellular respiration",
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
};
