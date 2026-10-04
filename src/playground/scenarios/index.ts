import type { Scenario } from '../sim/types';
import { creativeScenarios } from './creative';
import { helpfulScenarios } from './helpful';
import { industryScenarios, labScenarios } from './industry';
import { showcaseScenarios } from './showcase';
import { withSinglePick } from './single-pick';
import { electronicsScenarios } from './electronics';

const showcase = showcaseScenarios();

/**
 * Default list order — requested 2026-10-04. This array IS the Sim Lab's default
 * ordering, so the demo sequence is expressed by position alone:
 *
 *   1. phone-repair      the live-hardware anchor
 *   2. pcb-assembly      same pipeline, smaller parts, two arms
 *   3. lab               Lab Sample Handler — vortex-mix, centrifuge, START
 *   4. screwdriver-bench service teardown
 *   5. multimeter-bench  test sweep
 *
 * Everything else follows in its previous groups. Nothing is dropped: the pinned
 * ids are partitioned out and re-emitted first, and a test asserts every scenario
 * still appears exactly once.
 */
const PINNED = [
  "phone-repair",
  "pcb-assembly",
  "lab",
  "screwdriver-bench",
  "multimeter-bench",
] as const;

const pool: Scenario[] = [
  ...showcase,
  ...showcase.map(withSinglePick),
  ...labScenarios,
  ...electronicsScenarios(),
  ...creativeScenarios,
  ...helpfulScenarios,
  ...industryScenarios,
];

const pinned = PINNED.map((id) => {
  const hit = pool.find((s) => s.id === id);
  if (!hit) throw new Error(`pinned scenario "${id}" is missing from the pool`);
  return hit;
});
const pinnedIds = new Set(PINNED as readonly string[]);

export const ALL_SCENARIOS: Scenario[] = [
  ...pinned,
  ...pool.filter((s) => !pinnedIds.has(s.id)),
];


export const CATEGORY_ORDER = ['Learn & Teleop', 'Music & Art', 'Games & Play', 'Care & Assistive', 'Lab & Kitchen', 'Industry & Testing', 'Space & Research'];

export const CATEGORY_ICON: Record<string, string> = {
  'Learn & Teleop': '🎓',
  'Music & Art': '🎨',
  'Games & Play': '🎲',
  'Care & Assistive': '🤲',
  'Lab & Kitchen': '🧪',
  'Industry & Testing': '🏭',
  'Space & Research': '🚀',
};

export const CODE_HEADER = `# pip install -e ".[feetech]"   (LeRobot)   – API names follow recent LeRobot; check your version
import time, numpy as np
from lerobot.robots.so101_follower import SO101Follower, SO101FollowerConfig

robot = SO101Follower(SO101FollowerConfig(port="/dev/ttyACM0", id="my_awesome_follower_arm"))
robot.connect()
JOINTS = ["shoulder_pan", "shoulder_lift", "elbow_flex", "wrist_flex", "wrist_roll", "gripper"]

def move(**pos):                      # degrees (gripper 0-100) after calibration
    robot.send_action({f"{k}.pos": v for k, v in pos.items()})
`;

export const DEFAULT_SCENARIO = 'burger';
