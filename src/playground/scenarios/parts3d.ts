import type { Prim } from '../sim/types';

/**
 * Component library — domain-recognisable parts instead of generic boxes.
 *
 * Every part is built from `Prim` primitives composed with `children`, which the
 * Sim Lab renderer already supports (`Prim.children`). That keeps these in the
 * existing scenario format: a scenario sets `props: [{ id, grab, width, children }]`.
 *
 * Why bother: a judge looking at a grey box does not picture a phone repair. A
 * recognisable battery with a flex ribbon reads as a phone repair immediately,
 * and it costs no extra runtime — same geometry, more meaning.
 *
 * Scale note: units are cm, matching the rig. A phone is ~15 x 7 x 0.8 cm, so these
 * are modelled slightly oversized for legibility at the Sim Lab's default zoom.
 * That is deliberate and does not affect reachability, which depends on x/z only.
 */

type V3 = [number, number, number];

/** Soft rounded slab: the base shape for batteries, screens and boards. */
function slab(w: number, h: number, d: number, color: number, y: number, extra: Partial<Prim> = {}): Prim {
  return { shape: 'box', size: [w, h, d], pos: [0, y, 0] as V3, color, rough: 0.45, ...extra };
}

/** Phone battery: flat pouch with a capacity label plate and a flex ribbon tail. */
export function phoneBattery(): { prim: Prim; grabWidth: number } {
  return {
    grabWidth: 3.6,
    prim: {
      shape: 'box',
      size: [4.6, 0.5, 3.4],
      pos: [0, 0.25, 0] as V3,
      color: 0x2f3540,
      rough: 0.6,
      label: 'battery',
      children: [
        // capacity label plate
        slab(2.6, 0.06, 1.8, 0xd8dde5, 0.52),
        // polarity stripe
        slab(0.5, 0.08, 3.2, 0xe0a03c, 0.53),
        // flex ribbon tail with a connector head
        { shape: 'box', size: [1.5, 0.08, 0.7], pos: [3.0, 0.30, 0] as V3, color: 0xd9a441, rough: 0.3 },
        { shape: 'box', size: [0.5, 0.16, 0.9], pos: [3.8, 0.30, 0] as V3, color: 0x1b1e24, rough: 0.4 },
        // two contacts
        { shape: 'box', size: [0.22, 0.10, 0.34], pos: [3.2, 0.30, -0.22] as V3, color: 0xc9a227, metal: 0.7, rough: 0.25 },
        { shape: 'box', size: [0.22, 0.10, 0.34], pos: [3.2, 0.30, 0.22] as V3, color: 0xc9a227, metal: 0.7, rough: 0.25 },
      ],
    },
  };
}

/** Phone screen: cover glass with a bezel and a visible display area. */
export function phoneScreen(): { prim: Prim; grabWidth: number } {
  return {
    grabWidth: 4.2,
    prim: {
      shape: 'box',
      size: [6.2, 0.22, 3.2],
      pos: [0, 0.11, 0] as V3,
      color: 0x0d1015,
      rough: 0.15,
      label: 'screen',
      children: [
        // display panel, inset and darker
        slab(5.6, 0.04, 2.7, 0x141b2a, 0.14, { emissive: 0.25 }),
        // earpiece slot
        slab(0.9, 0.06, 0.16, 0x05070a, 0.16),
        // front camera dot
        { shape: 'cyl', size: [0.18, 0.06], pos: [-2.4, 0.16, 1.1] as V3, color: 0x0a0d12, rough: 0.1 },
        // home indicator bar
        slab(1.6, 0.04, 0.14, 0x2a3242, 0.16),
      ],
    },
  };
}

