import { describe, it, expect } from "vitest";
import { synthesizeDomainContext } from "../src/domains/domain-synthesizer.js";

const dentalDomain = {
  name: "dental-clinical",
  description: "Clinical dental workflows",
  tags: ["dental", "clinical"],
  content: "full content here",
  sections: [
    { heading: "Core Concepts", content: "Teeth are numbered using the FDI system. Orthodontic treatment involves brackets and aligners." },
    { heading: "Terminology", content: "Malocclusion: misalignment of teeth. Bracket: attachment bonded to tooth." },
    { heading: "Business Rules", content: "Treatment plans must be approved by lead clinician. Maximum duration 36 months." },
    { heading: "Common Edge Cases", content: "Mixed dentition in pediatric patients requires special staging." }
  ]
};

const logisticsDomain = {
  name: "logistics",
  description: "Shipping and transport rules",
  tags: ["logistics", "shipping"],
  content: "logistics content",
  sections: [
    { heading: "Core Concepts", content: "Incoterms define buyer/seller responsibilities. FOB, CIF, DDP are most common." },
    { heading: "Regulations", content: "Customs declarations required for international shipments. Weight limits per carrier." },
    { heading: "Business Rules", content: "Shipments over 30kg require freight classification. Hazmat needs special handling." }
  ]
};

const financeDomain = {
  name: "finance",
  description: "Accounting and billing rules",
  tags: ["finance", "accounting", "billing"],
  content: "finance content",
  sections: [
    { heading: "Invoice Rules", content: "Invoices must include VAT breakdown. Payment terms default to 30 days." },
    { heading: "Billing Cycles", content: "Monthly billing on the 1st. Prorated for mid-cycle starts." }
  ]
};

describe("synthesizeDomainContext", () => {
  it("returns empty string when no domains provided", () => {
    const result = synthesizeDomainContext({ task: "do something", domainHints: ["dental"], selectedDomains: [] });
    expect(result).toBe("");
  });

  it("returns empty string when selectedDomains is null/undefined", () => {
    expect(synthesizeDomainContext({ task: "x", domainHints: [], selectedDomains: null })).toBe("");
    expect(synthesizeDomainContext({ task: "x", domainHints: [], selectedDomains: undefined })).toBe("");
  });

  it("includes all sections of a single domain when task matches broadly", () => {
    const result = synthesizeDomainContext({
      task: "Create a dental treatment workflow with brackets and aligners for orthodontic patients",
      domainHints: ["dental", "clinical"],
      selectedDomains: [dentalDomain]
    });

    expect(result).toContain("dental-clinical");
    expect(result).toContain("Core Concepts");
    expect(result).toContain("FDI system");
    expect(result).toContain("Terminology");
    expect(result).toContain("Business Rules");
  });

  it("filters sections by relevance to task keywords", () => {
    const result = synthesizeDomainContext({
      task: "Fix the invoice generation for dental billing",
      domainHints: ["dental", "billing"],
      selectedDomains: [dentalDomain, financeDomain]
    });

    // Finance invoice section should be included (matches "invoice", "billing")
    expect(result).toContain("Invoice Rules");
    // Dental business rules should be included (matches "dental")
    expect(result).toContain("dental-clinical");
  });

  it("handles multiple domains and synthesizes context from all", () => {
    const result = synthesizeDomainContext({
      task: "Build shipping module with customs integration",
      domainHints: ["logistics", "shipping"],
      selectedDomains: [logisticsDomain, financeDomain]
    });

    expect(result).toContain("logistics");
    // Logistics sections about shipping/customs should score high
    expect(result).toContain("Incoterms");
    expect(result).toContain("Customs declarations");
  });

  it("respects maxTokens by truncating sections", () => {
    const result = synthesizeDomainContext({
      task: "dental treatment workflow",
      domainHints: ["dental"],
      selectedDomains: [dentalDomain],
      maxTokens: 50 // Very small — should truncate
    });

    // Should have some content but not everything
    expect(result.length).toBeLessThan(400); // 50 tokens * ~4 chars + headers
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns all content when maxTokens is 0 (unlimited)", () => {
    const result = synthesizeDomainContext({
      task: "dental treatment",
      domainHints: ["dental"],
      selectedDomains: [dentalDomain],
      maxTokens: 0
    });

    expect(result).toContain("Core Concepts");
    expect(result).toContain("Business Rules");
    expect(result).toContain("Common Edge Cases");
  });

  it("includes domain sections even with empty hints if task text matches", () => {
    const result = synthesizeDomainContext({
      task: "Fix the bracket positioning algorithm for orthodontic treatment",
      domainHints: [],
      selectedDomains: [dentalDomain]
    });

    expect(result).toContain("dental-clinical");
    // Sections mentioning brackets/orthodontic should be included
    expect(result).toContain("Core Concepts");
  });

  it("produces clean markdown with domain headers", () => {
    const result = synthesizeDomainContext({
      task: "dental treatment",
      domainHints: ["dental"],
      selectedDomains: [dentalDomain]
    });

    // Should have domain name as header
    expect(result).toMatch(/### dental-clinical/);
    // Should have section sub-headers
    expect(result).toMatch(/#### Core Concepts/);
  });
});
