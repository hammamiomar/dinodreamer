// Every word of the header, the home page, the Train page and the footer, in one place, so the site's owner can
// write them without reading the components. Each string says where it shows. Keep the
// placeholders ({block}, {blocks}) where a number or a name is filled in; the components replace
// them. Plain sentences; the technical nouns (basis group, cellular automaton, selection target)
// are used the same way everywhere and are defined once, where they first matter.

import { createElement, Fragment, type ReactNode } from "react";

export const SITE_WORDS = {
  header: {
    /** The header's four links, left to right, after the wordmark "Dinodreamer". */
    explore: "Index",
    playground: "Automata",
    grow: "Train",
    how: "How it works",
    /**
     * The short form of "How it works" (under 832 px, where the full header does not fit its one
     * line); a screen reader still hears "How it works".
     */
    howShortForm: "How",
    /**
     * The header's last link, after How it works: the Painter's page (/canvas), the one experiment,
     * whose first line says Painter · experimental. Under 832 px the link shows three small squares,
     * and this word stays its name for a screen reader.
     */
    experimental: "Experimental",
  },

  frame: {
    /** The wordmark at the left of the header, on every page in the frame; it opens the home page. */
    wordmark: "Dinodreamer",
    /** What a screen reader hears while a navigation takes longer than a second (the square before the link blinks). */
    loading: "Loading",
    /** The page's one line while the library's release loads for the first time. */
    loadingLibrary: "Loading the library…",
    /** The heading when the library's release could not be read, so no page can start; the error follows it. */
    libraryFailed: "The library is not available",
    /** The heading when a page, or a part of the frame, failed to load; the error follows it. */
    pageFailed: "This page could not load",
    /** The button under the frame's error: loads the page again. */
    tryAgain: "Try again",
    /** A page's error heading when its basis group or picture is not in this data release. */
    notInRelease: "Not in this release",
    /** A page's error heading for an address that is not a page, and the sentence under it. */
    notFound: "Page not found",
    notFoundDetail: "There is no page at this address.",
    /** The button under a page's error. */
    backToExplore: "Back to Index",
  },

  home: {
    // The home (features/home/): the entrance, the automaton live beside the four links, then three
    // beats down the page, the model, the basis collection and the automaton, each a few sentences
    // beside a figure that follows the scroll, then the end. The links
    // are the header's words (header.*).

    /** The four links' name for a screen reader. */
    linksName: "Where to go",
    /** The arrows under the links, which turn the entrance's automaton to another of the featured pool; their names for a screen reader. */
    turnName: "Another automaton",
    previousAutomaton: "Previous automaton",
    nextAutomaton: "Next automaton",
    /** The reset between the arrows: the entrance's automaton grows again from noise. */
    resetAutomaton: "Grow it again",
    /** The chevron at the entrance's foot, the hint that the page goes on; its name for a screen reader. */
    nextSection: "Next section",
    /** The three beats, in order: the label over the heading, the heading, the sentences. */
    beats: {
      model: {
        label: "The model",
        heading: "A vision model reads a picture as 256 patches.",
        sentences: [
          "DINOv3 is a vision model from Meta. It learned to see from a billion pictures and no labels.",
          "It cuts a picture into 256 patches and describes each one in 768 numbers. Follow one patch of this hibiscus: layer by layer, its description takes in more of the picture, until it is written from the whole of it.",
        ],
      },
      basis: {
        label: "The basis collection",
        heading: "Each description is a point in a few small spaces.",
        sentences: [
          "We read the descriptions with a basis collection: 16,384 small learned spaces, three numbers wide. Every patch lands in a few of them.",
          "This patch lands in basis group 4009, out among the library patches that respond to it most.",
        ],
      },
      automaton: {
        label: "The automaton",
        heading: "Then we grow an image that lands on the same point.",
        sentences: [
          "A cellular automaton is a grid of 128 × 128 cells, each running the same tiny network. From noise, the cells grow an image.",
          "Training nudges the network until DINOv3 reads the grown image as that patch.",
        ],
      },
    },
    /** The model's figure: the layer the attention is read at, and the followed patch's share outside its own 3 × 3. */
    layerLine: "Layer {layer} of 12",
    outsideLine: "{outside}% of the patch's attention falls outside its 3 × 3 neighborhood.",
    /** The cloud's lit point, and its caption: {group} is the basis group's number, {patches} how many library patches it collects. */
    cloudLabel: "this patch",
    cloudLine: "Basis group {group}: {patches} library patches, placed by their three coordinates.",
    /** Under a training readout: the optimizer update it shows and the image's median response in m, the group's median selected response; at the fire, the share of the image's patches that selected the group. */
    readoutLine: "Update {update} · median response {strength} m",
    firedLine: "Update {update} · the group selected on {wins}% of the patches: the selection target is met.",
    /** The end, over the automaton running again: where all of it runs. */
    end: "Everything runs on WebGPU in your browser, training included, on a Rust engine built with {burn}.",
    /** The link in the end sentence, to burn.dev. */
    burn: "Burn.rs",
    /** The hibiscus's alt text. */
    pictureAlt: "A hibiscus, the library picture the automaton was trained toward, under the reader's 16 × 16 patch grid",
    /** An automaton's kind, in its label on the Automata stage. {rule} is Train's name of its grids in lower case ("coarse + fine"); {pixels} is kindTwoPixels or nothing; {start} is kindNoise or kindSeed. */
    kind: "{rule} automaton{pixels}, {start}",
    /** Added after the grids for an automaton whose picture has 2 px per cell. */
    kindTwoPixels: " at 2 px per cell",
    /** An automaton started from noise in every cell. */
    kindNoise: "from noise",
    /** An automaton started from central noise initialization. */
    kindSeed: "from central noise",
    /** The running automaton's name for a screen reader. {block} is the basis group's number. */
    canvasLabel: "Automaton of basis group {block}, running; draw on it to disturb it",
    /** The same canvas where the page gives no brush. */
    canvasStill: "Automaton of basis group {block}, running",
    /** At the end, in place of its sentence, when the browser has no WebGPU: the automaton is its poster. */
    noWebGpu: "This browser has no WebGPU, so the automaton is a still image. A browser with WebGPU runs it.",
    /** The same when the visitor's system asks for reduced motion. */
    reducedMotion: "Reduced motion is on, so the automaton is a still image. The Automata page runs it when you press Play.",
    /** Under the links when the automaton could not be read; {message} is the error. */
    materialFailed: "The automaton could not be read: {message}",
  },

  how: {
    // How it works (features/how/): one screen, the card of words at the left, the model map and the
    // figure at the right. The sections are in reading order in how-sections.ts; each section's words
    // are under `sections` by its id. The numbers in braces are filled in
    // by the figures from the recorded data ({outside}, {rank}, ...).

    /** The page's name, for assistive technology; the card's first heading is the visible one. */
    title: "How it works",
    /** The card and the map, for a screen reader. */
    cardName: "The explanation",
    stepsName: "Sections of this act",
    /** A step's name for a screen reader. {step} counts from 1; {heading} is the section's heading. */
    stepName: "Section {step}: {heading}",
    /** Above the heading: the act and the section's place in it. */
    stepOf: "{act} · {step} of {total}",
    stepPosition: "{step} of {total}",
    previousStep: "Previous step",
    nextStep: "Next step",
    back: "Back",
    /** A figure not built yet: {figure} is its name. */
    figurePending: "Figure: {figure}",

    /** The act tabs at the top of the card. */
    acts: {
      overview: "Overview",
      model: "The vision transformer",
      basis: "The block sparse featurizer",
      automaton: "The automaton",
      results: "Results",
      glossary: "Glossary",
    },

    /** The model map (how-map.tsx): each stage's name and its one-line detail inside its box. */
    map: {
      name: "The model map",
      /** A stage's accessible name; {stage} is its name. */
      open: "Go to {stage}",
      stages: {
        automaton: "automaton",
        picture: "picture",
        patches: "patches",
        dino: "ViT (DINO)",
        tokens: "tokens",
        basis: "block sparse\nfeaturizer",
        responses: "responses",
        loss: "loss",
      },
      details: {
        automaton: "cells + rule",
        picture: "128 or 256 px",
        patches: "16 × 16 px",
        dino: "12 layers",
        tokens: "768 per token",
        basis: "16,384 groups",
        responses: "32 selected",
        loss: "to target",
      },
    },

    /**
     * The sections. heading: the card's title. claim: the one-sentence takeaway under it. paragraphs:
     * two or three short ones; what the figure shows is said by the figure's own captions.
     * next: the Continue button's words, naming what comes next. A citation is written
     * [the words](key): the words are highlighted and link to the reference with that key below
     * (its `link`, the page the reader should land on, else its `url`).
     */
    sections: {
      overview: {
        heading: "How it works",
        claim: "A vision model's view, read with a basis, grown back as pictures.",
        paragraphs: [
          "[DINO](dinov3) is a vision transformer, a ViT, that learned to see without labels. It turns this 256 × 256 picture into 256 small descriptions, one per patch, and each one holds a lot of what the model knows.",
          "We read those descriptions with a [block sparse featurizer](bsf): 16,384 small spaces, three numbers wide each. A patch is a point in a few of them. One such space, a basis group, is the unit we can look at.",
          "Then we train small [neural cellular automata](growing) to grow pictures that land on a chosen point. DINO reads what grew, and its response guides the rule.",
        ],
        next: "Start with the vision transformer",
      },

      patches: {
        heading: "What the model sees",
        claim: "Every patch gets a description of 768 numbers, and no label was ever shown.",
        paragraphs: [
          "[DINOv3](dinov3) is a vision transformer from Meta. The model used here learned from a larger DINOv3 model trained without labels on more than a billion pictures. That was enough to learn what things are.",
          "It reads this 256 × 256 picture as 256 patches of 16 × 16 pixels. Each patch comes out as a token: 768 numbers that describe what is there and what is around it.",
          "Color each patch by its description and the picture sorts itself. Petals, leaves and wall fall apart without anyone naming them. This is why DINO is used for finding objects, depth, matching and more.",
        ],
        next: "How a patch reads the picture",
      },

      attention: {
        heading: "One patch reads the whole picture",
        claim: "By the last layer, a patch's description is written by the whole picture.",
        paragraphs: [
          "The ViT (DINO) rewrites every token twelve times. At each layer a token looks at all the others and takes what it needs. This is **attention**.",
          "Five tokens ride along with the 256 patches: a **class token** that stands for the whole picture, and four **registers** the model uses as scratch space. A patch reads from those too.",
          "Early layers look nearby. By layer twelve the followed patch reads from across the picture: {outside}% of its attention falls outside its own 3 × 3 neighborhood, and {prefix}% goes to the class token and the registers.",
          "So a token is not a crop. It is a summary of the whole picture, written from one place.",
        ],
        next: "Add the block sparse featurizer",
      },

      "basis-place": {
        heading: "The block sparse featurizer",
        claim: "A basis group is a tiny space of three directions, and a patch is a point in it.",
        paragraphs: [
          "A token is 768 numbers, too many to read at once. So we split each description into parts small enough to look at one at a time.",
          "A sparse autoencoder splits it into single directions, one number per feature. The [block sparse featurizer](bsf) splits it into small groups of directions instead. The idea is that a concept might have an inside: a rabbit's face would be one concept, and its nose and its eyes are places on it. Then one group could hold the whole face, and a patch's point in the group would say which part it is. The paper calls that shape a **manifold**. It is the paper's hypothesis.",
          "[Ours](collection) has 16,384 **basis groups**, each three directions at right angles, so a patch's place in a group is three coordinates. Three is our choice, not a measurement: it is the room we give a group, and three numbers can be drawn. The featurizer reads the token that leaves DINO's last layer and changes nothing in DINO.",
        ],
        next: "Which groups a patch uses",
      },

      selection: {
        heading: "Every patch is written with its top 32 basis groups",
        claim: "Every patch is written with 32 groups, and which 32 is the first thing we can read.",
        paragraphs: [
          "The featurizer subtracts a fixed mean token, applies one scale, then measures the calibrated token against every basis group. Most groups barely respond. The 32 with the largest responses are selected, and the description is written with those alone.",
          "For this patch, basis group {group} ranks {rank} of the 32. Each lit square in the field is one selected group. Hover one to see its number, click to open it.",
        ],
        next: "Inside one group",
      },

      cloud: {
        heading: "The patches a group collects",
        claim: "The patches that select a group are the ones the featurizer describes alike; nearby points, more so.",
        paragraphs: [
          "The **library** is the public set of pictures used to inspect the featurizer, and the Index is built on it. Take every library patch that selects group {group} and place each one by its three coordinates. That is the group's cloud: {patches} patches.",
          "The ring is the median response. The levels show response magnitude in the full three-dimensional space. Our patch sits at level {level}.",
          "The Index page shows this for every group.",
        ],
        next: "Rebuild the description",
      },

      rebuild: {
        heading: "Reconstructing the patch token",
        claim: "The 32 groups rebuild the real patch token; what is left over is what they miss.",
        paragraphs: [
          "The featurizer is not a story told about the token. Add the 32 selected responses back through their basis groups and you get the token again, less a remainder.",
          "With all 32, {explained}% of the token's energy is explained. The curve shows it as groups are added, largest response first.",
          "Ideally the 32 groups would be the token's parts, each readable on its own. In practice it is not so simple.",
        ],
        next: "How the featurizer was trained",
      },

      "basis-training": {
        heading: "How the featurizer was trained",
        claim: "One job over millions of tokens: rebuild each one from 32 groups of 16,384.",
        paragraphs: [
          "The featurizer never saw a label either. The ViT (DINO) read every training picture once, from [MONET](monet) and a texture set, and the featurizer got one job: for each token, keep the 32 groups that respond most and rebuild the token from those alone. The remainder is the main loss, and every update moves the groups' directions to shrink it.",
          "The limit of 32 is what gives a group its meaning. A group that helps one token is wasted. A group that captures something many tokens share shrinks the remainder across the training pictures, so the groups settle on the structure DINO repeats, and the contest for the 32 places sorts each token into the groups that explain it best.",
          "A smaller second term asks the next 32 groups to explain what the first 32 missed, so a group that just misses the top 32 still learns instead of dying. Three passes over the training pictures brought the loss from {pass1} to {pass3}.",
        ],
        next: "What we tried first",
      },

      visualization: {
        heading: "What we tried first",
        claim: "Ask a picture to reach a patch's point and it tends to paint that patch. The groups are a dictionary of what DINO has seen.",
        paragraphs: [
          "The classic way to see what a direction means is [feature visualization](featurevis): change a picture's pixels until the model's reading reaches the target, and look at what appears. We did that with a group's point as the target.",
          "Started from noise and aimed at one patch's point, the picture tended toward that patch itself. The point is where DINO put the patch, and the shortest way there is to reproduce it. The groups index what DINO has seen: a **dictionary** of the inputs, not a set of concepts to draw with.",
          "So we stopped asking a picture to carry a point and asked a process to. A cellular automaton grows its image through repeated local updates: each grid's cells share a small rule. If what it grows lands on the point, it found an image that DINO reads the same way.",
        ],
        next: "A cellular automaton",
      },

      cells: {
        heading: "A cellular automaton",
        claim: "17,088 numbers, in two small rules run at every cell on its neighbors, make the image.",
        paragraphs: [
          "A cellular automaton is a grid of cells that all run the same small program. Each cell holds 16 numbers. The first three are its color, red, green and blue. The **image** is nothing more than those colors, 128 × 128 pixels.",
          "No cell sees the whole image at once. The coarse rule reads the cell and its eight neighbors through four fixed detectors: the value, changes left to right and top to bottom, and a weighted difference from the neighbors. These give 64 inputs. A network with 96 hidden units changes the cell's 16 numbers; its weights and biases total 7,776. Each cell applies its update with probability 1/2.",
          "This is the [neural cellular automaton](growing) of Mordvintsev and colleagues, on a torus, started from [noise](noisenca).",
        ],
        next: "Coarse + fine",
      },

      scales: {
        heading: "Coarse + fine",
        claim: "A coarse grid can run under the fine one. The image is the two added together.",
        paragraphs: [
          "The featured automaton has a **fine grid** of 128 × 128 cells and, under it, a **coarse grid** of 64 × 64 cells. All the coarse cells run one rule; all the fine cells run another. The site names the kinds by their grids: fine, or coarse + fine.",
          "In a coarse + fine automaton the coarse grid steps first. Then each fine cell reads its eight neighbors and the coarse cells around it: 80 numbers in instead of 64. The image is the coarse grid stretched to the fine grid's size and added to it, cell by cell.",
          "The coarse grid carries structure larger than a fine cell can see. In the recorded comparison, coarse + fine automata met the selection target more often, at about 1.8 times the time per update.",
        ],
        next: "What trains it",
      },

      signal: {
        heading: "The training signal",
        claim: "DINO is the only critic. The rule changes; DINO never does.",
        paragraphs: [
          "Nothing tells the automaton what to draw. During training, each image grows for 32 to 64 more steps before DINO reads two transformed 128 × 128 views. Each view has 64 patch responses; their mean is a point in group {group}'s space.",
          "The loss is the distance from that point to the target: the hibiscus patch's point. The distance flows back through DINO, which stays fixed, into the rules, which move. That is the dashed path on the map.",
        ],
        next: "Watch it train",
      },

      updates: {
        heading: "Update by update",
        claim: "Training moves the image's mean response toward the target.",
        paragraphs: [
          "Every update the rule grows a small batch of images, the ViT (DINO) reads them, and the rule moves a little. The strip shows the image at 16 of the readouts, taken every 25 updates.",
          "At update {update} the group answered on {wins}% of the image's patches: the selection target was met and the automaton was kept. That first checkpoint is not always stable.",
        ],
        next: "Local and global",
      },

      "local-global": {
        heading: "Local rules, global reading",
        claim: "Rules that see only what is near them satisfy a reader that sees the whole image.",
        paragraphs: [
          "Each cell only ever saw what was near it: its eight neighbors, and for a fine cell, the coarse cells around it. The ViT (DINO) reads the grown image the way it reads any picture: one patch's token is written by the whole of it.",
          "Training found a local rule whose global reading is right. That is the result we find most interesting.",
        ],
        next: "What comes out",
      },

      results: {
        heading: "What comes out",
        claim: "The same group, different automata.",
        paragraphs: [
          "For most of the 16 groups in our recorded comparison, four kinds were trained: fine or coarse + fine, from noise or from a central seed. They look alike and differ in how they move.",
          "Not every run meets the target, and some lose it after they do. In that comparison, coarse + fine automata met it more often; seeded starts often met it and then drifted.",
        ],
        next: "Glossary and references",
      },

      glossary: {
        heading: "Glossary",
        claim: "The terms of this page, each defined once.",
        paragraphs: [
        ],
        next: "",
      },
    },

    /** The glossary's entries, in the order the terms first appear. */
    glossary: [
      { term: "patch", definition: "A square of 16 × 16 pixels. A 256 × 256 picture has 256 patches; a 128 × 128 training view has 64." },
      { term: "token", definition: "A patch's description after the model has read the picture: 768 numbers. A class token represents the whole picture; four registers provide working space." },
      { term: "attention", definition: "The step in which every token reads from all the others. The weights say how much each one is read." },
      { term: "basis group", definition: "One block of the featurizer: three fixed directions at right angles in the space of tokens. A token's place along them is its response, three numbers. There are 16,384 basis groups." },
      { term: "basis", definition: "A set of directions at right angles that together span a space. Every point of the space is a mix of them, and its coordinates along them are plain numbers. A basis group's three directions are a basis for its small space." },
      { term: "manifold", definition: "The shape a concept would trace in the token space if it had an inside: a rabbit's face, with the nose and the eyes as places on it. The block sparse featurizer is built on the hypothesis that concepts have one, and a basis group is meant to hold a piece of it whole. The word is the BSF paper's." },
      { term: "Grassmannian", definition: "The set of all three-direction spaces inside the token space. Our featurizer learns each basis group as one of them: only the space a group spans matters, not the three axes drawn in it." },
      { term: "block sparse featurizer", definition: "The model that reads DINO's tokens, named by its authors: the 16,384 basis groups together, with one fixed calibration of the token and one gain for putting it back together." },
      { term: "response", definition: "A token's three numbers in one basis group. Its length is the response magnitude." },
      { term: "library", definition: "The public set of MONET pictures used to inspect the featurizer and build the Index. DINO read every one of them once; a basis group's cloud is the library patches that select it." },
      { term: "feature visualization", definition: "Changing a picture's pixels until a model's reading of it reaches a target, then looking at the picture: the classic way to see what a direction means, and what we tried before the automata." },
      { term: "selection", definition: "The 32 groups with the largest responses to a token. The token is written with those alone." },
      { term: "ring and levels", definition: "In a group's cloud, the ring is the median response magnitude of the patches that select it. The levels divide the interval from the ring to the maximum into four equal parts; the first also includes magnitudes below the ring." },
      { term: "cellular automaton", definition: "A grid of cells that share a local update rule, applied step after step. Here each cell holds 16 numbers. The featured automaton has two grids: 7,776 parameters in the coarse rule and 9,312 in the fine rule, 17,088 in total." },
      { term: "image", definition: "What an automaton grows: the colors of its cells, 128 × 128 pixels. On this page a picture is a photograph, such as the hibiscus; an image is grown." },
      { term: "fine grid", definition: "The grid of 128 × 128 cells every automaton has. Its colors, plus the coarse grid's when there is one, are the image." },
      { term: "coarse grid", definition: "A second grid of 64 × 64 cells that some automata have, under the fine one. It steps first; each fine cell reads the coarse cells around it; and the image adds the coarse grid, stretched, to the fine one. The kinds are named by their grids: fine, or coarse + fine." },
      { term: "rule", definition: "The automaton's program: a small network that turns a cell's neighborhood into a change of its 16 numbers. Training changes only the rule." },
      { term: "optimizer update", definition: "One step of training: a batch of images is grown, read, compared with the target, and the rule moves." },
      { term: "selection target", definition: "The test an automaton must meet: its target group is selected on at least 90 % of the measured patches. Noise starts measure the whole image; seeded starts measure the central 4 × 4 patches." },
      { term: "projection on the target", definition: "How far the mean response of a grown image reaches along the target's direction, in units of the group's median magnitude." },
    ],

    /** The reference list: the papers and pages cited, in citation order. `link` is where a citation in the text lands; `url` the reference itself. */
    referencesHeading: "References",
    references: [
      { key: "dinov3", text: "Siméoni et al. DINOv3. 2025.", url: "https://arxiv.org/abs/2508.10104", link: "https://ai.meta.com/research/dinov3/" },
      { key: "registers", text: "Darcet et al. Vision Transformers Need Registers. 2023.", url: "https://arxiv.org/abs/2309.16588" },
      { key: "bsf", text: "Fel et al. Structuring Sparsity: Block-Sparse Featurizers Capture Visual Concept Manifolds. 2026.", url: "https://arxiv.org/abs/2606.25234", link: "https://www.goodfire.com/research/bsf-vision" },
      { key: "bsf-analysis", text: "Jerpelea and Ananthram. A Deeper Analysis of Block-Sparse Featurizers. 2026.", url: "https://arxiv.org/abs/2608.27515" },
      { key: "featurevis", text: "Olah, Mordvintsev and Schubert. Feature Visualization. Distill, 2017.", url: "https://distill.pub/2017/feature-visualization/" },
      { key: "monet", text: "Aubin et al. MONET: A Massive, Open, Non-Redundant and Enriched Text-to-Image Dataset. 2026.", url: "https://arxiv.org/abs/2605.21272" },
      { key: "collection", text: "The released block sparse featurizer, dinov3-vitb16-bsf-grassmannian-16384-rank3-k32.", url: "https://huggingface.co/hammamiomar/dinov3-vitb16-bsf-grassmannian-16384-rank3-k32" },
      { key: "growing", text: "Mordvintsev, Randazzo, Niklasson, Levin. Growing Neural Cellular Automata. Distill, 2020.", url: "https://distill.pub/2020/growing-ca/" },
      { key: "textures", text: "Niklasson, Mordvintsev, Randazzo, Levin. Self-Organizing Textures. Distill, 2021.", url: "https://distill.pub/selforg/2021/textures/" },
      { key: "noisenca", text: "Pajouheshgar, Xu, Süsstrunk. NoiseNCA. 2024.", url: "https://arxiv.org/abs/2404.06279" },
      { key: "explainer", text: "Cho et al. Transformer Explainer. Polo Club, 2024. The form of the interaction.", url: "https://poloclub.github.io/transformer-explainer/" },
      { key: "rosetta", text: "Schnaus et al. Shared Geometry as a Rosetta Stone. 2026. The form of the page.", url: "https://dominik-schnaus.github.io/unpaired-rosetta/" },
    ],

    /** The figures' captions and controls (figures/). */
    figures: {
      /** The picture, for a screen reader. {image} is the library picture's number. */
      pictureAlt: "The hibiscus, library picture {image}, with its 256 patches",
      /** Under the picture. {patch} is the followed patch, "patch 4, 7". */
      following: "Following {patch}. Hover another patch to follow it.",
      /** Under the coloured patches. */
      coloursCaption: "The same patches, colored by the three main directions of their tokens.",
      /** Under the attention heat. {patch} is the followed patch; {layer} the layer shown. */
      attentionCaption: "Where {patch} reads from at layer {layer}. Brighter patches are read more; the dashed box is its 3\u00a0×\u00a03 neighborhood.",
      layer: "Layer",
      layerValue: "{layer} of 12",
      /** The shares of the followed patch's attention at the shown layer: one row each, the percentage first. In this figure, non-breaking spaces keep "3 × 3" on one line. */
      shares: {
        value: "{share}%",
        outside: "outside its 3\u00a0×\u00a03 neighborhood",
        inside: "inside it",
        prefix: "to the class token and the four registers",
      },
      /** Under the twelve bars; each bar is labelled with its layer. */
      byLayer: "The share outside the 3\u00a0×\u00a03 neighborhood at each layer.",
      layerAxis: "Layer",

      /** Act 2. The drawing of where the basis sits (basis-schematic.tsx). */
      schematicName: "A sparse autoencoder beside the block sparse featurizer",
      saeTitle: "Sparse autoencoder",
      saeNote: "One number per feature.",
      bsfTitle: "Block sparse featurizer",
      bsfNote: "Three numbers per group: a point in a small space.",
      tokenLabel: "token · 768",
      /** Under the field. {patch} is the followed patch; {group} the boxed group. */
      fieldCaption: "All 16,384 groups in number order. The 32 selected by {patch} are lit; group {group} is boxed.",
      barsName: "The 32 selected groups",
      /** Above the bars: the group under the pointer, or the page's group, with its rank and response magnitude. */
      rankReadout: {
        group: "Basis group",
        rank: "rank",
        rankValue: "{rank} of 32",
        magnitude: "response magnitude",
      },
      openGroup: "Open basis group {group}",
      barsCaption: "The 32 selected groups by response magnitude. Hover one to find it in the field; click to open it.",
      /** At the lit point of the cloud. */
      cloudThis: "This patch",
      /** Under the cloud. {drawn} points of {patches} library patches. */
      cloudCaption: "Every library patch that selects group {group}, placed by its three numbers and projected onto a plane: {drawn} of {patches} drawn. The ring is the median response magnitude.",
      strongestCaption: "Patches sampled from the strongest response level, each marked on its picture.",
      /** The rebuilding. */
      groupsAdded: "Groups added",
      groupsValue: "{count} of 32",
      rebuildReadout: {
        explained: "of the token's energy explained",
      },
      rebuildCaption: "How much of the token's energy the groups explain as they are added, largest response first.",
      /** The training: the followed patch read through the featurizer as it was at the end of each pass. */
      passFieldCaption: "The 32 groups {patch} selected after pass {pass}; group {group} is boxed.",
      passSlider: "Pass",
      passValue: "{pass} of {total}",
      passReadout: {
        explained: "of the token's energy explained with all\u00a032",
        kept: "of its 32 groups are the final ones",
        loss: "mean loss over the pass",
      },
      passesCaption: "The token's energy explained as the 32 groups are added back, after each training pass. The chosen pass is drawn strong.",

      /** Act 3. The player and the cell opened. */
      playerCaption: "The automaton of group {group}, growing from noise. Draw on it to disturb the cells.",
      coarseCaption: "The coarse grid, 64 × 64 cells, at step 600.",
      fineCaption: "The fine grid, 128 × 128 cells, at step 600.",
      /** The two grids stacked (the Coarse + fine section): the stack as a button, its three labels, and the caption in each state. */
      stackName: "The coarse grid and the fine grid at step 600, stacked into the image or lifted apart",
      stackCoarseLabel: "coarse grid · 64 × 64 cells",
      stackFineLabel: "fine grid · 128 × 128 cells",
      stackImageLabel: "the image · coarse + fine",
      stackCaptionStacked: "The coarse grid stretched to the fine grid's size and added to it: the image at step 600. Click to lift the grids apart.",
      stackCaptionApart: "The two grids at step 600, apart: a coarse cell is the size of four fine cells. Click to stack them.",
      cellCaption: "Hover a picture to mark the same cell in all four.",
      cellFires: "fires this step",
      cellHolds: "holds this step",
      /** The cells section's player, without the brush. {group} is the basis group. */
      cellsPlayerCaption: "The automaton of group {group}, growing from noise.",
      /** The grid through each detector, for a screen reader. {detector} is the detector's name. */
      detectorPictureName: "The coarse grid at step 600 through the detector {detector}",
      detectorPicturesCaption: "The grid at step 600 through each detector, for its three color numbers; the rule applies them to all 16. The change pictures are stretched to fit.",
      /** The detectors by the filter's name (nca-math.ts, PERCEPTION_FILTERS), under each picture's stencil. */
      detectors: {
        identity: "the value",
        sobelX: "left to right",
        sobelY: "top to bottom",
        laplacian: "from the average",
      },
      /** Under a stencil whose sum is divided: "÷ 8". */
      detectorDivisor: "÷ {divisor}",
      /** The signal. */
      grownCaption: "The image at step 600, as DINO reads it.",
      spaceCaption: "Group {group}'s cloud again, with the grown image's 256 patches landed in it: each patch a point, their mean, and the hibiscus patch the rule was trained toward. The loss is the line from the mean to the target. Hover a patch of the image to find it.",
      signalLine: "The mean is {distance} m from the target",
      signalDistance: "{distance} m",
      targetLabel: "target",
      meanLabel: "mean",
      /** The training. */
      updateSlider: "Update",
      stripCaption: "The image at step 600 in 16 selected readouts, to the first accepted checkpoint.",
      updateReadout: {
        selection: "the group selected on",
        selectionValue: "{wins}% of the patches",
        strength: "strength",
        strengthValue: "{strength} m",
      },
      lossCaption: "The loss at every update, and the readouts' selection fractions as dots; a filled dot met the target.",
      /** Local and global. */
      heatCaption: "Where {patch} of the grown image reads from at layer 12: {outside}% from outside its 3 × 3. Hover a patch.",
      cellsCaption: "The cell under that patch and its eight neighbors; it also reads the coarse cells around it.",
      /** The bridge to the automata: the patch, then the two pictures the Painter grew from noise toward its point. {patch} is "patch 4, 7". */
      visualizationPatch: "The hibiscus, {patch}: the point to reach.",
      visualizationNoise: "Grown from noise toward it, nothing else given. Click to grow again.",
      visualizationReference: "The same, the hibiscus lending its colors as the appearance term. Click to grow again.",
      /** The painted picture as a button, for a screen reader. */
      visualizationReplay: "Play the growth from noise again",
      /** The results. */
      trainDoor: "Train your own",
      indexDoor: "Open the Index",
      /** The overview's loop: three captions. {patch} is "patch 4, 7"; {group} the basis group. */
      loopPatch: "The hibiscus, {patch}.",
      loopCloud: "Its point in basis group {group}.",
      loopAutomaton: "An automaton trained toward that point, growing.",
    },

    /** Record-loader failures (automaton-record.ts, featurizer-passes-source.ts). {status} is the HTTP status. */
    automatonRecordReadFailed: "The automaton record could not be read (HTTP {status}).",
    automatonRecordDownloadFailed: "The automaton record could not be downloaded. Check the connection and reload this page.",
    automatonRecordInvalid: "The automaton record contains invalid data.",
    basisTrainingReadFailed: "The featurizer's training record could not be read (HTTP {status}).",
    basisTrainingDownloadFailed: "The featurizer's training record could not be downloaded. Check the connection and reload this page.",
    basisTrainingInvalid: "The featurizer's training record contains invalid data.",
    /** In place of a figure while its numbers load, and when they could not be read. {message} is the error. */
    loading: "Computing…",
    failed: "This figure could not be computed: {message}",

    /** The names the figures give a token and a cell, counted from 1 (how-names.ts). */
    tokenClass: "class",
    tokenRegister: "register {index}",
    tokenPatch: "patch {row}, {column}",
    cellName: "cell {column}, {row}",
  },

  stage: {
    /** The automaton stage (the basis group's page, the owner's view): its name for a screen reader. */
    name: "Automata of this basis group",
    /** The line under the variation's name, its parts in this order and joined by " · ": "Basis group 12002 · figure · trained toward a Level 4 reference patch · projection on the target 2.39 m · selection fraction 100% · selection target met". {band} names the response level of the one patch the automaton was trained toward. */
    readingBlock: "Basis group {block}",
    readingToward: "trained toward a {band} reference patch",
    /** The stored value, named by what it holds (strengthStatistic): the mean projection on the training target's direction (Train) or on the main direction (E18, E19 and earlier Train runs), the median response magnitude that the E20 and E21 conversions recorded, or neither name when the experiment is not known. Format 4 stores every one of them in m. */
    readingStrength: "projection on the target {strength} m",
    readingMainDirection: "projection on the main direction {strength} m",
    readingMedian: "median response magnitude {strength} m",
    readingRecorded: "recorded measurement {strength} m",
    readingWins: "selection fraction {percent}%",
    /** In place of the selection fraction for central noise initialization, measured on the central 4 × 4 patches. */
    readingCentreWins: "central selection fraction {percent}%",
    fired: "selection target met",
    didNotFire: "selection target not met",
    /** The metadata table in the Options panel and on the publish form (material-metadata.tsx): its labels, the stored value's names (strengthStatistic) and the target's two states. Grids and Start reuse the Automata choices' labels. */
    metadata: {
      title: "Title",
      /** What the automaton's training asked for: the method's name, as the Automata page's grid names it. */
      method: "Asked for",
      reference: "Reference patch",
      projection: "Projection on the target",
      projectionMain: "Projection on the main direction",
      median: "Median response magnitude",
      recorded: "Recorded measurement",
      selection: "Selection fraction",
      centreSelection: "Central selection fraction",
      target: "Selection target",
      met: "met",
      notMet: "not met",
      updates: "Updates",
    },
    /** After the measurement line: the person who trained it. {credit} is the name. */
    by: "by {credit}",
    /** The trainer when none is named. */
    anonymous: "an anonymous trainer",
    /** The link at the end of that line: opens Train on this basis group and kind. */
    growAnother: "Train another variation",
    /** Beside it: Train continues this automaton definition from its own rule. */
    continueTraining: "Continue training",
    /** The frame's upper left corner: the basis group and the kind, "12002 · fine automaton, from noise". */
    frameLabel: "{block} · {kind}",
    /** The frame's lower right corner: the grid, "128 × 128 cells". */
    frameGrid: "{side} × {side} cells",
    /** In the cells before the automaton's first image frame. {name} is the variation's name. */
    loading: "Loading {name}…",
    /** The canvas, for a screen reader. {title} is the automaton's title. */
    canvasName: "{title}, running; draw on it to disturb it",
    /** The bar under the frame, for a screen reader. */
    controls: "Replay controls",
    /** The first button of the bar, for a screen reader: what it does now. */
    play: "Play",
    pause: "Pause",
    /** The Reset button's word, and its full name for a screen reader and the tooltip. */
    reset: "Reset",
    resetName: "Reset to step 0",
    /** The two sliders' labels. */
    speed: "Speed",
    brush: "Brush",
    /** The cells' size on screen, "4 px", and its name for a screen reader (the stage's size follows the window). */
    pixelsPerCell: "{pixels} px",
    pixelsPerCellName: "Pixels per cell",
    /** The two panel buttons at the end of the bar, for a screen reader. */
    downloads: "Downloads",
    options: "Options",
    /** In the Downloads panel. The automaton definition keeps its .material.json name. */
    downloadMaterial: "Download automaton definition",
    downloadPage: "Download page",
    /** The WGSL compute module of the rule with its weights, for WebGPU projects. */
    downloadShader: "Download WGSL shader",
    /** Shadertoy's Common, four buffers and Image tabs in one text file. */
    downloadShadertoy: "Download Shadertoy shader",
    /** Disabled export for the two-grid rule. */
    shadertoyUnavailable: "Shadertoy export is not yet available for coarse + fine automata.",
    /** In the Downloads panel: the video, {seconds} long, and its settings. */
    video: "Video · {seconds} s",
    videoSettings: "Video settings",
    fromTick: "From step",
    seconds: "Seconds",
    framesPerSecond: "Frames per second",
    ticksPerFrame: "Steps per frame",
    /** Under the bar while the video records. {seconds} is its length. */
    recording: "Recording {seconds} s…",
    /** In the Options panel: the seed, its button, and the grid. The button restarts the replay; it does not train. */
    seed: "Seed",
    growFromSeed: "Restart from this seed",
    grid: "Grid",
    /** A grid option: "128 cells". */
    gridOption: "{cells} cells",
    /** The column of the basis group's other automata beside the stage, for a screen reader. */
    thumbnails: "This basis group's automata",
    /** In the Downloads panel: saves the automaton on this device, under Saved automata in Automata. */
    keep: "Save on this device",
    /** In its place once saved. {yours} is the link "Saved automata" to the first group in Automata. */
    kept: "Saved. It is under {yours} in Automata.",
    yoursLink: "Saved automata",
    /** Beside it when the automaton could not be saved. {message} is the error. */
    keepFailed: "It could not be saved: {message}",
  },

  owner: {
    // The owner mode of the Playground (/admin/materials, features/owner/): the Playground's stage and
    // shelf with the owner's actions.
    /** The bar over the page: its name, and the link to the owner page (/admin). */
    heading: "Automata · owner view",
    ownerPage: "Owner page",
    /** The owner block's counts, two lines under its name. The numbers change in place after an action. */
    countsShown: "{shown} shown · {hidden} hidden",
    countsPending: "{pending} pending · {featured} featured",
    /** In place of the stage and the shelf while the automata load, and when the owner API fails. {message} is the error. */
    loading: "Loading the automata…",
    failed: "The owner API refused or failed: {message}. Open the owner page first to sign in.",
    /** The {message} above when the API gave no reason of its own. {status} is its HTTP status. */
    apiAnswered: "the owner API answered {status}",
    /** The {message} above when the list names a hidden automaton without the time it was hidden. */
    noHidingTime: "A hidden automaton has no hiding time",
    /** The {message} above when the list names a pending submission without its title, credit, time, basis group or file id. */
    badPending: "A pending submission lacks one of its fields",
    /** Under the bar when some pending files could not be read; those submissions are left out of Pending review. */
    pendingUnread: "{count} pending submissions could not be read: {message}",
    /** The shelf's first group: the submissions awaiting approval. */
    pendingGroup: "Pending review",
    /** A tile's marks, on its label line. */
    markHidden: "Hidden",
    markFeatured: "Featured",
    markPending: "Pending",
    markPurged: "Purged",
    markApproved: "Approved",
    markRejected: "Rejected",
    /** The owner's actions at the stage head, for the automaton on the stage; their group's name for a screen reader. */
    actionsName: "Owner actions",
    hide: "Hide",
    restore: "Restore",
    feature: "Feature",
    unfeature: "Unfeature",
    approve: "Approve",
    /** Purge and Reject ask once more in place: the action again, Keep it, and the warning under them. */
    purge: "Purge…",
    reject: "Reject…",
    purgeForGood: "Purge for good",
    rejectForGood: "Reject for good",
    keepIt: "Keep it",
    purgeWarning: "Purge deletes the automaton definition, its poster and its index entry. You cannot undo this.",
    rejectWarning: "Reject deletes the submission. You cannot undo this.",
    /** Under the actions for a featured automaton: where featuring puts it. */
    featuredPlace: "In the home's pool and the Featured group",
    /** Beside the stage's bar after an action on the automaton on the stage. */
    hidden: "Hidden. It keeps its place here.",
    restored: "Restored.",
    featured: "Featured.",
    unfeatured: "No longer featured.",
    approved: "Approved and published.",
    purged: "Purged. It stays here, greyed, until the page is reloaded.",
    rejected: "Rejected. It stays here, greyed, until the page is reloaded.",
    /** Beside the bar when an action failed. {action} is its word, {message} the Worker's reason. */
    actionFailed: "{action} failed: {message}",
  },

  research: {
    // The owner's research page (/admin/research, features/research/): every research run the
    // research repository published, by basis group and condition. Owner only; never public.
    heading: "Research",
    /** Under the heading. {runs}, {studies} and {groups} are counts; {made} the export's time and {commit} its research commit. */
    counts: "{runs} runs · {studies} studies · {groups} basis groups",
    madeFrom: "Exported {made} from research commit {commit}",
    loading: "Loading the research runs…",
    failed: "The research runs could not be read: {message}. Open the owner page first to sign in.",
    /** When the private bucket has no run index yet. */
    nothingYet: "No research runs are published yet. Publish an export with: pnpm run research publish <folder>",
    /** The filters over every view; an empty filter keeps everything. */
    studiesLabel: "Studies",
    tagsLabel: "Tags",
    outcomesLabel: "Outcome",
    clearFilter: "Clear",
    /** {shown} runs of {runs} pass the filter. */
    filtered: "{shown} of {runs} runs shown",
    /** A study's line in the list: {date}, {title} and {count} runs; its question under it. */
    studyLine: "{date} · {title} · {count} runs",
    /** The conditions: start, loss and rule. */
    starts: { noise: "Noise", "centre-disc": "Centre disc", "seeded-field": "Seeded field" },
    losses: { plain: "Plain", guided: "Guided", "plain-margin": "Plain + margin", other: "Other" },
    /** The patches the loss scores, and the run's other dials. */
    regions: { centre: "Centre 16 tokens", field: "Whole field" },
    lossRegion: "Loss scores",
    request: "Request",
    machine: "Machine",
    rules: { cell: "Fine", pyramid: "Coarse + fine" },
    /** The outcome classes, with their marks. */
    outcomes: { holds: "Holds at 4,000", fired: "Fired", "never-fired": "Never fired" },
    /** The overview's first column, and a cell's line: {fired} of {runs} fired. */
    groupColumn: "Basis group",
    cellCount: "{fired}/{runs}",
    /** A cell's name for a screen reader: {group}, {condition}, {runs}, {fired}. */
    cellName: "Basis group {group}, {condition}: {runs} runs, {fired} fired",
    /** The group view. */
    allGroups: "All basis groups",
    groupHeading: "Basis group {group}",
    /** The row and the view of the runs without a basis group. */
    noGroup: "No basis group",
    noRunsHere: "No runs",
    /** A card's lines: the seed and the update the run first fired at. */
    cardSeed: "seed {seed}",
    cardFired: "fired at {update}",
    cardNeverFired: "never fired",
    /** The run view's sections. */
    backToGroup: "Basis group {group}",
    dials: "Settings",
    outcome: "Outcome",
    reading: "Reading",
    stills: "Stills",
    stillAt: "Tick {tick}",
    provenance: "Provenance",
    /** The settings table's rows. */
    study: "Study",
    start: "Start",
    loss: "Loss",
    rule: "Rule",
    seed: "Seed",
    schedule: "Schedule",
    scheduleValue: "{updates} updates, pool {pool}",
    discValue: "radius {radius} cells",
    fieldValue: "radius {radius} cells on {amplitude} × noise",
    /** A guided loss's settings, each shown only when the run uses it; {units} is the DINO units the guide acts on, last. */
    guide: {
      ratio: "ratio {value}",
      weightCap: "weight cap {value}",
      releaseFraction: "release fraction {value}",
      releaseAtUpdate: "held to update {value}",
      releaseFloor: "release floor {value}",
      reEngages: "re-engages",
      reEngagesAt: "re-engages above {value} of its first loss",
      staysReleased: "stays released",
      zFloor: "z floor {value}",
      units: "on {units}",
    },
    /** The outcome table's rows. */
    releasedAt: "Released at update",
    requestLoss: "Request loss",
    centreSelected: "Centre tokens selected",
    centreValue: "{count} of {of}",
    naturalRoute: "Natural route kept",
    guideLossAtRelease: "Guide loss at release",
    guideLossEnd: "Guide loss at the end",
    firesAt: "First fired at update",
    holds: "Holds at tick 4,000",
    yes: "yes",
    no: "no",
    notMeasured: "—",
    materialSha256: "Definition SHA-256",
    /** Promote: the run as a pending automaton, published only by Approve on the materials page. */
    promote: "Promote",
    promoteTitle: "Public title",
    promoteHint: "Promote makes this run a pending automaton. It is public only after Approve on the materials page.",
    promoting: "Promoting…",
    promoted: "Pending as {id}. Approve it on the materials page.",
    promoteFailed: "Promote failed: {message}",
    materialsPage: "Materials page",
    /** The run's place on the site, from the owner's materials list. */
    onSitePending: "Pending review",
    onSiteShown: "Published",
    onSiteHidden: "Hidden",
    unknownRun: "No research run {id} is published.",
    unknownGroup: "No research runs train basis group {group}.",
  },

  publish: {
    /** The button under a saved automaton (Saved automata in Automata, the Train page): opens the form. */
    open: "Publish to the gallery",
    /** In its place once the automaton is shown in the gallery. */
    published: "Published in the gallery",
    /** In its place once sent, until the owner approves it. */
    awaiting: "Sent to the gallery · waiting for the owner's approval",
    /** The form's two fields, and the hint inside the second. */
    title: "Title",
    /** Draft: a creative title is optional; the saved recipe remains visible. */
    titleHint: "Your title, optional",
    titleHelp: "Up to {limit} characters. Leave blank to use the recipe as the name.",
    recipe: "Recipe",
    labelTooLong: "Use at most {limit} characters.",
    labelControlCharacters: "Remove control characters from this field.",
    credit: "Credit",
    creditHint: "Your name, optional",
    /** Under the fields: what the gallery receives and when it shows. */
    whatIsSent: "The gallery receives the automaton definition only: its weights, measurements and preview. It appears after the owner approves it.",
    /** The form's primary button, its word while sending, and the way out. */
    send: "Send",
    sending: "Sending…",
    cancel: "Cancel",
  },

  footer: {
    /** The footer's one line, left to right: three links. This link opens the author's site (computervision.vision). */
    site: "computervision.vision",
    /** The site link's tooltip. */
    siteTitle: "Omar Hammami's site, of which Dinodreamer is one part.",
    /** The link to this site's source code on GitHub. */
    code: "Code",
    /** The code link's tooltip. */
    codeTitle: "The source code of this site, its engine and its Worker, on GitHub.",
    /** The link to the block sparse featurizer on Hugging Face. */
    featurizer: "Featurizer",
    /** The featurizer link's tooltip. */
    featurizerTitle: "The block sparse featurizer on Hugging Face, with its card and loader.",
  },

  grow: {
    /** The display at the top of the Train panel. The basis group's number follows it on its own line. */
    title: "Train",
    /** Beside the occurrence's picture, when the reference patch is in a library picture. */
    towardLibrary: "Trains toward the marked patch of a library picture.",
    /** Beside the occurrence's picture, when the reference patch is in the visitor's own picture. */
    towardUpload: "Trains toward the marked patch of your picture.",
    /** Beside a library picture, when the visitor chose the lift from their own patch: the nearest Level 4 library patch in its direction. */
    towardNearest: "Trains toward the nearest Level 4 library patch in your patch's direction.",
    /** Under the response level when the reference patch is at Level 1 or Level 2. */
    weakReference: "This patch is near the ring. In the training tests so far, automata trained toward a patch here did not meet the selection target; automata trained toward Level 3 and Level 4 patches did.",
    /** The link under the occurrence to the basis group's page, where the visitor picks another patch. */
    pickAnother: "Pick another patch",
    /**
     * In place of the occurrence's sentence when Train continues a saved definition (/train?continue=): {update} is
     * the optimizer update it was saved at.
     */
    continuing: "Continues this automaton from optimizer update {update}, toward the marked patch.",
    /** The response levels a continuation can aim at instead of the definition's own reference patch (its accessible name). */
    continuedLevels: "Response level to train toward",
    /** Why the grids cannot change when Train continues a definition, shown on the unavailable choice. */
    continuedRule: "A continued automaton keeps its grids.",
    /** In place of the occurrence while the page finds a Level 4 reference patch. {block} is the basis group's number. */
    choosing: "Choosing a Level 4 reference patch of basis group {block}.",
    /** In place of the occurrence when the basis group has no Level 4 patch to aim at. {block} is the basis group's number. */
    noStrongest: "Basis group {block} has no Level 4 patch with a public picture. Pick a patch on its page.",
    /** The panel when /train names no basis group; the primary under it opens the Index. */
    nothing: "Nothing to train yet. Pick a basis group in the Index, then a patch on its page.",
    /** The primary when /train names no basis group. */
    exploreLink: "Index",
    /** Under the occurrence when the training target asks for a localized activity simulation (the older plant mode). */
    plant: "Localized activity simulation is not available yet. Your selection is retained.",
    /** In place of the occurrence when the training target names no reference patch (a selection from before reference patches); Train stays off. */
    noAnchor: "This selection has no reference patch, so Train has nothing to aim at. Open the basis group's page, select its patches and press Send to Train: the page then names the reference patch and its response level.",
    /** The label over the first choice (Fine, Coarse + fine); each option's hint is in grow/material-kind.ts. */
    rule: "Grids",
    /** The label over the second choice (Noise, Central noise). */
    start: "Start",
    /** The check above the primary. The first accepted checkpoint: the first checkpoint whose cellular model meets the selection target at simulation step 600, and for a noise start again at step 2,000. */
    stopAtFirstFire: "Stop at the first accepted checkpoint",
    /** The closed section under the two choices, for settings most people never change (grow-panel.tsx). */
    advanced: "Advanced",
    /** Its one setting: the grids grown per optimizer update. */
    batchSize: "Batch size",
    /** Under it, for batch size 4. GPU memory measured on an RTX 2080 Super in Chromium 155, 2026-10-30. */
    batchRecipe: "The recipe: four grids per update. Needs 1.5 to 1.8 GB of GPU memory.",
    /** Under it, for batch size 1: 0.8 to 0.9 GB, and 0.29 to 0.31 of the time per update, in the same measurements. */
    batchLight: "Half the memory and a third of the time of 4. It may meet the selection target less often.",
    /** Why a continuation's batch size cannot change. */
    continuedBatch: "A continued automaton keeps its batch size.",
    /** In place of the hint when Train fell back to batch size 1 because a run at 4 took the page down. */
    fallbackReload: "A run at batch size 4 stopped this page, likely for lack of memory. Train now uses 1.",
    /** In the start dialog when the browser gives Train no GPU (protocol.ts adapterUnavailable), with a Reload button. */
    noAdapter: "The browser gave Train no GPU. This can happen just after a run stopped the page. Reload the page, then press Train again.",
    reload: "Reload",
    /** The same when a run at 4 lost the graphics device. */
    fallbackDevice: "A run at batch size 4 lost the graphics device, likely for lack of memory. Train now uses 1.",
    /** The time line before a run. {updates} is a number of optimizer updates, {duration} the time ("6.6 min"). */
    timeBefore: "about {updates} updates · {duration}",
    /** The time line while a run trains. */
    timeLeft: "{updates} updates left · {duration}",
    /** The time line after a run. */
    timeTaken: "{updates} updates · {duration}",
    /** Ends the time while it comes from this device's own updates. */
    onThisDevice: "on this device",
    /** Ends the time before this device has trained 25 updates: the estimate uses measurements from an Apple M1 Max. */
    onReference: "on an M1 Max",
    /** The primary before a run, and after one when the visitor chose another kind. */
    grow: "Train",
    /** The primary while a run trains or waits. Stop holds the run: Resume trains it on. */
    stop: "Stop",
    /** The primary after Stop: trains the held run on from its update. */
    resume: "Resume",
    /** The primary after a run whose last update did not meet the selection target: trains the next seed. */
    restart: "Restart from the next seed",
    /** Beside it, under the time: holds that run's final cellular model as the result instead, as a run that has ended. */
    keepRun: "Keep this automaton",
    /** Beside Publish after a run has ended: trains it {updates} more updates. */
    trainFurther: "Train {updates} more updates",
    /** The primary after a run: opens the saved automaton in Automata. */
    open: "Open in Automata",
    // The corner tray (train-tray.tsx): the run, shown on every other page while it trains.
    /** The tray's name for a screen reader. */
    trayName: "The training run",
    /** The tray's tab, folded or open. {block} is the basis group's number. */
    trayTab: "Train {block}",
    /** The tray's way back to the Train page with this run. */
    trayBack: "Back to Train",
    /** Ends a held or failed run from the tray; its saved automata stay saved. */
    trayClose: "Close",
    /** The mark at the end of the status row, lit once an automaton that met the selection target is saved on this device. */
    kept: "Saved",
    /** Status while the models load. */
    loading: "Loading the models on this device.",
    /** Status, first line, while training: the update counter. {update} is the optimizer update. */
    update: "Optimizer update {update}",
    /** Status, first line, after Stop: the held update. */
    stopped: "Stopped at optimizer update {update}",
    /** Added to the update counter from the second run on. */
    run: "run {run} of {runs}",
    /** Added after the update counter once the run's first accepted checkpoint is saved (the Saved mark lights). {update} is its optimizer update. */
    firstFire: "first accepted checkpoint at update {update}",
    /** Added after the update counter while the final cellular model runs to simulation step 600 to be measured. */
    finishing: "measuring the final cellular model",
    /** Status, first line, after a run whose automaton met the selection target (the Saved mark is lit). {update} is the optimizer update of the saved model. */
    fired: "Optimizer update {update} · selection target met at simulation step 600",
    /** Status, first line, after three runs that did not meet the selection target. {runs} is the number of runs. */
    noneFired: "None of the {runs} runs met the selection target. The last cellular model is saved.",
    /** Status, first line, after the person keeps a run that did not meet the selection target, with runs still to try. */
    keptUnfired: "The final cellular model is saved. It did not meet the selection target.",
    /** Status, first line, after a run whose last update did not meet the selection target, while its final cellular model runs and the person decides. */
    retry: "The final cellular model did not meet the selection target. Restart from the next seed, or keep this automaton.",
    /** Status, second line, before the image analyzer has loaded. {loaded} and {all} count its basis partitions. */
    readerLoading: "Loading the image analyzer: {loaded} of {all}.",
    /** The row of basis groups selected on the read patches at the latest measurement, as pictures, in the choices' place while training runs. */
    coSelected: "What DINO sees",
    /** Under it, what the row and the map count, with every count's unit said. {patches} read patches, {group} the requested basis group, {needed} the selection target's count. */
    coSelectedHint: "DINO sees 32 basis groups on each of the picture's {patches} patches; these are the ones it sees most often. The run meets its target when {group} is among them on {needed} patches or more.",
    /** The same for central noise initialization, which is measured on the central 4 × 4 patches only. */
    coSelectedHintCentre: "DINO sees 32 basis groups on each of the central {patches} patches; these are the ones it sees most often. The run meets its target when {group} is among them on {needed} patches or more.",
    /** The measurement, second line: the selection fraction as a count of the read patches, and the count the selection target needs. The projection on the target is in the saved automaton's note, not here. */
    reading: "DINO sees {group} on {selected} of the {patches} patches. The target is {needed} patches.",
    /** The same for central noise initialization, which is measured on the central 4 × 4 patches only. */
    readingCentre: "DINO sees {group} on {selected} of the central {patches} patches. The target is {needed} patches.",
    /** Added to the measurement on the second line while training goes on after the first accepted checkpoint. */
    trainingOn: "training on",
    /** A time under a minute and a half, in the time line: "40 s". */
    seconds: "{seconds} s",
    /** A longer time: "6.6 min", or "12 min" from ten minutes on. */
    minutes: "{minutes} min",
    /** When Save could not store an automaton on this device; a Download button follows. */
    keepFailed: "The automaton is ready, but it could not be saved on this device. Download its automaton definition.",
    download: "Download",
    /** The lower corner of the frame: the live grid's simulation step. */
    tick: "step {tick}",
    /** The running automaton's name for a screen reader. {block} is the basis group's number. */
    canvasLabel: "Automaton of basis group {block}, running: draw on it to damage it",
    /** The start's still picture, for a screen reader. */
    stillLabel: "The start of the automaton, before training",
  },

  playground: {
    /** The page's line while the index loads, in place of the automaton. */
    loading: "Reading the automata…",
    /** The same place when the index could not be read. {message} is the error. */
    failed: "The automata could not be read: {message}",
    /** The same place when the index is empty. */
    nothingPublished: "No automaton is published yet.",

    /** An automaton's kind, in the head beside the basis group's number and on a tile's two lines: its grids, then the start. */
    ruleFine: "fine",
    ruleCoarseFine: "coarse + fine",
    startNoise: "noise",
    startSeeded: "central noise",
    startSeededField: "seeded field",
    /** After the grids on a tile, for an automaton at 2 px per cell: "fine · 2 px". */
    twoPixelsShort: "2 px",
    /** After the grids in the head, for the same automaton: "fine · 2 px per cell · noise". */
    twoPixels: "2 px per cell",

    /** The column of measurements beside the frame, for a screen reader. */
    readoutsName: "Measurements",
    /** The one measurement beside the frame: the simulation step, its label. */
    tick: "Step",
    /** Under a tile: the stored value in m, multiples of the basis group's median selected response magnitude: "1.49 m". {strength} has two decimals. It is a projection or a median response magnitude by the experiment (strengthStatistic); the tile does not name it. */
    strengthInM: "{strength} m",
    /** The quiet words at the foot of the measurements: save on this device, the downloads, the seed and the grid. */
    keep: "Save",
    /** In place of "Save" once saved: the tile is under Saved automata. */
    kept: "Saved",
    keepFailed: "It could not be saved: {message}",
    export: "Export",
    options: "Options",
    /** The one outlined button, under the quiet words: opens Train on this basis group and kind. */
    growVariation: "Train a variation",

    /**
     * The shelf's first group when the owner has featured automata: their label line, over their
     * tiles.
     */
    featured: "Featured",
    /** What a screen reader hears for the count at the end of the Featured line, and of the owner mode's group lines. {count} is the number. */
    groupCount: "{count} automata",
    /** The saved automata's line, first on the shelf when nothing is featured. */
    yours: "Saved automata, on this device",
    /** Beside "Saved automata" when nothing is saved. */
    yoursEmpty: "nothing saved yet",
    /** At the end of the Saved automata line: opens an automaton definition from the device. */
    import: "Import",
    /** Under the Saved automata line when they could not be read. {message} is the error. */
    yoursFailed: "Your saved automata could not be read: {message}",
    /** Under the saved tiles while one of them plays, after its name: the actions on it. */
    publish: "Publish",
    remove: "Remove",
    /** The confirmation that replaces "Remove": remove, or keep it. */
    removeConfirm: "Remove it",
    removeCancel: "Keep it",

    /** The choices' line: each word opens its row. "any" is the value when nothing is chosen. */
    rule: "Grids",
    start: "Start",
    family: "Category",
    any: "any",
    /** The first option of each row. */
    anyOption: "Any",
    /** What a screen reader hears for the number at the end of the choices' line. {count} is the number. */
    matching: "{count} automata match",
    /** Under the choices when no automaton matches them. */
    noMatch: "No automaton matches these choices.",

    /** What a screen reader hears for the count at the end of a basis group's heading. {count} is the number. */
    blockCount: "{count} automata",
    /** The preview's line while the basis group's pictures load. {block} is the number. */
    peekLoading: "Reading basis group {block}…",
    /** The preview's line when the basis group's pictures could not be read. */
    peekFailed: "The basis group's pictures could not be read.",
    /** The preview's link to the basis group's page. */
    openBlock: "Open the basis group",
    /** Closes the preview's sheet on a phone. */
    close: "Close",
  },
  /**
   * The Automata page as the gallery of every basis group (features/automata/): the wall of groups, one
   * group's screen with its pictures by level and its grid, and the saved automata. The stage's own
   * words (Step, Save, Export, Options, Train a variation) stay under `playground` above.
   */
  automata: {
    /** The wall's heading, on /automata. */
    wallTitle: "The automata of each basis group",
    /** The sentence under the wall's heading. {groups} and {automata} are the two counts. */
    wallLead: "Each square is a cellular automaton, trained until DINO responded to its image as it responds to the basis group's own patches. Point at a square, or on a phone scroll past it, to grow it large beside the group's four strongest patches. {groups} basis groups, {automata} automata.",
    /** Under the stage's patches: the way into the group on the stage. {group} is its number. */
    stageOpen: "Open basis group {group}",
    /** Under a card on the wall: the number of automata the group holds. {count} is the number. */
    cardCount: "{count} automata",
    cardCountOne: "1 automaton",
    /** A card's name for a screen reader. {group} is the number, {name} the owner's name or nothing. */
    cardName: "Basis group {group} {name}",
    /** The wall's line while the automata load, when they could not be read, and when none is published. {message} is the error. */
    loading: "Reading the automata…",
    failed: "The automata could not be read: {message}",
    nothingPublished: "No automaton is published yet.",
    /** In the place of a group's screen when the address names a group that holds no automaton. {group} is the number. */
    unknownGroup: "Basis group {group} has no automaton yet.",

    /** The line above a group's number: back to the wall, and the neighbouring groups in the wall's order. */
    allGroups: "All basis groups",
    previousGroup: "Previous",
    nextGroup: "Next",

    /** The frame's upper corner on a group's stage: where the automaton starts, then what it was asked for. */
    making: "{start} · {method}",
    /** The frame's lower corner: the automaton's grids, then the grid's size. {side} is the cells along a side. */
    gridsFine: "fine · {side} × {side} cells",
    gridsCoarseFine: "coarse + fine · {side} × {side} cells",

    /** The heading of the group's pictures by level, for a screen reader. */
    levelsName: "The basis group's own patches, by response level",
    /** While a group's pictures load, and when they could not be read. */
    levelsLoading: "Reading the basis group's pictures…",
    levelsFailed: "The basis group's pictures could not be read.",

    /** The grid's two titles: over its rows' names, and over its columns'. */
    startsTitle: "Where it starts",
    methodsTitle: "What it is asked for",
    /** What a screen reader hears for the grid as a whole. {group} is the number. */
    gridName: "The automata of basis group {group}, by where they start and what they were asked for",
    /** The rows' names: the state an automaton starts from. */
    starts: {
      noise: "Noise everywhere",
      circle: "A circle of noise",
      "circle-on-noise": "A circle on faint noise",
      "circle-anywhere": "A circle placed anywhere",
      drawn: "A drawn start",
    },
    /** The same starts inside the frame's corner line, after nothing: lower case, short. */
    startsInLine: {
      noise: "noise everywhere",
      circle: "a circle of noise",
      "circle-on-noise": "a circle on faint noise",
      "circle-anywhere": "a circle placed anywhere",
      drawn: "a drawn start",
    },
    /** The two bands over the columns: the space the comparison is made in. */
    methodSpaces: {
      "basis-group": "Basis-group matching",
      token: "Token matching",
      other: "Research variants",
    },
    /** A column's own word under its band: the comparison. */
    methodColumns: {
      "basis-group-mean": "mean",
      "basis-group-mean-guided": "mean, with a guide",
      "basis-group-distribution": "distribution",
      "token-mean": "mean",
      "token-distribution": "distribution",
      "mean-distribution-mix": "mean and distribution",
      "unit-activation": "one DINO unit",
    },
    /** A method's full name, in the frame's corner line and for a screen reader. */
    methods: {
      "basis-group-mean": "basis-group mean matching",
      "basis-group-mean-guided": "basis-group mean matching with a guide",
      "basis-group-distribution": "basis-group distribution matching",
      "token-mean": "token mean matching",
      "token-distribution": "token distribution matching",
      "mean-distribution-mix": "a mixture of mean and distribution matching",
      "unit-activation": "the activation of one DINO unit",
    },
    /** A cell's name for a screen reader. {start} and {method} are the names above; {count} the number of tries. */
    cellName: "{start}, {method}: {count}",
    /** An empty cell's name for a screen reader: nothing was grown that way for this group. */
    cellEmpty: "{start}, {method}: no automaton",
    /** Under a cell's picture when the cell holds more than one automaton. {count} is the number. */
    cellTries: "{count} tries",
    /** The "?" beside the grid's titles opens this explanation, three short paragraphs. */
    gridExplainSubject: "the grid",
    gridExplanation: [
      "A row is the state an automaton starts from: noise in every cell, or a circle of noise in the center, alone or on faint noise.",
      "A column is what its training asked for. Basis-group matching compares the three numbers a basis group reads from each patch. Token matching compares DINO's whole token, 768 numbers. Mean matching asks the image's patches to give the target on average. Distribution matching asks them to be spread like the group's strongest patches. A guide also holds units inside DINO at the levels they have on the group's real images, for the first part of training.",
      "Two trainings with the same row and column give different automata. Those are the tries of a cell.",
    ],

    /** The line over the strip of a cell's tries: its title, then which one plays. {at} and {count} are numbers. */
    triesTitle: "Tries",
    triesPlace: "{at} of {count}",
    /** After the place, when the cell holds one automaton. */
    triesOne: "This is the only one grown this way.",
    /** After the place, when the cell holds several. */
    triesMany: "The same start and the same request, trained again.",
    /** A try's name for a screen reader. {at} and {count} are numbers. */
    tryName: "Try {at} of {count}",

    /**
     * A phone's choice under the automaton, which stays at the top of the window: the group's pictures
     * and its grid, or the stage's controls (speed, brush, Save, Export, Options, Train a variation).
     */
    phoneViewsName: "What shows under the automaton",
    phoneGallery: "Automata",
    phoneControls: "Controls",

    /** The saved automata's screen (/automata?group=yours): its heading in the place of a group's number. */
    savedTitle: "Saved",
    /** At the right of the wall's heading: the way to the saved automata, without and with their number. {count} is the number. */
    savedLine: "Saved automata, on this device",
    savedLineCount: "Saved automata, on this device ({count})",
  },
  /**
   * The owner's view of the Automata page (/admin/automata, features/owner/owner-automata-page.tsx): the
   * same wall and screen over every research run. Only the owner reads these words, so they may use
   * the research's own names.
   */
  automataOwner: {
    /** In place of the page while the automata and the runs load, and when the owner API fails. {message} is the error. */
    loading: "Loading the automata and the research runs…",
    failed: "The owner API refused or failed: {message}. Open the owner page first to sign in.",
    /** The line over the wall and over a group's pane: the view's name, then how many automata a visitor sees. */
    heading: "Owner's view",
    counts: "{shown} shown of {all}",
    /** After the counts, when some runs have no place in the grid. {count} is their number. */
    unfiled: "{count} runs have no place in the grid",
    /** After the counts, when submitted automata wait for review: the way to their screen. {count} is their number. */
    pending: "{count} wait for review",
    pendingOne: "1 waits for review",
    /** The review's screen (/admin/automata?group=pending): its heading in the place of a group's number, and its line over the pictures. */
    pendingTitle: "Review",
    pendingLine: "Submitted automata, waiting for review",
    pendingNone: "Nothing waits for review.",
    /** Under a submission's picture: its basis group, then where it starts. {group} is the number. */
    pendingTile: "{group} · {start}",
    /** The line for the submission on the stage: its title and who sent it. {title} and {credit} are the sender's own words. */
    pendingBy: "{title}, by {credit}",
    pendingUntitled: "Untitled",
    pendingAnonymous: "no name given",
    /** The two actions on the submission on the stage. Reject asks once more in place. */
    approve: "Approve",
    reject: "Reject…",
    rejectForGood: "Reject for good",
    rejectWarning: "Reject deletes the submission. You cannot undo this.",
    /** After an action: where the automaton went. {group} is its basis group's number. */
    approved: "Approved. It is published in basis group {group}.",
    rejected: "Rejected.",
    /** When some submitted files could not be read; they are left out. {count} is their number, {message} the first reason. */
    pendingUnread: "{count} submissions could not be read: {message}",
    /** The choice at the end of that line: every run, or exactly what a visitor sees. */
    viewsName: "What the page shows",
    viewEvery: "Every run",
    viewVisitor: "As a visitor sees it",
    /** Under a card on the owner's wall, and under a cell of the grid: how many a visitor sees, of how many. */
    shownOf: "{shown} of {all} shown",
    noneShown: "{all}, none shown",
    /** The first line of the owner's block under the stage: where the automaton stands. */
    states: {
      shown: "A visitor sees it.",
      hidden: "Hidden. A visitor does not see it.",
      "not-shown": "A research run. A visitor does not see it.",
    },
    /** After the state, for each mark the automaton carries. */
    markCell: "The picture of its cell.",
    markGroup: "The picture of the group.",
    markSite: "Featured for the site.",
    /** The owner's actions, as the stage's quiet words; their group's name for a screen reader. */
    actionsName: "Owner actions",
    actions: {
      show: "Show",
      hide: "Hide",
      "cell-picture": "Picture of its cell",
      "group-picture": "Picture of the group",
      feature: "Feature for the site",
      unfeature: "Unfeature",
      purge: "Purge…",
    },
    /** Purge asks once more in place: the action again, Keep it, and the warning on the line under the bar. */
    purgeForGood: "Purge for good",
    keepIt: "Keep it",
    purgeWarning: "Purge deletes the automaton's public file, its poster and its index entry. A research run stays in the private store.",
    /** On the line under the stage's bar after an action. */
    results: {
      show: "Shown. A visitor sees it now.",
      hide: "Hidden.",
      "cell-picture": "It is the picture of its cell.",
      "group-picture": "It is the picture of the group.",
      feature: "Featured for the site.",
      unfeature: "No longer featured for the site.",
      purge: "Purged.",
    },
    /** The same line when an action failed. {action} is its word, {message} the Worker's reason. */
    actionFailed: "{action} failed: {message}",
    /** The field in the head that names the basis group, for a screen reader, and its words while empty. */
    nameLabel: "The basis group's name",
    namePlaceholder: "Name this basis group",
    /** Beside the field after the name is stored, and when it could not be. {message} is the Worker's reason. */
    nameSaved: "Saved",
    nameFailed: "Not saved: {message}",
    /** The run's facts under the actions. {id} is the run's id; {date} and {title} its study's. */
    runId: "{id}",
    study: "{date} · {title}",
    /** A run made to tune or test the trainer, and a run that asks for something other than the group as a whole. */
    roles: { "settings-sweep": "A run of a settings sweep.", "smoke-test": "A smoke test." },
    otherTarget: "It asks for something other than the basis group as a whole.",
    /** What the run measured. {update} is the update of its first reading that met the selection target. */
    firedAt: "Selection target met at update {update}.",
    neverFired: "Selection target never met.",
    holds: "It still met it at step 4,000.",
    dissolves: "It no longer met it at step 4,000.",
  },
  /**
   * Link previews: the Open Graph and Twitter tags that the Worker writes into the page, for Messages
   * and other link unfurlers, which run no JavaScript (gallery/src/link-preview.ts).
   */
  preview: {
    /** The home's preview title. */
    title: "Dinodreamer",
    /** The home's preview sentence: a first use, so it says cellular automaton in full. */
    homeDescription: "Cellular automata trained against a vision model: one small learned model runs in every cell, trained until a basis group of a DINOv3 basis collection meets its selection target on the generated image.",
    /** A basis group page's preview title. {block} is its number. */
    blockTitle: "Basis group {block} · Dinodreamer",
    /** A basis group page's preview sentence when it has published automata. {block} is its number; {materials} is oneMaterial or materials. */
    blockDescription: "Basis group {block} of a basis collection of 16,384, learned from DINOv3: the patches where it is selected, and {materials} trained toward it.",
    /** A basis group page's preview sentence when it has no published automaton yet. {block} is its number. */
    blockDescriptionNoMaterial: "Basis group {block} of a basis collection of 16,384, learned from DINOv3: the patches where it is selected.",
    oneMaterial: "1 cellular automaton",
    materials: "{count} cellular automata",
  },
} as const;

/** "{block}" and the like in a string, replaced by the values given; a placeholder with no value stays as it is. */
export function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

/** The same, where a value may be an element (a link): the pieces of the string and the values, in order, for React to render. */
export function fillNodes(text: string, values: Record<string, ReactNode>): ReactNode[] {
  return text.split(/(\{\w+\})/g).map((piece, index) => {
    const key = piece.match(/^\{(\w+)\}$/)?.[1];
    if (key === undefined) return piece;
    return key in values ? createElement(Fragment, { key: index }, values[key]) : piece;
  });
}
