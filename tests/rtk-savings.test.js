import { describe, expect, it } from "vitest";
import { RtkSavingsTracker } from "../src/utils/rtk-wrapper.js";

describe("RtkSavingsTracker — savings reporting", () => {
  it("records and accumulates correctly", () => {
    const tracker = new RtkSavingsTracker();
    tracker.record(1000, 600);
    tracker.record(2000, 1200);

    expect(tracker.originalBytes).toBe(3000);
    expect(tracker.rtkBytes).toBe(1800);
    expect(tracker.callCount).toBe(2);
  });

  it("getSummary returns correct ratio and estimated tokens", () => {
    const tracker = new RtkSavingsTracker();
    tracker.record(1000, 600);
    tracker.record(2000, 1200);

    const summary = tracker.summary();
    expect(summary.originalBytes).toBe(3000);
    expect(summary.rtkBytes).toBe(1800);
    expect(summary.savedBytes).toBe(1200);
    expect(summary.savedPct).toBe(40);
    // estimatedTokensSaved = floor(1200 / 4) = 300
    expect(summary.estimatedTokensSaved).toBe(300);
    expect(summary.callCount).toBe(2);
  });

  it("zero commands returns empty summary with zero tokens saved", () => {
    const tracker = new RtkSavingsTracker();
    const summary = tracker.summary();

    expect(summary.originalBytes).toBe(0);
    expect(summary.rtkBytes).toBe(0);
    expect(summary.savedBytes).toBe(0);
    expect(summary.savedPct).toBe(0);
    expect(summary.estimatedTokensSaved).toBe(0);
    expect(summary.callCount).toBe(0);
  });

  it("hasData returns false when no commands recorded", () => {
    const tracker = new RtkSavingsTracker();
    expect(tracker.hasData()).toBe(false);
  });

  it("hasData returns true after recording", () => {
    const tracker = new RtkSavingsTracker();
    tracker.record(100, 80);
    expect(tracker.hasData()).toBe(true);
  });

  it("handles no compression (same size in and out)", () => {
    const tracker = new RtkSavingsTracker();
    tracker.record(500, 500);

    const summary = tracker.summary();
    expect(summary.savedBytes).toBe(0);
    expect(summary.savedPct).toBe(0);
    expect(summary.estimatedTokensSaved).toBe(0);
  });

  it("session end event includes rtk_savings when tracker has data", () => {
    const tracker = new RtkSavingsTracker();
    tracker.record(800, 400);

    // Simulate what the orchestrator does
    const rtkSavings = tracker.hasData() ? tracker.summary() : undefined;
    const endDetail = { approved: true, budget: {} };
    if (rtkSavings) endDetail.rtk_savings = rtkSavings;

    expect(endDetail.rtk_savings).toBeDefined();
    expect(endDetail.rtk_savings.estimatedTokensSaved).toBe(100);
    expect(endDetail.rtk_savings.savedPct).toBe(50);
    expect(endDetail.rtk_savings.callCount).toBe(1);
  });

  it("session end event does NOT include rtk_savings when no RTK used", () => {
    const tracker = new RtkSavingsTracker();

    const rtkSavings = tracker.hasData() ? tracker.summary() : undefined;
    const endDetail = { approved: true, budget: {} };
    if (rtkSavings) endDetail.rtk_savings = rtkSavings;

    expect(endDetail.rtk_savings).toBeUndefined();
  });

  it("session end event does NOT include rtk_savings when tracker is null", () => {
    const tracker = null;

    const rtkSavings = tracker?.hasData() ? tracker.summary() : undefined;
    const endDetail = { approved: true, budget: {} };
    if (rtkSavings) endDetail.rtk_savings = rtkSavings;

    expect(endDetail.rtk_savings).toBeUndefined();
  });

  it("estimatedTokensSaved handles odd byte counts correctly", () => {
    const tracker = new RtkSavingsTracker();
    tracker.record(1001, 600);

    const summary = tracker.summary();
    // savedBytes = 401, estimatedTokensSaved = floor(401/4) = 100
    expect(summary.savedBytes).toBe(401);
    expect(summary.estimatedTokensSaved).toBe(100);
  });
});
