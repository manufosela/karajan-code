// KJC-TSK-1814: the agent figure's measures, in the robot's own units (cast/robot.js is 3.5 tall).
// Pure: agent-figure.js builds it. Its head and shoulders are where Karajan's robot has them, so the
// models' attire, the king's crown and robe, the backpack, the laptop and the cup fit it as they are.

export const FIGURE = Object.freeze({
  legs: { height: 0.42, apart: 0.26, radius: 0.13 },
  body: { bottom: 0.42, top: 1.5, radius: 0.62, waist: 0.52 },
  neck: { radius: 0.2, height: 0.3 },
  head: { y: 2.4, width: 1.78, height: 1.56, depth: 1.5, round: 0.38 },
  screen: { width: 1.36, height: 0.92 },
  shoulder: { x: 0.8, y: 1.12 },
});