/** Logic board: PCB with a shield can, a connector edge and surface-mount clutter. */
export function logicBoard(): { prim: Prim; grabWidth: number } {
  const smd = (x: number, z: number, c: number, s = 0.34): Prim => ({
    shape: 'box',
    size: [s, 0.12, s * 0.6],
    pos: [x, 0.30, z] as V3,
    color: c,
    rough: 0.5,
  });
  return {
    grabWidth: 5.0,
    prim: {
      shape: 'box',
      size: [7.0, 0.18, 4.4],
      pos: [0, 0.09, 0] as V3,
      color: 0x1d5c3a,
      rough: 0.7,
      label: 'logic board',
      children: [
        // EMI shield can
        slab(2.4, 0.30, 2.0, 0xb9c0c8, 0.33, { metal: 0.85, rough: 0.35 }),
        // SoC package
        slab(1.1, 0.16, 1.1, 0x14171c, 0.26, { metal: 0.3 }),
        // board-to-board connector, gold contacts
        { shape: 'box', size: [0.5, 0.18, 1.8], pos: [3.3, 0.20, 0] as V3, color: 0x1b1e24 },
        ...[-0.7, -0.35, 0, 0.35, 0.7].map((z) => smd(3.3, z, 0xc9a227, 0.28)),
        // passives
        smd(-2.4, -1.5, 0x8a5a2b),
        smd(-1.9, -1.5, 0x8a5a2b),
        smd(-2.4, 1.5, 0x2b3a4a),
        smd(-1.9, 1.5, 0x2b3a4a),
        smd(0.2, 1.6, 0x8a5a2b),
        // mounting holes
        { shape: 'cyl', size: [0.26, 0.2], pos: [-3.1, 0.18, -1.8] as V3, color: 0x0d3b26 },
        { shape: 'cyl', size: [0.26, 0.2], pos: [-3.1, 0.18, 1.8] as V3, color: 0x0d3b26 },
      ],
    },
  };
}

/** Component reel: the shape an electronics kitting bench actually uses. */
export function componentReel(color: number): { prim: Prim; grabWidth: number } {
  return {
    grabWidth: 3.0,
    prim: {
      shape: 'cyl',
      size: [1.6, 0.5],
      pos: [0, 1.1, 0] as V3,
      color,
      rough: 0.35,
      label: 'reel',
      children: [
        // hub window
        { shape: 'cyl', size: [0.9, 0.56], pos: [0, 0, 0] as V3, color: 0x2f343b },
        // hub spokes
        ...([0, 1, 2].map((i): Prim => ({
          shape: 'box',
          size: [1.5, 0.1, 0.16],
          pos: [0, 0.3, 0] as V3,
          rot: [0, (i * 60 * Math.PI) / 180, 0] as V3,
          color: 0x9aa3ad,
        })) as Prim[]),
      ],
    },
  };
}

/** Sample tube: a lab cryovial with a cap and a label band. */
export function sampleTube(color: number): { prim: Prim; grabWidth: number } {
  return {
    grabWidth: 1.5,
    prim: {
      shape: 'cyl',
      size: [0.75, 4.2],
      pos: [0, 2.1, 0] as V3,
      color: 0xdfe6ee,
      opacity: 0.55,
      rough: 0.1,
      label: 'sample',
      children: [
        // cap
        { shape: 'cyl', size: [0.85, 0.6], pos: [0, 4.5, 0] as V3, color, rough: 0.4 },
        // contents
        { shape: 'cyl', size: [0.6, 2.4], pos: [0, 1.4, 0] as V3, color, opacity: 0.8, rough: 0.2 },
        // label band
        { shape: 'cyl', size: [0.8, 1.0], pos: [0, 3.4, 0] as V3, color: 0xf4f6f8, rough: 0.8 },
      ],
    },
  };
}

