export function shouldBlockByProfile({ gateStatus, profile = "pragmatic" }) {
  if (profile === "paranoid") {
    return gateStatus !== "OK";
  }

  return gateStatus === "ERROR";
}

export function summarizeIssues(issues) {
  const bySeverity = issues.reduce((acc, issue) => {
    const severity = issue.severity || "UNKNOWN";
    acc[severity] = (acc[severity] || 0) + 1;
    return acc;
  }, {});

  return Object.entries(bySeverity)
    .map(([severity, count]) => `${severity}: ${count}`)
    .join(", ");
}
