// HU-4547 — Swift adapter. Detection by Package.swift (SwiftPM) or project.yml
// (XcodeGen). .build is SwiftPM's output, DerivedData Xcode's, Pods and
// Carthage the dependency checkouts. chunkSwift is regex-only: no prepare().
import { chunkSwift } from "./chunk-swift.js";

export const SWIFT_ADAPTER = {
  id: "swift",
  extensions: [".swift"],
  skipSegments: [".build", "DerivedData", "Pods", "Carthage"],
  manifests: ["Package.swift", "project.yml"],
  chunkSource: chunkSwift,
};
