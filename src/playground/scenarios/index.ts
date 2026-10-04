import type { Scenario } from '../sim/types';
import { creativeScenarios } from './creative';
import { helpfulScenarios } from './helpful';
import { industryScenarios, labScenarios } from './industry';
import { showcaseScenarios } from './showcase';
import { withSinglePick } from './single-pick';
import { electronicsScenarios } from './electronics';

const showcase = showcaseScenarios();

/**
 * `lab` (Lab Sample Handler — vortex-mix, load the centrifuge, press START) leads
 * the list because it is the strongest lab story: it has a real process with an
 * interlock, not just a fetch. The showcase's `lab-samples` (custody record) moves
 * down with the rest of the showcase block rather than sitting second.
 *
 * Requested 2026-10-04. Ordering here is the Sim Lab's default list order, so
 * "move it up / move the other one down" is expressed by array position alone.
 */
const labLead = helpfulScenarios.filter((s) => s.id === "lab");
const rest = helpfulScenarios.filter((s) => s.id !== "lab");

export const ALL_SCENARIOS: Scenario[] = [
  // 1. The lab lead story, on its own so it can be promoted independently.
  ...labLead,
  // 2. The five showcase domains.
  ...showcase,
  // 3. Single-pick variants: same scene, but ONE fetch on request and then hold.
  ...showcase.map(withSinglePick),
  ...labScenarios,
  // Electronics service bench: screwdriver teardown + multimeter sweep. Both are
  // two-arm and were added after the showcase block so the five-domain story still
  // reads first.
  ...electronicsScenarios(),
  ...creativeScenarios,
  ...rest,
  ...industryScenarios,
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