/** Drink cup: tapered body, lid and straw — reads instantly as a beverage. */
export function drinkCup(): { prim: Prim; grabWidth: number } {
  return {
    grabWidth: 2.6,
    prim: {
      shape: 'cyl',
      size: [1.3, 3.0],
      pos: [0, 1.5, 0] as V3,
      color: 0xe8eef4,
      rough: 0.25,
      label: 'drink',
      children: [
        // lid
        { shape: 'cyl', size: [1.45, 0.35], pos: [0, 3.15, 0] as V3, color: 0x4a90d9, rough: 0.3 },
        // straw
        { shape: 'cyl', size: [0.16, 2.0], pos: [0.35, 4.0, 0] as V3, color: 0xe05252, rough: 0.3 },
        // sleeve
        { shape: 'cyl', size: [1.38, 1.4], pos: [0, 1.5, 0] as V3, color: 0xc4703a, rough: 0.85 },
      ],
    },
  };
}

/** Magazine: a stack of pages with a cover and a spine. */
export function magazine(): { prim: Prim; grabWidth: number } {
  return {
    grabWidth: 3.4,
    prim: {
      shape: 'box',
      size: [3.4, 0.7, 2.6],
      pos: [0, 0.35, 0] as V3,
      color: 0xd9784a,
      rough: 0.75,
      label: 'magazine',
      children: [
        // page block
        slab(3.2, 0.5, 2.4, 0xf2efe6, 0.33, { rot: [0, 0, 0] }),
        // cover
        slab(3.4, 0.08, 2.6, 0xd9784a, 0.68),
        // masthead band
        slab(2.2, 0.04, 0.5, 0xf6f1e8, 0.73),
        // spine
        slab(0.24, 0.72, 2.6, 0xa8542f, 0.36),
      ],
    },
  };
}

/** Stock crate: a shelf crate with a lip and a handle cutout suggestion. */
export function stockCrate(color: number): { prim: Prim; grabWidth: number } {
  return {
    grabWidth: 3.0,
    prim: {
      shape: 'box',
      size: [3.0, 2.2, 2.6],
      pos: [0, 1.1, 0] as V3,
      color,
      rough: 0.8,
      label: 'crate',
      children: [
        // rim
        slab(3.1, 0.16, 2.7, 0x2f343b, 2.15),
        // contents peeking out
        slab(2.4, 0.5, 1.9, 0xe8e2d6, 1.9),
        // handle recess
        slab(1.2, 0.3, 0.1, 0x2f343b, 1.5),
      ],
    },
  };
}

/** The phone on the work mat — the thing being repaired, for context. */
export function phoneUnderRepair(): Prim {
  return {
    shape: 'box',
    size: [7.2, 0.7, 14.8],
    pos: [0, 0.35, 0] as V3,
    color: 0x1a1f27,
    rough: 0.3,
    metal: 0.4,
    label: 'phone',
    children: [
      // exposed interior recess
      slab(6.2, 0.2, 12.0, 0x0e1116, 0.62),
      // main board visible inside
      slab(4.4, 0.14, 7.0, 0x1d5c3a, 0.68),
      // empty battery bay (the part we removed)
      slab(4.6, 0.12, 4.2, 0x14181e, 0.72),
    ],
  };
}

/**
 * Attach a component to a PropSpec position.
 *
 * The scenario format positions props by their own `pos`; children are modelled
 * around the origin and the parent carries the placement. This keeps every part
 * authored at the origin, where it is easy to reason about.
 */
export function at(prim: Prim, x: number, y: number, z: number): Prim {
  return { ...prim, pos: [prim.pos[0] + x, prim.pos[1] + y, prim.pos[2] + z] };
}

/** Rotate a prim about Y, in degrees, about its own origin. */
export function yaw(prim: Prim, deg: number): Prim {
  const r = (deg * Math.PI) / 180;
  const [x, y, z] = prim.pos as V3;
  return {
    ...prim,
    pos: [x * Math.cos(r) + z * Math.sin(r), y, -x * Math.sin(r) + z * Math.cos(r)],
    rot: [((prim.rot ?? [0, 0, 0]) as V3)[0], ((prim.rot ?? [0, 0, 0]) as V3)[1], ((prim.rot ?? [0, 0, 0]) as V3)[2] + deg] as V3,
  };
}